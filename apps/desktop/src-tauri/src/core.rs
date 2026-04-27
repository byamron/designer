//! `AppCore` is the wiring hub: one event store, one projector, one
//! orchestrator (Claude Code or mock), one safety apparatus, one local-model
//! helper. Consumers (the Tauri shell, the CLI, tests) hold one `AppCore` and
//! call typed methods.

use async_trait::async_trait;
use designer_audit::{AuditLog, SqliteAuditLog};
use designer_claude::{
    ClaudeCodeOptions, ClaudeCodeOrchestrator, ClaudeSignal, InboxPermissionHandler,
    MockOrchestrator, Orchestrator,
};
use designer_core::{
    Actor, Artifact, ArtifactId, EventPayload, EventStore, ProjectId, Projection, Projector,
    SqliteEventStore, StreamId, StreamOptions, Tab, TabId, TabTemplate, Workspace, WorkspaceId,
};
use designer_ipc::{SpineAltitude, SpineRow, SpineState};
use designer_local_models::{
    probe_helper, FoundationHelper, FoundationLocalOps, HelperError, HelperEvent, HelperHealth,
    LocalOps, NullHelper, SwiftFoundationHelper,
};
use designer_safety::{usd_to_cents, CostCap, CostTracker, CostUsage, InMemoryApprovalGate};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::core_local::SummaryDebounce;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub data_dir: PathBuf,
    pub use_mock_orchestrator: bool,
    #[serde(default)]
    pub claude_options: ClaudeCodeOptions,
    pub default_cost_cap: CostCap,
    /// Absolute path to the Swift Foundation Models helper binary. `None`
    /// forces the `NullHelper` fallback regardless of hardware. Resolved by
    /// `default_in_home()` from (in priority order):
    ///   1. `DESIGNER_HELPER_BINARY` env (absolute path).
    ///   2. Sibling of `current_exe()` when running inside a `.app` bundle
    ///      (Phase-16 production path; `Contents/MacOS/designer-foundation-helper`).
    ///   3. `<workspace>/helpers/foundation/.build/release/designer-foundation-helper`
    ///      when running under Cargo (dev).
    #[serde(default)]
    pub helper_binary_path: Option<PathBuf>,
}

impl AppConfig {
    pub fn default_in_home() -> Self {
        let home_str = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let home = PathBuf::from(home_str);
        let data_dir = home.join(".designer");
        let helper_binary_path = resolve_default_helper_path();
        // Isolate Claude state under `~/.designer/claude-home/` so Designer
        // sessions, teams, inboxes, and approval files don't collide with
        // a user's interactive `claude` CLI or with Conductor's parallel
        // installation. Keeps multi-tool dogfooding sane.
        let claude_options = ClaudeCodeOptions {
            claude_home: Some(data_dir.join("claude-home")),
            // macOS apps launched from Finder/Dock don't inherit the shell
            // PATH — `claude` (typically in `~/.npm-global/bin`) won't be
            // found via bare `Command::new("claude")`. Resolve to an
            // absolute path at boot so the spawn just works.
            binary_path: resolve_claude_binary_path(&home),
            ..ClaudeCodeOptions::default()
        };
        Self {
            data_dir,
            // Real Claude is the daily-driver default. Tests + the demo
            // mode override via `Settings.use_mock_orchestrator` or the
            // `DESIGNER_USE_MOCK` env var.
            use_mock_orchestrator: false,
            claude_options,
            default_cost_cap: CostCap {
                max_dollars_cents: Some(10_00),
                max_tokens: Some(1_000_000),
            },
            helper_binary_path,
        }
    }
}

