//! The orchestrator abstraction. Every backend (Claude Code, mock, future
//! orchestrators) maps its native events onto `OrchestratorEvent` and writes
//! those through the provided `EventStore`.

use async_trait::async_trait;
use designer_core::{AgentId, ArtifactKind, TaskId, WorkspaceId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrchestratorError {
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("team not found: {0}")]
    TeamNotFound(String),
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
    pub team_name: String,
    pub lead_role: String,
    pub teammates: Vec<String>,
    /// Optional extra environment variables for the subprocess.
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
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
    ArtifactProduced {
        workspace_id: WorkspaceId,
        artifact_kind: ArtifactKind,
        title: String,
        summary: String,
        body: String,
        author_role: Option<String>,
    },
}

#[async_trait]
pub trait Orchestrator: Send + Sync {
    /// Create a new team and return its spawn confirmation.
    async fn spawn_team(&self, spec: TeamSpec) -> OrchestratorResult<()>;

    /// Assign a task to an existing team.
    async fn assign_task(
        &self,
        workspace_id: WorkspaceId,
        assignment: TaskAssignment,
    ) -> OrchestratorResult<()>;

    /// Post a message into the team's mailbox.
    async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        author_role: String,
        body: String,
    ) -> OrchestratorResult<()>;

    /// Subscribe to the event stream.
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<OrchestratorEvent>;

    /// Tear the team down (cleanup subprocess, file watchers).
    async fn shutdown(&self, workspace_id: WorkspaceId) -> OrchestratorResult<()>;
}
