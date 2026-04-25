//! Real Claude Code orchestrator.
//!
//! Spawns `claude` as a long-lived subprocess per workspace with agent teams
//! enabled, drives it through `--input-format stream-json`, translates its
//! `--output-format stream-json` back into `OrchestratorEvent`s via
//! [`ClaudeStreamTranslator`]. See `core-docs/integration-notes.md` for the
//! exact CLI surface and event shapes we code against.
//!
//! **Compliance:** we never touch Claude auth. `claude` handles its own
//! credentials (keychain OAuth). Designer only invokes the binary; Anthropic
//! is the only party ever in the auth path. See spec Decision 26 and FB-0016.
//!
//! **Resume / recovery:** Claude Code's in-process teammates do not survive
//! `/resume`. The orchestrator derives a deterministic lead session id from
//! the workspace id so reconnects are stable; when the lead notices stale
//! teammate references after a resume, it is expected to respawn them (per
//! the docs).
//!
//! **Known scope limits (v1 — will be addressed in later phases):**
//!
//! 1. *Unexpected child death* is not surfaced as an `OrchestratorEvent`. If
//!    the `claude` subprocess crashes or is killed externally, the reader
//!    task exits on EOF and subsequent writes fail silently. `kill_on_drop`
//!    prevents process leaks. A death-watch task that emits `AgentErrored`
//!    is tracked for 13.D.
//! 2. *Partial-message coalescing* (D3 decision — 120ms backend coalesce for
//!    `stream_event` partials → per-UI live-chat render) is not implemented.
//!    The translator currently drops `stream_event` entirely. 13.D owns this
//!    when the UI wire is built.
//! 3. *Double `spawn_team` for the same workspace* silently overwrites the
//!    prior handle; `kill_on_drop` cleans up the old child. Callers should
//!    call `shutdown()` explicitly first. Matches `MockOrchestrator`'s
//!    contract for parity.

use crate::orchestrator::{
    Orchestrator, OrchestratorError, OrchestratorEvent, OrchestratorResult, TaskAssignment,
    TeamSpec,
};
use crate::permission::{AutoAcceptSafeTools, PermissionHandler};
use crate::stream::{ClaudeStreamTranslator, TranslatorOutput};
use async_trait::async_trait;
use designer_core::{Actor, EventPayload, EventStore, StreamId, WorkspaceId};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Deterministic namespace so lead session ids derived from workspace ids stay
/// stable across Designer restarts. Value is a fixed v4 UUID generated once
/// for this project; never rotate — that would break resume.
const SESSION_NAMESPACE: Uuid = Uuid::from_u128(0x5d3e_7c4a_1f20_4c8e_a9d3_6b7e_2f15_8e01);

/// How long to wait for the lead to gracefully shut down before we `start_kill`
/// the child. Per spec Decision 31 follow-up / integration-notes.md: 60s
/// matches the industry-standard graceful-to-force escalation window and
/// accommodates the documented "shutdown can be slow" limitation.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClaudeCodeOptions {
    /// Path to the `claude` binary. Resolved via `PATH` when None.
    pub binary_path: Option<PathBuf>,
    /// Claude config root. Defaults to `~/.claude/`.
    pub claude_home: Option<PathBuf>,
    /// Extra environment variables to forward.
    #[serde(default)]
    pub extra_env: std::collections::BTreeMap<String, String>,
    /// Working directory for the subprocess (typically the track's worktree).
    pub cwd: Option<PathBuf>,
    /// Model override for the lead. When None, Claude picks per its own
    /// defaults (spec Decision 31 follow-up: option (a), user can override
    /// per-turn from the chat model selector).
    pub model: Option<String>,
    /// Max turns before the subprocess exits. Defaults to 1000 (matches
    /// Conductor's observed invocation).
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
}

fn default_max_turns() -> u32 {
    1000
}

/// State for a single live team (one subprocess + its I/O tasks).
struct TeamHandle {
    /// Bytes to write to the lead's stdin. Each `send` is expected to be a
    /// single JSON line with a trailing `\n`.
    stdin_tx: mpsc::Sender<Vec<u8>>,
    /// Background tasks owning stdin/stdout/stderr. Aborted on shutdown.
    reader_task: JoinHandle<()>,
    writer_task: JoinHandle<()>,
    stderr_task: JoinHandle<()>,
    /// Child handle for `start_kill` on forced shutdown.
    child: Child,
    /// Deterministic session id used when spawning. Stored so `assign_task`
    /// / `post_message` can log coherent context.
    #[allow(dead_code)]
    lead_session_id: Uuid,
}