/// Resolve the `claude` CLI to an absolute path. macOS .app launches
/// inherit a minimal `PATH` from launchd, so the shell paths where `claude`
/// commonly lives (`~/.npm-global/bin`, `/opt/homebrew/bin`, `~/.local/bin`)
/// aren't on PATH. Without this, `Command::new("claude")` fails with ENOENT
/// the moment the user sends their first message.
///
/// Resolution order:
///   1. `DESIGNER_CLAUDE_BINARY` env override (absolute path).
///   2. Common install locations.
///   3. `$SHELL -lc 'command -v claude'` — runs the user's actual login
///      shell so PATH set in `.zshrc` (default on macOS) is honored.
///      `bash -l` would only read `.profile`/`.bash_profile`, missing the
///      zsh-only paths that nvm / asdf / bun / yarn typically add.
///   4. `None` — fall back to bare `"claude"`. Will fail if not on PATH;
///      the boot preflight in `main.rs` surfaces the error to the user.
fn resolve_claude_binary_path(home: &Path) -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("DESIGNER_CLAUDE_BINARY") {
        let p = PathBuf::from(&override_path);
        if p.is_absolute() && p.is_file() {
            info!(path = %p.display(), "claude path from DESIGNER_CLAUDE_BINARY");
            return Some(p);
        }
        warn!(
            override_path = %override_path,
            "DESIGNER_CLAUDE_BINARY set but path is not an absolute file; ignoring override and falling back"
        );
    }

    // Skip path-based candidates if HOME isn't set — relative `.`-rooted
    // paths would silently miss against launchd's `/` cwd.
    if home != Path::new(".") {
        let home_candidates: [PathBuf; 6] = [
            home.join(".npm-global/bin/claude"),
            home.join(".bun/bin/claude"),
            home.join(".yarn/bin/claude"),
            home.join(".asdf/shims/claude"),
            home.join(".local/bin/claude"),
            home.join(".cargo/bin/claude"),
        ];
        for p in &home_candidates {
            if p.is_file() {
                info!(path = %p.display(), "claude path resolved from common location");
                return Some(p.clone());
            }
        }
    }
    let system_candidates: [&str; 3] = [
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        "/usr/bin/claude",
    ];
    for p in &system_candidates {
        let path = PathBuf::from(p);
        if path.is_file() {
            info!(path = p, "claude path resolved from common location");
            return Some(path);
        }
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    if let Ok(out) = std::process::Command::new(&shell)
        .args(["-lc", "command -v claude"])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                let p = PathBuf::from(&s);
                if p.is_absolute() && p.is_file() {
                    info!(path = %s, shell = %shell, "claude path resolved via login shell");
                    return Some(p);
                }
            }
        }
    }

    warn!("could not resolve claude binary; falling back to bare `claude` (will likely fail)");
    None
}

/// Resolve the default helper binary path without spawning anything. See
/// `AppConfig::helper_binary_path` for the priority order.
fn resolve_default_helper_path() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("DESIGNER_HELPER_BINARY") {
        let p = PathBuf::from(override_path);
        if p.is_absolute() {
            info!(target: "local_models", path = %p.display(), "helper path from DESIGNER_HELPER_BINARY");
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let in_bundle = exe.ancestors().any(|p| p.ends_with("Contents/MacOS"));
        if in_bundle {
            if let Some(dir) = exe.parent() {
                let p = dir.join("designer-foundation-helper");
                info!(target: "local_models", path = %p.display(), "helper path resolved inside .app bundle");
                return Some(p);
            }
        }
    }

    // Dev path: walk up from CARGO_MANIFEST_DIR to the workspace root.
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let start = PathBuf::from(manifest);
        for dir in start.ancestors() {
            if dir.join("Cargo.toml").exists() && dir.join("helpers").exists() {
                let p = dir.join("helpers/foundation/.build/release/designer-foundation-helper");
                info!(target: "local_models", path = %p.display(), "helper path resolved at workspace dev location");
                return Some(p);
            }
        }
    }

    info!(target: "local_models", "no helper path resolved; NullHelper will be used");
    None
}

/// Boot-time status of the local-model helper. Decided once at `AppCore::boot`;
/// runtime health (restarts, current streak) lives on the helper itself and is
/// observable via `AppCore::helper_health()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperStatus {
    pub kind: HelperStatusKind,
    pub fallback_reason: Option<FallbackReason>,
    pub binary_path: Option<PathBuf>,
    pub version: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HelperStatusKind {
    /// `SwiftFoundationHelper` passed the boot probe and is driving requests.
    Live,
    /// `NullHelper` is active — see `fallback_reason`.
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FallbackReason {
    /// Operator forced fallback via `DESIGNER_DISABLE_HELPER=1`.
    UserDisabled,
    /// `helper_binary_path` is `None` — no install detected.
    NotConfigured,
    /// Path is configured but the file does not exist or is not executable.
    BinaryMissing { path: PathBuf },
    /// Binary exists but `ping()` exceeded the boot deadline.
    PingTimeout,
    /// Binary spawned and reported `macos-too-old`. Terminal — no retry will help.
    UnsupportedOs,
    /// Binary spawned and reported `foundation-models-unavailable` (Apple Intelligence
    /// not enabled on this Mac, framework not linkable). Terminal on current hardware.
    ModelsUnavailable,
    /// Binary spawned and responded with some other error. `error` is the
    /// helper's verbatim message (may include Apple's error description).
    PingFailed { error: String },
}

impl FallbackReason {
    /// Whether the user can recover from this fallback. Pre-computed here so
    /// the IPC DTO and any future UI don't re-derive the routing.
    pub fn recovery(&self) -> RecoveryKind {
        match self {
            FallbackReason::UserDisabled => RecoveryKind::User,
            FallbackReason::BinaryMissing { .. } => RecoveryKind::Reinstall,
            FallbackReason::NotConfigured => RecoveryKind::Reinstall,
            FallbackReason::PingTimeout => RecoveryKind::Reinstall,
            FallbackReason::PingFailed { .. } => RecoveryKind::Reinstall,
            FallbackReason::UnsupportedOs | FallbackReason::ModelsUnavailable => RecoveryKind::None,
        }
    }
}

/// Whether a fallback is self-recoverable. Controls whether the UI offers a
/// retry affordance.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryKind {
    /// User can flip an env var / config toggle.
    User,
    /// Reinstall or rebuild the helper binary.
    Reinstall,
    /// Not recoverable on current hardware/OS; don't offer retry.
    None,
}

