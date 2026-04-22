//! Foundation helper runner — Rust side of the Swift ↔ Rust bridge.
//!
//! The `SwiftFoundationHelper` is supervised: a single persistent child is
//! driven by framed JSON stdio; on failure the child is killed, the caller
//! sees a fast `Unavailable`, and the next request either waits out a
//! backoff window or tries to respawn. After `max_consecutive_failures`
//! back-to-back spawn/IO failures the helper demotes permanently — callers
//! that subscribe to `subscribe_events()` see a `Demoted` event and can
//! switch to a fallback UI; polling `health()` reports `running = false`.
//!
//! The supervisor never blocks a request on backoff. In-flight requests during
//! a broken-pipe event fail fast so the UI stays responsive; the child is
//! lazily re-spawned on the first request after the cooling-off window
//! elapses.
//!
//! ## Error variant taxonomy
//!
//! - `HelperError::Timeout(Duration)` — a per-request or boot-probe deadline
//!   was exceeded. Distinct from `Unavailable` so callers don't have to
//!   substring-match on error messages to tell timeout apart from other
//!   supervisor states.
//! - `HelperError::Unavailable(..)` — the supervisor declined to run this
//!   request (cooling off, demoted, no child). Never used for timeouts.
//! - `HelperError::Reported(..)` — the Swift side returned a structured
//!   `{"kind":"error"}` response. Callers can match on the message string
//!   (which comes verbatim from the helper) to discriminate e.g.
//!   `"macos-too-old"` vs `"foundation-models-unavailable"`.
//! - `HelperError::Spawn/Io/Protocol/Serde` — the remaining low-level
//!   failures. Not timeout, not supervisor-state, not helper-reported.

use crate::cache::{CacheKey, ResponseCache};
use crate::protocol::{HelperRequest, HelperResponse, JobKind};
use crate::ratelimit::RateLimiter;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

#[derive(Debug, Error)]
pub enum HelperError {
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("helper reported: {0}")]
    Reported(String),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("deadline {0:?} exceeded")]
    Timeout(Duration),
}

pub type HelperResult<T> = Result<T, HelperError>;

/// Runtime snapshot of whichever helper is active. Cheap to copy; surfaced
/// through IPC so 13.F can decide how to describe provenance of derived
/// output.
///
/// Semantics of `running`: `true` iff the helper has observed at least one
/// successful round-trip since boot AND has not been demoted. Freshly booted
/// helpers read `false` until the first success; this overlap with
/// `NullHelper` (which is always `false`) is disambiguated by the enclosing
/// `HelperStatus::kind` in the IPC DTO.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HelperHealth {
    pub running: bool,
    pub consecutive_failures: u32,
    #[serde(with = "system_time_serde")]
    pub last_restart: Option<SystemTime>,
    pub version: Option<String>,
    pub model: Option<String>,
}

mod system_time_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::time::{SystemTime, UNIX_EPOCH};

    pub fn serialize<S: Serializer>(
        value: &Option<SystemTime>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let millis = value
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        millis.serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<SystemTime>, D::Error> {
        let millis = Option::<u64>::deserialize(deserializer)?;
        Ok(millis.map(|m| UNIX_EPOCH + std::time::Duration::from_millis(m)))
    }
}

/// State-transition events published by the supervisor. A consumer subscribes
/// via `SwiftFoundationHelper::subscribe_events()` and re-renders provenance
/// without polling per-artifact. Fan-out is unbounded on the consumer side;
/// slow subscribers that fall behind see `broadcast::error::RecvError::Lagged`
/// (tokio's default behavior) and can resync via `AppCore::helper_health`.
#[derive(Debug, Clone)]
pub enum HelperEvent {
    /// First successful round-trip after boot or a demotion recovery. Carries
    /// the version/model strings from the Pong so subscribers can label
    /// provenance without an extra query.
    Ready { version: String, model: String },
    /// A failed round-trip — supervisor scheduled a backoff. Streams during a
    /// recovery so the UI can show "retrying" without polling.
    Degraded { consecutive_failures: u32 },
    /// Permanent fallback — the supervisor hit `max_consecutive_failures` and
    /// will refuse further exchanges. 13.F should swap to NullHelper-aware
    /// rendering in response.
    Demoted,
    /// Consecutive failure streak cleared after being ≥ 1. Distinct from
    /// `Ready` so subscribers can differentiate "first boot" from "recovered
    /// from N failures."
    Recovered,
}