pub struct ClaudeCodeOrchestrator<S: EventStore> {
    store: Arc<S>,
    options: ClaudeCodeOptions,
    tx: broadcast::Sender<OrchestratorEvent>,
    /// Optional tap for rate-limit info and per-turn cost signals. Decoupled
    /// from the main event broadcast so UI-only consumers (the usage chip,
    /// CostTracker) can subscribe independently.
    signal_tx: broadcast::Sender<ClaudeSignal>,
    teams: Mutex<HashMap<WorkspaceId, TeamHandle>>,
    /// Policy deciding whether a permission-prompted tool use should be
    /// accepted or denied. Default is [`AutoAcceptSafeTools`] (read-only
    /// tools + safe `Bash` prefixes); Phase 13.G replaces this with an
    /// inbox-routing handler via [`Self::with_permission_handler`].
    /// Reserved by Phase 13.0 scaffolding so 13.D and 13.G don't fight over
    /// the stdio permission code path. TODO(13.D): wire this into the
    /// stdio permission-prompt reader once the subprocess protocol is
    /// plumbed.
    #[allow(dead_code)]
    permission_handler: Arc<dyn PermissionHandler>,
}

/// Side-channel signals. Not part of the normalized `OrchestratorEvent`
/// surface because they don't represent agent-team lifecycle — they are
/// platform-level telemetry that specific consumers (Decision 34 usage chip,
/// `CostTracker`) subscribe to directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClaudeSignal {
    /// Rate-limit info payload as emitted by Claude (passthrough).
    RateLimit(serde_json::Value),
    /// Per-turn cost in USD from `result/success`.
    Cost {
        workspace_id: WorkspaceId,
        total_cost_usd: f64,
    },
}

impl<S: EventStore> ClaudeCodeOrchestrator<S> {
    pub fn new(store: Arc<S>, options: ClaudeCodeOptions) -> Self {
        let (tx, _) = broadcast::channel(256);
        let (signal_tx, _) = broadcast::channel(64);
        Self {
            store,
            options,
            tx,
            signal_tx,
            teams: Mutex::new(HashMap::new()),
            permission_handler: Arc::new(AutoAcceptSafeTools),
        }
    }

    /// Swap the permission-prompt handler. Phase 13.G replaces the default
    /// `AutoAcceptSafeTools` with an inbox-routing handler here. Builder-
    /// style: returns `self` for chainability.
    pub fn with_permission_handler(mut self, handler: Arc<dyn PermissionHandler>) -> Self {
        self.permission_handler = handler;
        self
    }

    pub fn subscribe_signals(&self) -> broadcast::Receiver<ClaudeSignal> {
        self.signal_tx.subscribe()
    }

    fn binary(&self) -> PathBuf {
        self.options
            .binary_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("claude"))
    }

    fn derive_session_id(&self, workspace_id: WorkspaceId) -> Uuid {
        // UUIDv5: namespace + workspace id bytes → stable session id.
        Uuid::new_v5(&SESSION_NAMESPACE, workspace_id.as_uuid().as_bytes())
    }

    fn build_command(&self, workspace_id: WorkspaceId, session_id: Uuid) -> Command {
        let mut cmd = Command::new(self.binary());
        cmd.env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
            .env("DESIGNER_WORKSPACE_ID", workspace_id.to_string());
        if let Some(home) = &self.options.claude_home {
            cmd.env("CLAUDE_HOME", home);
        }
        for (k, v) in &self.options.extra_env {
            cmd.env(k, v);
        }
        if let Some(cwd) = &self.options.cwd {
            cmd.current_dir(cwd);
        }

        cmd.arg("-p")
            .args(["--teammate-mode", "in-process"])
            .args(["--output-format", "stream-json"])
            .arg("--include-partial-messages")
            .arg("--verbose")
            .args(["--input-format", "stream-json"])
            .args(["--session-id", &session_id.to_string()])
            .args(["--permission-prompt-tool", "stdio"])
            .args(["--disallowedTools", "AskUserQuestion"])
            .args(["--setting-sources", "user,project,local"])
            .args(["--max-turns", &self.options.max_turns.to_string()])
            .args(["--permission-mode", "default"]);

        if let Some(model) = &self.options.model {
            cmd.args(["--model", model]);
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        cmd
    }
}