pub struct AppCore {
    pub config: AppConfig,
    pub store: Arc<SqliteEventStore>,
    pub projector: Projector,
    pub orchestrator: Arc<dyn Orchestrator>,
    pub audit: Arc<dyn AuditLog>,
    pub gate: Arc<InMemoryApprovalGate<SqliteEventStore>>,
    pub cost: CostTracker<SqliteEventStore>,
    pub helper: Arc<dyn FoundationHelper>,
    pub local_ops: Arc<dyn LocalOps>,
    pub helper_status: HelperStatus,
    /// When the helper is live, an existing `broadcast::Sender` forwards
    /// `HelperEvent`s from the supervisor. `None` when the NullHelper is
    /// active (there's nothing to transition). 13.F subscribes via
    /// `AppCore::subscribe_helper_events()`.
    pub(crate) helper_events: Option<broadcast::Sender<HelperEvent>>,
    /// Per-track debounce cache backing the write-time summary hook (Phase
    /// 13.F). See `core_local::SummaryDebounce` for semantics.
    pub summary_debounce: Arc<SummaryDebounce>,
}

#[async_trait]
pub trait AppCoreBoot {
    async fn boot(config: AppConfig) -> designer_core::Result<Arc<AppCore>>;
}

/// Boot deadline for the helper's first ping. Accommodates a cold Swift process
/// start + Foundation Models session warm-up without being so loose that boot
/// hangs visibly when the helper is actually broken.
const HELPER_BOOT_DEADLINE: Duration = Duration::from_millis(750);

#[async_trait]
impl AppCoreBoot for AppCore {
    async fn boot(config: AppConfig) -> designer_core::Result<Arc<AppCore>> {
        AppCore::boot_with_orchestrator(config, None).await
    }
}