#[async_trait]
pub trait FoundationHelper: Send + Sync {
    async fn ping(&self) -> HelperResult<String>;
    async fn generate(&self, job: JobKind, prompt: &str) -> HelperResult<String>;
    /// Runtime health snapshot. Default: a dormant "not running" report, which
    /// is correct for fallbacks that never spawn a subprocess.
    fn health(&self) -> HelperHealth {
        HelperHealth::default()
    }
}

// --- Supervisor internals -------------------------------------------------

const STDERR_CAPACITY: usize = 2_048;
const EVENT_CHANNEL_CAPACITY: usize = 32;

/// Tunables for the supervisor. Tests pass shorter backoffs / lower failure
/// thresholds so the restart path is exercisable in under a second.
#[derive(Debug, Clone)]
pub struct HelperTuning {
    /// Exponential backoff between restart attempts. Index equals consecutive-
    /// failure count minus one (so first retry waits `backoff_steps_ms[0]`, …).
    /// Must not be empty — `new()` debug-asserts this.
    pub backoff_steps_ms: Vec<u64>,
    /// After this many consecutive failures the supervisor demotes permanently.
    /// Must be ≥ 1.
    pub max_consecutive_failures: u32,
    /// Deadline for a single write/read on the framed pipe. Write and each
    /// read (length prefix + body) each get this budget.
    pub per_request_deadline: Duration,
}

impl HelperTuning {
    /// Panics in debug builds if the configuration is degenerate. Release
    /// builds saturate: empty backoff → 0ms delay, 0 max-failures → demotes
    /// on first failure. Neither is graceful, but neither leaves the
    /// supervisor in an unrecoverable state.
    pub fn new(
        backoff_steps_ms: Vec<u64>,
        max_consecutive_failures: u32,
        per_request_deadline: Duration,
    ) -> Self {
        debug_assert!(
            !backoff_steps_ms.is_empty(),
            "HelperTuning::backoff_steps_ms must be non-empty",
        );
        debug_assert!(
            max_consecutive_failures >= 1,
            "HelperTuning::max_consecutive_failures must be >= 1",
        );
        debug_assert!(
            !per_request_deadline.is_zero(),
            "HelperTuning::per_request_deadline must be > 0",
        );
        Self {
            backoff_steps_ms,
            max_consecutive_failures,
            per_request_deadline,
        }
    }
}

impl Default for HelperTuning {
    fn default() -> Self {
        Self::new(
            vec![250, 500, 1_000, 2_000, 5_000],
            5,
            Duration::from_secs(5),
        )
    }
}

struct StderrRing {
    buf: VecDeque<u8>,
    capacity: usize,
}