#[async_trait]
impl<S: EventStore + 'static> Orchestrator for ClaudeCodeOrchestrator<S> {
    async fn spawn_team(&self, spec: TeamSpec) -> OrchestratorResult<()> {
        let session_id = self.derive_session_id(spec.workspace_id);
        let bin = self.binary();
        let mut cmd = self.build_command(spec.workspace_id, session_id);
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        info!(
            binary = %bin.display(), workspace = %spec.workspace_id,
            session = %session_id, team = %spec.team_name, "spawning claude"
        );

        let mut child = cmd
            .spawn()
            .map_err(|e| OrchestratorError::Spawn(format!("{}: {e}", bin.display())))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| OrchestratorError::Spawn("child did not expose stdin pipe".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| OrchestratorError::Spawn("child did not expose stdout pipe".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| OrchestratorError::Spawn("child did not expose stderr pipe".into()))?;

        let (stdin_tx, stdin_rx) = mpsc::channel::<Vec<u8>>(64);

        // Writer task: forwards bytes to child stdin.
        let writer_task = tokio::spawn(async move {
            let mut stdin = stdin;
            let mut rx = stdin_rx;
            while let Some(bytes) = rx.recv().await {
                if let Err(e) = stdin.write_all(&bytes).await {
                    warn!(error = %e, "claude stdin write failed");
                    break;
                }
                if let Err(e) = stdin.flush().await {
                    warn!(error = %e, "claude stdin flush failed");
                    break;
                }
            }
            debug!("claude stdin writer task exiting");
        });

        // Reader task: line-by-line stream-json → OrchestratorEvent via
        // translator. Each event is (a) persisted to the event store as the
        // matching EventPayload — matches MockOrchestrator's contract, which
        // AppCore's projector task relies on — and (b) broadcast through `tx`
        // for live UI consumers. Rate-limit info + per-turn cost route
        // through `signal_tx`, not the event log (per Decision 34 they're
        // platform telemetry, not domain events).
        let tx = self.tx.clone();
        let signal_tx = self.signal_tx.clone();
        let store_for_reader = self.store.clone();
        let ws = spec.workspace_id;
        let team_name = spec.team_name.clone();
        let lead_role = spec.lead_role.clone();
        let reader_task = tokio::spawn(async move {
            let mut translator = ClaudeStreamTranslator::new(ws, team_name.clone());
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        for out in translator.translate(&line) {
                            match out {
                                TranslatorOutput::Event(ev) => {
                                    if let Some((payload, actor)) =
                                        event_to_payload(&ev, &team_name, &lead_role)
                                    {
                                        if let Err(e) = store_for_reader
                                            .append(StreamId::Workspace(ws), None, actor, payload)
                                            .await
                                        {
                                            warn!(error = %e, "failed to persist orchestrator event");
                                        }
                                    }
                                    let _ = tx.send(ev);
                                }
                                TranslatorOutput::RateLimit(info) => {
                                    let _ = signal_tx.send(ClaudeSignal::RateLimit(info));
                                }
                                TranslatorOutput::Cost(c) => {
                                    let _ = signal_tx.send(ClaudeSignal::Cost {
                                        workspace_id: ws,
                                        total_cost_usd: c,
                                    });
                                }
                            }
                        }
                    }
                    Ok(None) => break, // EOF
                    Err(e) => {
                        warn!(error = %e, "claude stdout read failed");
                        break;
                    }
                }
            }
            debug!("claude stdout reader task exiting");
        });

        // Stderr task: log claude's stderr at warn level. stderr is rarely
        // populated in practice (stream-json carries errors in-band).
        let stderr_task = tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    warn!(stderr = %line, "claude");
                }
            }
        });

        // Immediate "team spawned" broadcast before the real events start
        // flowing; matches MockOrchestrator's contract so UIs light up fast.
        let _ = self.tx.send(OrchestratorEvent::TeamSpawned {
            workspace_id: spec.workspace_id,
            team: spec.team_name.clone(),
        });

        // Send the team-creation prompt via stdin. Claude reads stream-json
        // user messages one JSON-per-line.
        let prompt = build_spawn_prompt(&spec);
        let line = user_message_line(&prompt)?;
        stdin_tx
            .send(line)
            .await
            .map_err(|_| OrchestratorError::Spawn("stdin channel closed".into()))?;

        self.teams.lock().insert(
            spec.workspace_id,
            TeamHandle {
                stdin_tx,
                reader_task,
                writer_task,
                stderr_task,
                child,
                lead_session_id: session_id,
            },
        );

        Ok(())
    }

    async fn assign_task(
        &self,
        workspace_id: WorkspaceId,
        assignment: TaskAssignment,
    ) -> OrchestratorResult<()> {
        let tx = {
            let teams = self.teams.lock();
            teams
                .get(&workspace_id)
                .map(|h| h.stdin_tx.clone())
                .ok_or_else(|| OrchestratorError::TeamNotFound(workspace_id.to_string()))?
        };
        let prompt = build_task_prompt(&assignment);
        let line = user_message_line(&prompt)?;
        tx.send(line)
            .await
            .map_err(|_| OrchestratorError::Spawn("stdin channel closed".into()))?;
        Ok(())
    }

    async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        author_role: String,
        body: String,
    ) -> OrchestratorResult<()> {
        let tx = {
            let teams = self.teams.lock();
            teams
                .get(&workspace_id)
                .map(|h| h.stdin_tx.clone())
                .ok_or_else(|| OrchestratorError::TeamNotFound(workspace_id.to_string()))?
        };
        let prompt = build_message_prompt(&author_role, &body);
        let line = user_message_line(&prompt)?;
        tx.send(line)
            .await
            .map_err(|_| OrchestratorError::Spawn("stdin channel closed".into()))?;
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<OrchestratorEvent> {
        self.tx.subscribe()
    }

    async fn shutdown(&self, workspace_id: WorkspaceId) -> OrchestratorResult<()> {
        // Lift the handle out; further calls on this workspace fail with
        // TeamNotFound, which is the correct semantics after shutdown.
        let handle = self.teams.lock().remove(&workspace_id);
        let Some(mut handle) = handle else {
            return Ok(());
        };

        // Ask the lead to clean up gracefully first.
        let prompt = "Clean up the team: ask all teammates to shut down and finalize the team. No further action after cleanup.";
        if let Ok(line) = user_message_line(prompt) {
            let _ = handle.stdin_tx.send(line).await;
        }
        drop(handle.stdin_tx); // closes stdin → child sees EOF → exits on its own ideally

        // Wait for graceful exit up to SHUTDOWN_TIMEOUT, then escalate.
        match timeout(SHUTDOWN_TIMEOUT, handle.child.wait()).await {
            Ok(Ok(status)) => {
                info!(workspace = %workspace_id, ?status, "claude exited gracefully");
            }
            Ok(Err(e)) => {
                warn!(workspace = %workspace_id, error = %e, "claude wait() failed");
            }
            Err(_) => {
                warn!(workspace = %workspace_id, "claude graceful shutdown timed out; killing");
                let _ = handle.child.start_kill();
                let _ = handle.child.wait().await;
            }
        }

        handle.reader_task.abort();
        handle.writer_task.abort();
        handle.stderr_task.abort();
        Ok(())
    }
}