impl AppCore {
    /// Boot path with an optional pre-supplied orchestrator. Production callers
    /// pass `None` so AppCore picks Claude vs. Mock from `config`; tests pass
    /// `Some(...)` to inject a mock whose `signals()` sender they retain a
    /// handle to (Phase 13.H/F3 cost-subscriber test).
    pub async fn boot_with_orchestrator(
        config: AppConfig,
        orchestrator_override: Option<Arc<dyn Orchestrator>>,
    ) -> designer_core::Result<Arc<AppCore>> {
        let store = Arc::new(SqliteEventStore::open(config.data_dir.join("events.db"))?);
        let projector = Projector::new();

        // Replay history into the projector before live events.
        let history = store.read_all(StreamOptions::default()).await?;
        projector.replay(&history);

        let audit: Arc<dyn AuditLog> = Arc::new(SqliteAuditLog::new(store.clone()));
        let gate = Arc::new(InMemoryApprovalGate::new(store.clone()));
        let cost = CostTracker::new(store.clone(), config.default_cost_cap);
        // Replay historical CostRecorded events into the tracker's in-memory
        // map. Without this, the cap check silently allows a workspace to
        // double-spend after a restart and the topbar chip reads $0.00
        // until the next CostRecorded event lands.
        if let Err(err) = cost.replay_from_store().await {
            warn!(error = %err, "cost-tracker replay failed; usage will start at zero");
        }
        // Replay historical ApprovalRequested/Granted/Denied events into the
        // gate so `gate.status(id)` is truthful for legacy gate consumers
        // post-restart. The inbox handler is the production source of
        // truth, but the gate stays the trait surface other crates can hold
        // an `Arc<dyn ApprovalGate>` against.
        if let Err(err) = gate.replay_from_store().await {
            warn!(error = %err, "approval-gate replay failed; gate.status may lie until next request");
        }

        // Phase 13.G installs the inbox permission handler as the production
        // default; AutoAcceptSafeTools remains the test/mock-orchestrator
        // default so existing tests don't have to wait on a (never-arriving)
        // user resolve. The handler is a process-global so the IPC layer
        // (`cmd_resolve_approval`) and the orchestrator (caller of `decide`)
        // share a single instance. The gate adapter keeps `gate.status(id)`
        // truthful by mirroring inbox-routed resolutions into the gate's
        // in-memory map.
        let gate_sink: Arc<dyn designer_claude::GateStatusSink> =
            Arc::new(crate::core_safety::GateSinkAdapter::new(gate.clone()));
        let inbox_handler =
            Arc::new(InboxPermissionHandler::new(store.clone()).with_gate_sink(gate_sink));
        let inbox_handler = crate::core_safety::install_inbox_handler(inbox_handler);

        let orchestrator: Arc<dyn Orchestrator> = match orchestrator_override {
            Some(o) => o,
            None if config.use_mock_orchestrator => Arc::new(MockOrchestrator::new(store.clone())),
            None => Arc::new(
                ClaudeCodeOrchestrator::new(store.clone(), config.claude_options.clone())
                    .with_permission_handler(inbox_handler.clone()),
            ),
        };

        let (helper, helper_status, helper_events) = select_helper(&config).await;
        let local_ops: Arc<dyn LocalOps> = Arc::new(FoundationLocalOps::new(helper.clone()));

        // Subscribe before any first event is broadcast; the cost subscriber
        // task holds a `Weak<AppCore>` so it terminates when the core drops.
        let signal_rx = orchestrator.subscribe_signals();

        let core = Arc::new(AppCore {
            config,
            store,
            projector,
            orchestrator,
            audit,
            gate,
            cost,
            helper,
            local_ops,
            helper_status,
            helper_events,
            summary_debounce: Arc::new(SummaryDebounce::new()),
        });
        spawn_cost_subscriber(Arc::downgrade(&core), signal_rx);
        core.spawn_projector_task();
        // Replay safety (Phase 13.G): every `ApprovalRequested` event
        // without a matching grant/deny resolves to a process-restart
        // denial so the inbox doesn't surface phantom rows for sessions
        // whose subprocess is gone. Failure is logged but non-fatal —
        // boot must still succeed.
        match core.sweep_orphan_approvals().await {
            Ok(0) => {}
            Ok(n) => info!(orphans = n, "swept orphan approvals on boot"),
            Err(err) => warn!(error = %err, "orphan-approval sweep failed"),
        }
        info!("app core booted");
        Ok(core)
    }
}

