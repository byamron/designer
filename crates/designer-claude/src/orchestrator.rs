//! The orchestrator abstraction. Every backend (Claude Code, mock, future
//! orchestrators) maps its native events onto `OrchestratorEvent` and writes
//! those through the provided `EventStore`.

use crate::claude_code::ClaudeSignal;
use async_trait::async_trait;
use designer_core::{AgentId, ArtifactId, ArtifactKind, TabId, TaskId, WorkspaceId};
use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrchestratorError {
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("team not found: {0}")]
    TeamNotFound(String),
    /// The team's stdin channel is closed because the writer task exited
    /// (claude died, or its stdin pipe was severed). The handle in the
    /// orchestrator's team map is stale; callers should treat this like
    /// `TeamNotFound` and re-spawn after `shutdown((workspace_id, tab_id))`.
    /// Surfaced distinctly so the recovery path doesn't have to string-match
    /// on `Spawn(...)`.
    #[error("stdin channel closed for workspace {workspace_id} / tab {tab_id}")]
    ChannelClosed {
        workspace_id: WorkspaceId,
        tab_id: TabId,
    },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("core error: {0}")]
    Core(#[from] designer_core::CoreError),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type OrchestratorResult<T> = std::result::Result<T, OrchestratorError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSpec {
    pub workspace_id: WorkspaceId,
    /// Phase 23.E — per-tab Claude subprocess. Each tab gets its own
    /// session (distinct `--session-id`, distinct stdin/stdout, distinct
    /// context window). Required: every spawn picks one tab.
    pub tab_id: TabId,
    pub team_name: String,
    pub lead_role: String,
    pub teammates: Vec<String>,
    /// Optional extra environment variables for the subprocess.
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    /// Working directory the agent operates in. For workspace-level chat
    /// this is the project's repo root; for a track lead this is the
    /// track's worktree. `None` falls back to the orchestrator-global
    /// `ClaudeCodeOptions::cwd`, which is in turn `None` by default —
    /// meaning the agent inherits the desktop process's cwd, which is
    /// almost never what the user wants. Real-Claude callers should
    /// always set this.
    #[serde(default)]
    pub cwd: Option<std::path::PathBuf>,
    /// Per-team Claude model override (e.g. `claude-haiku-4-5`). When
    /// `None`, falls back to `ClaudeCodeOptions::model`. The Claude
    /// subprocess takes `--model` once at spawn; switching model for an
    /// existing team requires respawning. Additive on the wire so legacy
    /// specs decode unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskAssignment {
    pub task_id: TaskId,
    pub title: String,
    pub description: String,
    pub assignee_role: Option<String>,
}

/// The normalized event stream emitted by orchestrators. This is the only shape
/// the core knows about; Claude Code's native JSON/format lives in the
/// `claude_code` module.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OrchestratorEvent {
    TeamSpawned {
        workspace_id: WorkspaceId,
        team: String,
    },
    AgentSpawned {
        workspace_id: WorkspaceId,
        agent_id: AgentId,
        team: String,
        role: String,
    },
    TaskCreated {
        workspace_id: WorkspaceId,
        task_id: TaskId,
        title: String,
    },
    TaskCompleted {
        workspace_id: WorkspaceId,
        task_id: TaskId,
    },
    TeammateIdle {
        workspace_id: WorkspaceId,
        agent_id: AgentId,
    },
    AgentErrored {
        workspace_id: WorkspaceId,
        agent_id: AgentId,
        message: String,
    },
    MessagePosted {
        workspace_id: WorkspaceId,
        author_role: String,
        body: String,
    },
    /// Agent-produced typed artifact (Phase 13.D). MockOrchestrator emits
    /// these from its keyword-driven simulator so the round-trip tests can
    /// assert that an `ArtifactCreated { kind: diagram | report }` lands in
    /// the projection. The real `ClaudeCodeOrchestrator` will emit these
    /// from the stream translator once tool-use shapes are mapped (per-
    /// tool, lands as 13.E/F/G actually surface tool calls). The
    /// orchestrator does **not** persist this — the AppCore coalescer is
    /// the single writer for `EventPayload::ArtifactCreated` so we don't
    /// double-write or race the projector.
    ///
    /// `artifact_id` is supplied by the emitter so subsequent
    /// `ArtifactUpdated` events (e.g. tool_use → tool_result correlation
    /// in the translator) can target the original artifact. Emitters
    /// without a correlation need (mock, ad-hoc) generate a fresh
    /// [`ArtifactId::new`].
    ArtifactProduced {
        workspace_id: WorkspaceId,
        artifact_id: ArtifactId,
        artifact_kind: ArtifactKind,
        title: String,
        summary: String,
        body: String,
        author_role: Option<String>,
    },
    /// Update to a previously-emitted [`OrchestratorEvent::ArtifactProduced`].
    /// Phase 13.H+1 emits this when a tool_use's matching tool_result lands
    /// in a later turn — the original "Used Read" Report card gets the
    /// result's summary appended in place. Broadcast-only, like
    /// `ArtifactProduced`; AppCore's coalescer is the single writer of the
    /// persisted `EventPayload::ArtifactUpdated`.
    ArtifactUpdated {
        workspace_id: WorkspaceId,
        artifact_id: ArtifactId,
        summary: String,
    },
    /// Phase 23.B — coarse per-tab activity state. Broadcast-only,
    /// purely additive on this enum (no projector arm, no
    /// `EventPayload` mirror, no replay invariant). The translator
    /// emits `Working` on the first stream event of a turn,
    /// `AwaitingApproval` on a `control_request` permission prompt,
    /// and `Idle` on `result/success` / `result/error` and on reader
    /// EOF (subprocess death) so a phantom `Working` doesn't persist
    /// forever.
    ///
    /// `since` is wall-clock at the state transition; the frontend
    /// renders `now - since` as the elapsed counter. Because this is
    /// broadcast-only, ADR 0002's `EventPayload` freeze does **not**
    /// apply — see `core-docs/pattern-log.md` for the precedent.
    ActivityChanged {
        workspace_id: WorkspaceId,
        tab_id: TabId,
        state: ActivityState,
        since: SystemTime,
    },
}