impl StderrRing {
    fn new(capacity: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn append(&mut self, data: &[u8]) {
        for &b in data {
            if self.buf.len() == self.capacity {
                self.buf.pop_front();
            }
            self.buf.push_back(b);
        }
    }

    fn snapshot(&self) -> String {
        let bytes: Vec<u8> = self.buf.iter().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

struct ChildSlot {
    child: Child,
    /// Stderr drain task; aborted when this slot is dropped. The `_` prefix
    /// signals "owned for its side-effect lifetime"; the only observable exit
    /// is abort-on-drop.
    _stderr_task: JoinHandle<()>,
}

struct SupervisorState {
    slot: Option<ChildSlot>,
    consecutive_failures: u32,
    next_attempt_at: Option<Instant>,
    demoted: bool,
    last_restart: Option<SystemTime>,
    last_version: Option<String>,
    last_model: Option<String>,
    has_succeeded_once: bool,
}

impl SupervisorState {
    fn new() -> Self {
        Self {
            slot: None,
            consecutive_failures: 0,
            next_attempt_at: None,
            demoted: false,
            last_restart: None,
            last_version: None,
            last_model: None,
            has_succeeded_once: false,
        }
    }

    fn cooling_off(&self) -> Option<Duration> {
        self.next_attempt_at
            .and_then(|t| t.checked_duration_since(Instant::now()))
            .filter(|d| !d.is_zero())
    }
}

/// Swift helper runner: persistent child + async supervisor. Talks JSON-over-
/// stdio with 4-byte length framing. See module docs for the recovery model.
pub struct SwiftFoundationHelper {
    binary: PathBuf,
    args: Vec<String>,
    tuning: HelperTuning,
    state: Mutex<SupervisorState>,
    /// Authoritative health snapshot. Updated in lock-step with
    /// `SupervisorState` and readable without contending the async mutex,
    /// so `health()` never lies under load.
    health: parking_lot::RwLock<HelperHealth>,
    stderr: Arc<parking_lot::Mutex<StderrRing>>,
    events: broadcast::Sender<HelperEvent>,
    cache: Arc<ResponseCache>,
    rate: Arc<RateLimiter>,
}

impl SwiftFoundationHelper {
    pub fn new(binary: PathBuf) -> Self {
        Self::with_args(binary, Vec::new())
    }

    /// Construct with explicit CLI args. The real helper takes no args; this is
    /// primarily for driving the test-only stub helper with per-test modes in
    /// a way that is safe across parallel tokio tests (env vars are global
    /// state; argv is per-spawn).
    pub fn with_args(binary: PathBuf, args: Vec<String>) -> Self {
        Self::with_tuning(binary, args, HelperTuning::default())
    }

    /// Construct with explicit supervisor tuning. Used by tests to shrink the
    /// backoff schedule so restart paths are exercisable quickly.
    pub fn with_tuning(binary: PathBuf, args: Vec<String>, tuning: HelperTuning) -> Self {
        let (events, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            binary,
            args,
            tuning,
            state: Mutex::new(SupervisorState::new()),
            health: parking_lot::RwLock::new(HelperHealth::default()),
            stderr: Arc::new(parking_lot::Mutex::new(StderrRing::new(STDERR_CAPACITY))),
            events,
            cache: Arc::new(ResponseCache::new(Duration::from_secs(60 * 10), 1024)),
            rate: Arc::new(RateLimiter::new(10, 5)),
        }
    }

    /// Subscribe to state-transition events. Receivers that fall behind more
    /// than `EVENT_CHANNEL_CAPACITY` messages see `RecvError::Lagged` and
    /// should resync by reading `health()` directly.
    pub fn subscribe_events(&self) -> broadcast::Receiver<HelperEvent> {
        self.events.subscribe()
    }

    fn stderr_snapshot(&self) -> String {
        self.stderr.lock().snapshot()
    }

    /// Publish `health` to the cheap read side. Called after every state
    /// mutation that changes observable health.
    fn publish_health(&self, state: &SupervisorState) {
        let snapshot = HelperHealth {
            running: !state.demoted && state.has_succeeded_once && state.slot.is_some(),
            consecutive_failures: state.consecutive_failures,
            last_restart: state.last_restart,
            version: state.last_version.clone(),
            model: state.last_model.clone(),
        };
        *self.health.write() = snapshot;
    }

    /// Records a successful exchange but does **not** emit the `Ready` event —
    /// that requires version/model strings, which are only known after a
    /// successful `Ping` response is fully parsed. The `ping()` path emits
    /// `Ready` explicitly once it has the values. `record_success` still emits
    /// `Recovered` when a streak of failures clears, since that doesn't depend
    /// on pong fields.
    fn record_success(&self, state: &mut SupervisorState) {
        let was_degraded = state.consecutive_failures > 0 && state.has_succeeded_once;
        state.consecutive_failures = 0;
        state.next_attempt_at = None;
        state.has_succeeded_once = true;
        self.publish_health(state);
        if was_degraded {
            let _ = self.events.send(HelperEvent::Recovered);
        }
    }

    fn record_failure(&self, state: &mut SupervisorState) {
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        state.last_restart = Some(SystemTime::now());
        state.slot = None;
        let steps = &self.tuning.backoff_steps_ms;
        let idx = (state.consecutive_failures as usize)
            .saturating_sub(1)
            .min(steps.len().saturating_sub(1));
        let delay_ms = steps.get(idx).copied().unwrap_or(0);
        state.next_attempt_at = Some(Instant::now() + Duration::from_millis(delay_ms));
        let just_demoted = !state.demoted
            && state.consecutive_failures >= self.tuning.max_consecutive_failures;
        if just_demoted {
            state.demoted = true;
        }
        self.publish_health(state);
        let _ = self.events.send(HelperEvent::Degraded {
            consecutive_failures: state.consecutive_failures,
        });
        if just_demoted {
            let _ = self.events.send(HelperEvent::Demoted);
        }
    }

    /// Spawn a fresh child and attach the stderr drain task. Assumes no existing
    /// child. Records `last_restart` on success.
    async fn spawn_child(&self, state: &mut SupervisorState) -> HelperResult<()> {
        let mut child = Command::new(&self.binary)
            .args(&self.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| HelperError::Spawn(format!("{}: {e}", self.binary.display())))?;

        // Drain stderr into the ring buffer. Ends when the child closes its
        // stderr (on exit). Aborted when the slot is dropped.
        let stderr = child.stderr.take();
        let ring = self.stderr.clone();
        let task = tokio::spawn(async move {
            let Some(mut pipe) = stderr else { return };
            let mut buf = [0u8; 512];
            loop {
                match pipe.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => ring.lock().append(&buf[..n]),
                }
            }
        });

        state.slot = Some(ChildSlot {
            child,
            _stderr_task: task,
        });
        state.last_restart = Some(SystemTime::now());
        self.publish_health(state);
        Ok(())
    }

    async fn exchange(&self, req: HelperRequest) -> HelperResult<HelperResponse> {
        let mut state = self.state.lock().await;

        if state.demoted {
            return Err(HelperError::Unavailable(
                "helper demoted after repeated failures".into(),
            ));
        }
        if let Some(wait) = state.cooling_off() {
            return Err(HelperError::Unavailable(format!(
                "helper in backoff window ({}ms remaining)",
                wait.as_millis()
            )));
        }

        if state.slot.is_none() {
            if let Err(e) = self.spawn_child(&mut state).await {
                self.record_failure(&mut state);
                let stderr = self.stderr_snapshot();
                warn!(target: "local_models", error = %e, stderr = %stderr, "helper spawn failed");
                return Err(HelperError::Unavailable(format!("spawn failed: {e}")));
            }
        }

        let outcome = self.round_trip(&mut state, &req).await;
        match &outcome {
            Ok(_) => self.record_success(&mut state),
            Err(e) => {
                self.record_failure(&mut state);
                let stderr = self.stderr_snapshot();
                warn!(
                    target: "local_models",
                    error = %e,
                    consecutive_failures = state.consecutive_failures,
                    demoted = state.demoted,
                    stderr = %stderr,
                    "helper round-trip failed; scheduled backoff"
                );
            }
        }
        outcome
    }

    async fn round_trip(
        &self,
        state: &mut SupervisorState,
        req: &HelperRequest,
    ) -> HelperResult<HelperResponse> {
        let slot = state
            .slot
            .as_mut()
            .ok_or_else(|| HelperError::Unavailable("no child".into()))?;

        let body = serde_json::to_vec(req)?;
        let mut framed = (body.len() as u32).to_be_bytes().to_vec();
        framed.extend_from_slice(&body);

        let stdin = slot
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| HelperError::Unavailable("no stdin".into()))?;

        let deadline = self.tuning.per_request_deadline;

        tokio::time::timeout(deadline, async {
            stdin.write_all(&framed).await?;
            stdin.flush().await?;
            Ok::<(), std::io::Error>(())
        })
        .await
        .map_err(|_| HelperError::Timeout(deadline))??;

        let stdout = slot
            .child
            .stdout
            .as_mut()
            .ok_or_else(|| HelperError::Unavailable("no stdout".into()))?;

        let mut len_buf = [0u8; 4];
        tokio::time::timeout(deadline, stdout.read_exact(&mut len_buf))
            .await
            .map_err(|_| HelperError::Timeout(deadline))??;
        let len = u32::from_be_bytes(len_buf) as usize;

        let mut body = vec![0u8; len];
        tokio::time::timeout(deadline, stdout.read_exact(&mut body))
            .await
            .map_err(|_| HelperError::Timeout(deadline))??;

        let resp: HelperResponse = serde_json::from_slice(&body)?;
        Ok(resp)
    }
}

#[async_trait]
impl FoundationHelper for SwiftFoundationHelper {
    async fn ping(&self) -> HelperResult<String> {
        match self.exchange(HelperRequest::Ping).await? {
            HelperResponse::Pong { version, model } => {
                let pretty = format!("{version} / {model}");
                let mut state = self.state.lock().await;
                let was_first = state.last_version.is_none();
                state.last_version = Some(version.clone());
                state.last_model = Some(model.clone());
                self.publish_health(&state);
                if was_first {
                    // Emit Ready exactly once per fresh set of version/model
                    // values — typically only after the very first successful
                    // ping, since `last_version` is never cleared. Subsequent
                    // recoveries fire `Recovered` from `record_success`.
                    let _ = self.events.send(HelperEvent::Ready { version, model });
                }
                debug!(target: "local_models", "helper ping ok: {pretty}");
                Ok(pretty)
            }
            HelperResponse::Error { message } => Err(HelperError::Reported(message)),
            other => Err(HelperError::Protocol(format!("unexpected {other:?}"))),
        }
    }