/// Decide between `SwiftFoundationHelper` and `NullHelper` based on env,
/// config, and a bounded boot-time ping. Returns the chosen helper, a
/// structured status for IPC/diagnostics, and (for live helpers) a broadcast
/// `Sender` so 13.F consumers can subscribe to state transitions.
pub async fn select_helper(
    config: &AppConfig,
) -> (
    Arc<dyn FoundationHelper>,
    HelperStatus,
    Option<broadcast::Sender<HelperEvent>>,
) {
    if std::env::var("DESIGNER_DISABLE_HELPER").ok().as_deref() == Some("1") {
        warn!(target: "local_models", "helper disabled via DESIGNER_DISABLE_HELPER");
        return (
            Arc::new(NullHelper::default()),
            HelperStatus {
                kind: HelperStatusKind::Fallback,
                fallback_reason: Some(FallbackReason::UserDisabled),
                binary_path: config.helper_binary_path.clone(),
                version: None,
                model: None,
            },
            None,
        );
    }

    let Some(path) = config.helper_binary_path.clone() else {
        return (
            Arc::new(NullHelper::default()),
            HelperStatus {
                kind: HelperStatusKind::Fallback,
                fallback_reason: Some(FallbackReason::NotConfigured),
                binary_path: None,
                version: None,
                model: None,
            },
            None,
        );
    };

    if !path.is_file() {
        warn!(
            target: "local_models",
            binary = %path.display(),
            "helper binary missing; using NullHelper"
        );
        return (
            Arc::new(NullHelper::default()),
            HelperStatus {
                kind: HelperStatusKind::Fallback,
                fallback_reason: Some(FallbackReason::BinaryMissing { path: path.clone() }),
                binary_path: Some(path),
                version: None,
                model: None,
            },
            None,
        );
    }

    let live = Arc::new(SwiftFoundationHelper::new(path.clone()));
    let events = live.subscribe_events(); // take before we maybe discard the helper
                                          // We need the Sender side separately so we can hand a Sender to AppCore
                                          // for re-subscribe. The supervisor owns the only Sender, so bridge through
                                          // a small forwarding task.
    let bridge = build_event_bridge(events);

    let probe_helper_ref: Arc<dyn FoundationHelper> = live.clone();
    match probe_helper(probe_helper_ref, HELPER_BOOT_DEADLINE).await {
        Ok(_pretty) => {
            let health = live.health();
            (
                live,
                HelperStatus {
                    kind: HelperStatusKind::Live,
                    fallback_reason: None,
                    binary_path: Some(path),
                    version: health.version,
                    model: health.model,
                },
                Some(bridge),
            )
        }
        Err(e) => {
            let reason = fallback_reason_from_probe_error(&e);
            warn!(
                target: "local_models",
                binary = %path.display(),
                error = %e,
                ?reason,
                "helper boot probe failed; using NullHelper"
            );
            (
                Arc::new(NullHelper::default()),
                HelperStatus {
                    kind: HelperStatusKind::Fallback,
                    fallback_reason: Some(reason),
                    binary_path: Some(path),
                    version: None,
                    model: None,
                },
                None,
            )
        }
    }
}

/// Pure mapping from a probe error to a `FallbackReason`. Discriminates on
/// `HelperError` variants (not error-message substring) so changing a format
/// string can't silently reroute. The one place we still string-match is on
/// `Reported`, where the helper emits documented machine tags
/// (`"macos-too-old"`, `"foundation-models-unavailable"`) as its contract.
pub fn fallback_reason_from_probe_error(e: &HelperError) -> FallbackReason {
    match e {
        HelperError::Timeout(_) => FallbackReason::PingTimeout,
        HelperError::Reported(msg) if msg == "macos-too-old" => FallbackReason::UnsupportedOs,
        HelperError::Reported(msg) if msg == "foundation-models-unavailable" => {
            FallbackReason::ModelsUnavailable
        }
        other => FallbackReason::PingFailed {
            error: other.to_string(),
        },
    }
}

/// Drive a `broadcast::Receiver<T>` to completion on a tokio task, invoking
/// `handler` per event. Lagged warns (with the dropped count) so silent
/// back-pressure is observable in support bundles; Closed exits cleanly.
/// Sync handler — async work belongs in a `tokio::spawn` inside the closure.
fn forward_broadcast<T, F>(mut rx: broadcast::Receiver<T>, mut handler: F)
where
    T: Clone + Send + 'static,
    F: FnMut(T) + Send + 'static,
{
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => handler(ev),
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        skipped,
                        event_type = std::any::type_name::<T>(),
                        "forward_broadcast: receiver lagged; events dropped"
                    );
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Turn a `broadcast::Receiver` from the supervisor into a `broadcast::Sender`
/// that AppCore can hand out fresh receivers from. We could expose the
/// supervisor's own `Sender` directly, but that leaks the helper's internal
/// channel and ties AppCore to `SwiftFoundationHelper` instead of
/// `Arc<dyn FoundationHelper>`. The forwarding task costs one tokio spawn
/// per AppCore boot, which is negligible.
fn build_event_bridge(rx: broadcast::Receiver<HelperEvent>) -> broadcast::Sender<HelperEvent> {
    let (tx, _) = broadcast::channel(32);
    let tx_clone = tx.clone();
    forward_broadcast(rx, move |ev| {
        let _ = tx_clone.send(ev);
    });
    tx
}