/// Build the natural-language prompt that bootstraps a team.
fn build_spawn_prompt(spec: &TeamSpec) -> String {
    use std::fmt::Write;
    let mut s = String::new();
    let _ = write!(
        s,
        "Create an agent team named \"{}\" using in-process teammates. \
         The lead has the \"{}\" role. ",
        spec.team_name, spec.lead_role
    );
    if spec.teammates.is_empty() {
        let _ = write!(
            s,
            "Do not spawn any teammates yet; wait for task assignments before creating specialists."
        );
    } else {
        let _ = write!(s, "Spawn these teammates: ");
        for (i, role) in spec.teammates.iter().enumerate() {
            if i > 0 {
                let _ = write!(s, ", ");
            }
            let _ = write!(s, "\"{role}\"");
        }
        let _ = write!(
            s,
            ". Each teammate should have a focused role-appropriate system prompt."
        );
    }
    let _ = write!(
        s,
        " After the team is set up, wait for further instructions before doing any other work."
    );
    s
}

fn build_task_prompt(a: &TaskAssignment) -> String {
    let assignee = a
        .assignee_role
        .as_deref()
        .map(|r| format!(" to the \"{r}\" teammate"))
        .unwrap_or_default();
    format!(
        "Assign a task titled \"{}\"{}. Description: {}",
        a.title, assignee, a.description
    )
}

fn build_message_prompt(author_role: &str, body: &str) -> String {
    format!("Message from {author_role}: {body}")
}