/// Phase 23.B — three-state activity surface for a single
/// `(workspace_id, tab_id)`. Rust enum names; user-facing copy is
/// translated frontend-side (`Working` → `"Working… {elapsed}"`,
/// `AwaitingApproval` → `"Approve to continue"`, `Idle` → render
/// nothing). Never expose the variant names directly to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityState {
    /// No turn in flight; the tab's compose row hides itself.
    Idle,
    /// Claude is producing output for this tab — the agent is
    /// computing, streaming text, or running a tool.
    Working,
    /// A `control_request` permission prompt is open and the agent
    /// is parked until the user (or the inbox) decides.
    AwaitingApproval,
}

#[async_trait]
pub trait Orchestrator: Send + Sync {
    /// Create a new team for one tab in a workspace and return its spawn
    /// confirmation. Phase 23.E: every team is per-(workspace, tab); the
    /// `tab_id` lives on `spec`.
    async fn spawn_team(&self, spec: TeamSpec) -> OrchestratorResult<()>;

    /// Assign a task to an existing team.
    async fn assign_task(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
        assignment: TaskAssignment,
    ) -> OrchestratorResult<()>;

    /// Post a message into the team's mailbox. Routes to the per-tab claude
    /// subprocess for `(workspace_id, tab_id)`; tabs in the same workspace
    /// hold independent conversation memory and context windows.
    async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
        author_role: String,
        body: String,
    ) -> OrchestratorResult<()>;

    /// Subscribe to the event stream.
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<OrchestratorEvent>;

    /// Subscribe to side-channel signals (cost, rate-limit). Default impl is
    /// a never-firing receiver — orchestrators that don't surface platform
    /// telemetry (e.g. `MockOrchestrator` outside its cost-driven tests) can
    /// inherit this. The real `ClaudeCodeOrchestrator` overrides with the
    /// receiver bound to its `signal_tx` so AppCore's cost subscriber sees
    /// every `result/success` line as `ClaudeSignal::Cost`.
    fn subscribe_signals(&self) -> tokio::sync::broadcast::Receiver<ClaudeSignal> {
        let (tx, rx) = tokio::sync::broadcast::channel(1);
        drop(tx);
        rx
    }

    /// Tear one tab's team down (cleanup subprocess, file watchers). To
    /// shut down every tab in a workspace, callers enumerate the workspace's
    /// open tabs and call this for each.
    async fn shutdown(&self, workspace_id: WorkspaceId, tab_id: TabId) -> OrchestratorResult<()>;

    /// Phase 23.F — abort Claude's current turn for one tab without tearing
    /// down the team. Sends an `interrupt` control_request over stdin so the
    /// model bails on whatever it's producing right now; the session stays
    /// alive for a follow-up turn (no lost conversation memory). The
    /// translator emits `ActivityChanged{Idle}` on the resulting `result`
    /// (or reader-EOF) line, so callers don't need to manage the activity
    /// surface themselves.
    ///
    /// Returns `TeamNotFound` when the tab has no live subprocess
    /// (idle session, or already shut down). Returns `ChannelClosed` when
    /// the stdin writer task has exited — same recovery semantics as
    /// `post_message`. Both are observable as "interrupt did nothing"
    /// from the user's seat.
    async fn interrupt(&self, workspace_id: WorkspaceId, tab_id: TabId) -> OrchestratorResult<()>;
}