    async fn generate(&self, job: JobKind, prompt: &str) -> HelperResult<String> {
        let key = CacheKey::new(job, prompt);
        if let Some(cached) = self.cache.get(&key) {
            return Ok(cached);
        }
        let wait = self.rate.acquire();
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        match self
            .exchange(HelperRequest::Generate {
                job,
                prompt: prompt.into(),
            })
            .await?
        {
            HelperResponse::Text { text } => {
                self.cache.put(key, text.clone());
                Ok(text)
            }
            HelperResponse::Error { message } => Err(HelperError::Reported(message)),
            other => Err(HelperError::Protocol(format!("unexpected {other:?}"))),
        }
    }

    fn health(&self) -> HelperHealth {
        self.health.read().clone()
    }
}

/// Fallback when the helper isn't installed. Returns deterministic placeholder
/// responses so the rest of the app still works. Emits a WARN on first use.
///
/// **`generate()` output is a diagnostic marker, not a summary.** The returned
/// string (`"[unavailable <job>] <prompt prefix>"`) must not be rendered to
/// the user as if it were real helper output; 13.F surfaces that consume
/// `LocalOps::*` results must check `HelperStatusResponse.kind == "fallback"`
/// and render a skeleton / empty state instead. See
/// `core-docs/integration-notes.md` §12.B for the forward contract.
pub struct NullHelper {
    warned: parking_lot::Mutex<bool>,
}

impl Default for NullHelper {
    fn default() -> Self {
        Self {
            warned: parking_lot::Mutex::new(false),
        }
    }
}

impl NullHelper {
    fn warn_once(&self) {
        let mut w = self.warned.lock();
        if !*w {
            warn!("local-model helper unavailable; using null fallback");
            *w = true;
        }
    }
}

#[async_trait]
impl FoundationHelper for NullHelper {
    async fn ping(&self) -> HelperResult<String> {
        self.warn_once();
        Ok("unavailable".into())
    }

    async fn generate(&self, job: JobKind, prompt: &str) -> HelperResult<String> {
        self.warn_once();
        let preview = prompt.chars().take(80).collect::<String>();
        Ok(format!("[unavailable {:?}] {preview}", job))
    }
}

/// Probe any helper impl with a bounded ping deadline. Used by application
/// boot code to decide between `SwiftFoundationHelper` and `NullHelper`.
/// Returns `HelperError::Timeout` on deadline overrun; other variants flow
/// through unchanged so callers can discriminate via pattern match, not
/// substring search.
pub async fn probe_helper<H: FoundationHelper + ?Sized>(
    helper: Arc<H>,
    deadline: Duration,
) -> HelperResult<String> {
    match tokio::time::timeout(deadline, helper.ping()).await {
        Ok(Ok(pretty)) => {
            info!(target: "local_models", "helper online: {pretty}");
            Ok(pretty)
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err(HelperError::Timeout(deadline)),
    }
}