/// Translate an `OrchestratorEvent` into the matching domain-level
/// `EventPayload` + `Actor` pair for persistence. Returns `None` for events
/// that don't have a direct domain-event equivalent (e.g., the synthetic
/// `TeamSpawned` marker) — those are broadcast-only.
fn event_to_payload(
    ev: &OrchestratorEvent,
    team: &str,
    lead_role: &str,
) -> Option<(EventPayload, Actor)> {
    match ev {
        OrchestratorEvent::TeamSpawned { .. } => None,
        OrchestratorEvent::AgentSpawned {
            workspace_id,
            agent_id,
            team: t,
            role,
        } => Some((
            EventPayload::AgentSpawned {
                agent_id: *agent_id,
                workspace_id: *workspace_id,
                team: t.clone(),
                role: role.clone(),
            },
            Actor::agent(team, lead_role),
        )),
        OrchestratorEvent::TaskCreated {
            workspace_id,
            task_id,
            title,
        } => Some((
            EventPayload::TaskCreated {
                task_id: *task_id,
                workspace_id: *workspace_id,
                title: title.clone(),
                assignee: None,
            },
            Actor::agent(team, lead_role),
        )),
        OrchestratorEvent::TaskCompleted { task_id, .. } => Some((
            EventPayload::TaskCompleted { task_id: *task_id },
            Actor::agent(team, lead_role),
        )),
        OrchestratorEvent::TeammateIdle { agent_id, .. } => Some((
            EventPayload::AgentIdled {
                agent_id: *agent_id,
            },
            Actor::agent(team, lead_role),
        )),
        OrchestratorEvent::AgentErrored {
            agent_id, message, ..
        } => Some((
            EventPayload::AgentErrored {
                agent_id: *agent_id,
                message: message.clone(),
            },
            Actor::agent(team, lead_role),
        )),
        OrchestratorEvent::MessagePosted {
            workspace_id,
            author_role,
            body,
        } => {
            let author = Actor::agent(team, author_role);
            Some((
                EventPayload::MessagePosted {
                    workspace_id: *workspace_id,
                    author: author.clone(),
                    body: body.clone(),
                },
                author,
            ))
        }
        // ArtifactProduced is broadcast-only — AppCore's coalescer is the
        // single writer for ArtifactCreated, so we deliberately don't
        // persist a duplicate `EventPayload::ArtifactCreated` here.
        OrchestratorEvent::ArtifactProduced { .. } => None,
    }
}