/// Listen on the orchestrator's `ClaudeSignal` broadcast and route every
/// `Cost` signal through [`CostTracker::record`] (which appends
/// `EventPayload::CostRecorded` and updates the in-memory usage map). Holds a
/// `Weak<AppCore>` so the task short-circuits once the core drops — the
/// orchestrator (and its broadcast sender) are owned by AppCore, so the
/// underlying channel will close on the next iteration anyway.
fn spawn_cost_subscriber(weak: std::sync::Weak<AppCore>, rx: broadcast::Receiver<ClaudeSignal>) {
    forward_broadcast(rx, move |signal| {
        let ClaudeSignal::Cost {
            workspace_id,
            total_cost_usd,
        } = signal
        else {
            return;
        };
        let Some(core) = weak.upgrade() else {
            return;
        };
        if !total_cost_usd.is_finite() || total_cost_usd <= 0.0 {
            // Anomaly on Anthropic's side or a future zero-cost result —
            // log so support bundles surface it, then skip the DB write
            // since there's nothing to project.
            warn!(
                workspace = %workspace_id,
                total_cost_usd,
                "cost subscriber: non-positive or non-finite cost; skipping"
            );
            return;
        }
        let usage = CostUsage {
            tokens_input: 0,
            tokens_output: 0,
            dollars_cents: usd_to_cents(total_cost_usd),
        };
        // `record` is async; spawn so the broadcast loop keeps draining
        // signals while the DB append is in flight. `CostTracker` is
        // DashMap-backed and uses saturating_add per entry, so concurrent
        // records on the same workspace remain correct.
        tokio::spawn(async move {
            if let Err(err) = core.cost.record(workspace_id, usage, Actor::system()).await {
                warn!(
                    workspace = %workspace_id,
                    cents = usage.dollars_cents,
                    error = %err,
                    "cost subscriber: record failed"
                );
            }
        });
    });
}

impl AppCore {
    fn spawn_projector_task(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            let mut rx = me.store.subscribe();
            while let Ok(event) = rx.recv().await {
                me.projector.apply(&event);
            }
        });
    }

    /// Runtime snapshot of the local-model helper. Combines the boot-time
    /// selection (kind + fallback reason) with live supervisor state
    /// (consecutive failures, last restart). Cheap; intended for an IPC poll.
    pub fn helper_health(&self) -> (HelperStatus, HelperHealth) {
        (self.helper_status.clone(), self.helper.health())
    }

    /// Subscribe to helper state-transition events. Returns `None` when the
    /// NullHelper is active — no transitions are possible. Subscribers that
    /// fall behind see `broadcast::error::RecvError::Lagged` and should
    /// re-read `helper_health()` to resync.
    pub fn subscribe_helper_events(&self) -> Option<broadcast::Receiver<HelperEvent>> {
        self.helper_events.as_ref().map(|tx| tx.subscribe())
    }

    pub async fn create_project(
        &self,
        name: String,
        root_path: PathBuf,
    ) -> designer_core::Result<designer_core::Project> {
        let id = ProjectId::new();
        let env = self
            .store
            .append(
                StreamId::Project(id),
                None,
                Actor::user(),
                EventPayload::ProjectCreated {
                    project_id: id,
                    name,
                    root_path,
                },
            )
            .await?;
        // Apply synchronously so the caller's subsequent read sees the write,
        // independent of the broadcast-subscriber task scheduling.
        self.projector.apply(&env);
        self.projector
            .project(id)
            .ok_or_else(|| designer_core::CoreError::NotFound(id.to_string()))
    }

    pub async fn create_workspace(
        &self,
        project_id: ProjectId,
        name: String,
        base_branch: String,
    ) -> designer_core::Result<Workspace> {
        let id = WorkspaceId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(id),
                None,
                Actor::user(),
                EventPayload::WorkspaceCreated {
                    workspace_id: id,
                    project_id,
                    name,
                    base_branch,
                },
            )
            .await?;
        self.projector.apply(&env);
        self.projector
            .workspace(id)
            .ok_or_else(|| designer_core::CoreError::NotFound(id.to_string()))
    }

    pub async fn list_projects(&self) -> Vec<designer_core::Project> {
        self.projector.projects()
    }

    pub async fn workspaces_in(&self, project_id: ProjectId) -> Vec<Workspace> {
        self.projector.workspaces_in(project_id)
    }

    pub async fn open_tab(
        &self,
        workspace_id: WorkspaceId,
        title: String,
        template: TabTemplate,
    ) -> designer_core::Result<Tab> {
        let tab_id = TabId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id,
                    workspace_id,
                    title,
                    template,
                },
            )
            .await?;
        self.projector.apply(&env);
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| designer_core::CoreError::NotFound(workspace_id.to_string()))?;
        workspace
            .tabs
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| designer_core::CoreError::NotFound(tab_id.to_string()))
    }

    /// Derive an activity-spine view from the projector. Summaries are `None`
    /// here; Phase 13.F replaces them with `LocalOps::summarize_row` output.
    pub async fn spine(&self, workspace_id: Option<WorkspaceId>) -> Vec<SpineRow> {
        match workspace_id {
            None => self
                .projector
                .projects()
                .into_iter()
                .map(|p| {
                    let count = self.projector.workspaces_in(p.id).len();
                    SpineRow {
                        id: p.id.to_string(),
                        altitude: SpineAltitude::Project,
                        label: p.name,
                        summary: Some(format!(
                            "{count} workspace{}",
                            if count == 1 { "" } else { "s" }
                        )),
                        state: SpineState::Idle,
                        children: vec![],
                    }
                })
                .collect(),
            Some(id) => {
                // Workspace-altitude view: one row per agent is Phase-13 territory;
                // until then, return a single placeholder row keyed to the
                // workspace itself so the surface renders without stubs.
                let Some(w) = self.projector.workspace(id) else {
                    return vec![];
                };
                vec![SpineRow {
                    id: w.id.to_string(),
                    altitude: SpineAltitude::Workspace,
                    label: w.name,
                    summary: Some(format!("state: {:?}", w.state).to_lowercase()),
                    state: match w.state {
                        designer_core::WorkspaceState::Active => SpineState::Active,
                        designer_core::WorkspaceState::Paused => SpineState::Idle,
                        designer_core::WorkspaceState::Archived => SpineState::Idle,
                        designer_core::WorkspaceState::Errored => SpineState::Errored,
                    },
                    children: vec![],
                }]
            }
        }
    }

    /// Full replay — used when an external writer (tests, repair tools) modifies
    /// the log outside `AppCore`. In the steady state, `apply` on each append
    /// keeps the projector current without touching the log.
    pub async fn sync_projector_from_log(&self) -> designer_core::Result<()> {
        let all = self.store.read_all(StreamOptions::default()).await?;
        self.projector.replay(&all);
        Ok(())
    }

    // ------------------------------------------------------------------
    // Artifact foundation (Phase 13.1). Emitters land in 13.D / 13.E /
    // 13.F / 13.G — this crate just exposes the projected reads + the
    // pin/unpin write path so the UI can ship.
    // ------------------------------------------------------------------

    pub async fn list_pinned_artifacts(&self, workspace_id: WorkspaceId) -> Vec<Artifact> {
        self.projector.pinned_artifacts(workspace_id)
    }

    pub async fn list_artifacts(&self, workspace_id: WorkspaceId) -> Vec<Artifact> {
        self.projector.artifacts_in(workspace_id)
    }

    pub async fn get_artifact(&self, id: ArtifactId) -> Option<Artifact> {
        self.projector.artifact(id)
    }

    pub async fn toggle_pin_artifact(
        &self,
        artifact_id: ArtifactId,
    ) -> designer_core::Result<bool> {
        let Some(a) = self.projector.artifact(artifact_id) else {
            return Err(designer_core::CoreError::NotFound(artifact_id.to_string()));
        };
        let stream = StreamId::Workspace(a.workspace_id);
        let payload = if a.pinned_at.is_some() {
            EventPayload::ArtifactUnpinned { artifact_id }
        } else {
            EventPayload::ArtifactPinned { artifact_id }
        };
        let env = self
            .store
            .append(stream, None, Actor::user(), payload)
            .await?;
        self.projector.apply(&env);
        // New pin state = !old.
        Ok(a.pinned_at.is_none())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_safety::CostCap;
    use tempfile::tempdir;

    async fn boot_test_core() -> Arc<AppCore> {
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            // Force NullHelper in tests — no accidental dependency on a local
            // Swift build. The helper-selection path is exercised directly in
            // the two pure tests below.
            helper_binary_path: None,
        };
        // Leak the tempdir so the path stays live for the core's lifetime.
        std::mem::forget(dir);
        AppCore::boot(config).await.unwrap()
    }

    #[test]
    fn fallback_reason_maps_from_helper_error() {
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Timeout(Duration::from_millis(100))),
            FallbackReason::PingTimeout
        ));
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Reported("macos-too-old".into())),
            FallbackReason::UnsupportedOs
        ));
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Reported(
                "foundation-models-unavailable".into(),
            )),
            FallbackReason::ModelsUnavailable
        ));
        match fallback_reason_from_probe_error(&HelperError::Reported("other-error".into())) {
            FallbackReason::PingFailed { error } => assert!(error.contains("other-error")),
            other => panic!("expected PingFailed, got {other:?}"),
        }
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Spawn("nope".into())),
            FallbackReason::PingFailed { .. }
        ));
    }

    #[test]
    fn recovery_kind_matches_taxonomy() {
        assert_eq!(FallbackReason::UserDisabled.recovery(), RecoveryKind::User);
        assert_eq!(
            FallbackReason::NotConfigured.recovery(),
            RecoveryKind::Reinstall
        );
        assert_eq!(
            FallbackReason::BinaryMissing {
                path: PathBuf::from("/missing")
            }
            .recovery(),
            RecoveryKind::Reinstall
        );
        assert_eq!(
            FallbackReason::PingTimeout.recovery(),
            RecoveryKind::Reinstall
        );
        assert_eq!(FallbackReason::UnsupportedOs.recovery(), RecoveryKind::None);
        assert_eq!(
            FallbackReason::ModelsUnavailable.recovery(),
            RecoveryKind::None
        );
        assert_eq!(
            FallbackReason::PingFailed { error: "x".into() }.recovery(),
            RecoveryKind::Reinstall
        );
    }

    #[tokio::test]
    async fn open_tab_appends_and_projects() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab = core
            .open_tab(ws.id, "Plan".into(), TabTemplate::Plan)
            .await
            .unwrap();
        assert_eq!(tab.title, "Plan");
        let refreshed = core.projector.workspace(ws.id).unwrap();
        assert_eq!(refreshed.tabs.len(), 1);
        assert_eq!(refreshed.tabs[0].id, tab.id);
    }

    #[tokio::test]
    async fn spine_project_altitude_counts_workspaces() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let _ = core
            .create_workspace(p.id, "a".into(), "main".into())
            .await
            .unwrap();
        let _ = core
            .create_workspace(p.id, "b".into(), "main".into())
            .await
            .unwrap();

        let rows = core.spine(None).await;
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.altitude, SpineAltitude::Project);
        assert_eq!(row.label, "P");
        assert_eq!(row.summary.as_deref(), Some("2 workspaces"));
    }

    #[tokio::test]
    async fn spine_workspace_altitude_maps_state() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let w = core
            .create_workspace(p.id, "ws".into(), "main".into())
            .await
            .unwrap();

        let rows = core.spine(Some(w.id)).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].altitude, SpineAltitude::Workspace);
        // Default WorkspaceState::Active maps to SpineState::Active.
        assert!(matches!(rows[0].state, SpineState::Active));
    }

    #[tokio::test]
    async fn spine_unknown_workspace_returns_empty() {
        let core = boot_test_core().await;
        let rows = core.spine(Some(WorkspaceId::new())).await;
        assert!(rows.is_empty());
    }

    /// F3: a `ClaudeSignal::Cost` broadcast lands as `CostTracker::record` —
    /// in-memory usage updates AND a `CostRecorded` event hits the store.
    /// Without this wiring the cost chip would read $0.00 forever and the cap
    /// check would silently allow over-budget spend.
    #[tokio::test]
    async fn signal_subscriber_records_to_store() {
        let dir = tempdir().unwrap();
        // Build a fresh in-memory event store + mock orchestrator so we own
        // the signal sender side.
        let store = Arc::new(SqliteEventStore::open(dir.path().join("events.db")).unwrap());
        let mock = Arc::new(MockOrchestrator::new(store.clone()));
        let signals_tx = mock.signals();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        let core = AppCore::boot_with_orchestrator(config, Some(mock.clone()))
            .await
            .unwrap();

        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        // Broadcast a $0.42 cost. The subscriber rounds to 42 cents.
        signals_tx
            .send(ClaudeSignal::Cost {
                workspace_id: ws.id,
                total_cost_usd: 0.42,
            })
            .expect("subscriber receiving");

        // Poll until the in-memory tracker reflects the spend (subscriber is
        // a tokio task; it runs concurrently).
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            if core.cost.usage(ws.id).dollars_cents == 42 {
                break;
            }
            if std::time::Instant::now() > deadline {
                panic!(
                    "cost subscriber did not record within deadline; saw {}",
                    core.cost.usage(ws.id).dollars_cents
                );
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        // And the event log carries a `CostRecorded` row for the workspace.
        let events = core.store.read_all(StreamOptions::default()).await.unwrap();
        let cost_events = events
            .iter()
            .filter(|env| {
                matches!(
                    env.payload,
                    EventPayload::CostRecorded {
                        dollars_cents: 42,
                        ..
                    }
                )
            })
            .count();
        assert_eq!(cost_events, 1, "expected one CostRecorded event");
    }
}