/// Wrap a natural-language prompt in the stream-json user-message envelope
/// that `claude --input-format stream-json` expects, terminated with a
/// newline.
fn user_message_line(prompt: &str) -> OrchestratorResult<Vec<u8>> {
    let obj = json!({
        "type": "user",
        "message": { "role": "user", "content": prompt }
    });
    let mut bytes = serde_json::to_vec(&obj)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::{TaskId, WorkspaceId};

    #[test]
    fn session_id_is_deterministic_per_workspace() {
        let store = Arc::new(designer_core::SqliteEventStore::open_in_memory().unwrap());
        let orch = ClaudeCodeOrchestrator::new(store, ClaudeCodeOptions::default());
        let ws = WorkspaceId::new();
        let a = orch.derive_session_id(ws);
        let b = orch.derive_session_id(ws);
        assert_eq!(a, b);
        let ws2 = WorkspaceId::new();
        let c = orch.derive_session_id(ws2);
        assert_ne!(a, c);
    }

    #[test]
    fn spawn_prompt_includes_team_name_and_roles() {
        let spec = TeamSpec {
            workspace_id: WorkspaceId::new(),
            team_name: "onboarding".into(),
            lead_role: "team-lead".into(),
            teammates: vec!["design-reviewer".into(), "test-runner".into()],
            env: Default::default(),
        };
        let p = build_spawn_prompt(&spec);
        assert!(p.contains("\"onboarding\""));
        assert!(p.contains("\"team-lead\""));
        assert!(p.contains("\"design-reviewer\""));
        assert!(p.contains("\"test-runner\""));
        assert!(p.contains("in-process"));
    }

    #[test]
    fn spawn_prompt_with_no_teammates_defers_spawning() {
        let spec = TeamSpec {
            workspace_id: WorkspaceId::new(),
            team_name: "build".into(),
            lead_role: "team-lead".into(),
            teammates: vec![],
            env: Default::default(),
        };
        let p = build_spawn_prompt(&spec);
        assert!(p.contains("Do not spawn any teammates yet"));
    }

    #[test]
    fn task_prompt_includes_assignee_when_present() {
        let a = TaskAssignment {
            task_id: TaskId::new(),
            title: "wire auth".into(),
            description: "implement middleware".into(),
            assignee_role: Some("security-reviewer".into()),
        };
        let p = build_task_prompt(&a);
        assert!(p.contains("wire auth"));
        assert!(p.contains("security-reviewer"));
        assert!(p.contains("implement middleware"));
    }

    #[test]
    fn task_prompt_omits_assignee_when_none() {
        let a = TaskAssignment {
            task_id: TaskId::new(),
            title: "run tests".into(),
            description: "execute the suite".into(),
            assignee_role: None,
        };
        let p = build_task_prompt(&a);
        assert!(p.contains("run tests"));
        assert!(!p.contains("teammate\"."));
    }

    #[test]
    fn user_message_line_is_newline_terminated_stream_json() {
        let line = user_message_line("hi").unwrap();
        let s = std::str::from_utf8(&line).unwrap();
        assert!(s.ends_with('\n'));
        let parsed: serde_json::Value = serde_json::from_str(s.trim()).unwrap();
        assert_eq!(parsed["type"], "user");
        assert_eq!(parsed["message"]["role"], "user");
        assert_eq!(parsed["message"]["content"], "hi");
    }

    #[test]
    fn event_to_payload_maps_agent_spawned() {
        let ws = WorkspaceId::new();
        let agent = designer_core::AgentId::new();
        let ev = OrchestratorEvent::AgentSpawned {
            workspace_id: ws,
            agent_id: agent,
            team: "t".into(),
            role: "researcher".into(),
        };
        let (payload, actor) = event_to_payload(&ev, "t", "team-lead").unwrap();
        assert!(matches!(payload, EventPayload::AgentSpawned { .. }));
        match actor {
            Actor::Agent { team, role } => {
                assert_eq!(team, "t");
                assert_eq!(role, "team-lead");
            }
            other => panic!("unexpected actor: {other:?}"),
        }
    }

    #[test]
    fn event_to_payload_maps_teammate_idle_to_agent_idled() {
        let agent = designer_core::AgentId::new();
        let ev = OrchestratorEvent::TeammateIdle {
            workspace_id: WorkspaceId::new(),
            agent_id: agent,
        };
        let (payload, _) = event_to_payload(&ev, "t", "team-lead").unwrap();
        assert!(matches!(payload, EventPayload::AgentIdled { .. }));
    }

    #[test]
    fn event_to_payload_message_posted_uses_sender_role_for_author() {
        let ev = OrchestratorEvent::MessagePosted {
            workspace_id: WorkspaceId::new(),
            author_role: "researcher".into(),
            body: "hi".into(),
        };
        let (payload, actor) = event_to_payload(&ev, "t", "team-lead").unwrap();
        match payload {
            EventPayload::MessagePosted { author, .. } => match author {
                Actor::Agent { role, .. } => assert_eq!(role, "researcher"),
                other => panic!("unexpected author actor: {other:?}"),
            },
            other => panic!("unexpected payload: {other:?}"),
        }
        match actor {
            Actor::Agent { role, .. } => assert_eq!(role, "researcher"),
            other => panic!("unexpected outer actor: {other:?}"),
        }
    }

    #[test]
    fn event_to_payload_team_spawned_is_broadcast_only() {
        let ev = OrchestratorEvent::TeamSpawned {
            workspace_id: WorkspaceId::new(),
            team: "t".into(),
        };
        assert!(event_to_payload(&ev, "t", "team-lead").is_none());
    }

    /// `ArtifactProduced` is broadcast-only — AppCore's coalescer is the
    /// single writer for `EventPayload::ArtifactCreated`, so persisting
    /// here would race the projector and double-write.
    #[test]
    fn event_to_payload_artifact_produced_is_broadcast_only() {
        let ev = OrchestratorEvent::ArtifactProduced {
            workspace_id: WorkspaceId::new(),
            artifact_kind: designer_core::ArtifactKind::Diagram,
            title: "Sequence diagram".into(),
            summary: "summary".into(),
            body: "body".into(),
            author_role: Some("team-lead".into()),
        };
        assert!(event_to_payload(&ev, "t", "team-lead").is_none());
    }
}
