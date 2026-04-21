//! Event envelope + payload. Payloads are strongly typed by tag and serialized
//! as JSON for storage. `version` on the envelope lets us evolve a payload
//! schema without breaking old events; projections match on `(kind, version)`.

use crate::domain::{Actor, Autonomy, TabTemplate, WorkspaceState};
use crate::ids::{AgentId, ApprovalId, EventId, ProjectId, StreamId, TabId, TaskId, WorkspaceId};
use crate::time::Timestamp;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The outer envelope. Every event goes through this.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub id: EventId,
    pub stream: StreamId,
    pub sequence: u64,
    pub timestamp: Timestamp,
    pub actor: Actor,
    pub version: u16,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<EventId>,
    pub payload: EventPayload,
}

impl EventEnvelope {
    pub fn kind(&self) -> EventKind {
        self.payload.kind()
    }
}

/// Convenience alias used in some APIs.
pub type Event = EventEnvelope;

/// A single tagged payload type for every event the core understands.
///
/// Adding a new variant is a non-breaking change (old replay ignores unknown
/// kinds). Modifying the shape of a variant's fields is a breaking change —
/// bump `EventEnvelope.version` and fan out through projection match arms.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventPayload {
    // Project lifecycle
    ProjectCreated {
        project_id: ProjectId,
        name: String,
        root_path: PathBuf,
    },
    ProjectRenamed {
        project_id: ProjectId,
        name: String,
    },
    ProjectAutonomyChanged {
        project_id: ProjectId,
        autonomy: Autonomy,
    },
    ProjectArchived {
        project_id: ProjectId,
    },

    // Workspace lifecycle
    WorkspaceCreated {
        workspace_id: WorkspaceId,
        project_id: ProjectId,
        name: String,
        base_branch: String,
    },
    WorkspaceStateChanged {
        workspace_id: WorkspaceId,
        state: WorkspaceState,
    },
    WorkspaceWorktreeAttached {
        workspace_id: WorkspaceId,
        path: PathBuf,
    },

    // Tab lifecycle
    TabOpened {
        tab_id: TabId,
        workspace_id: WorkspaceId,
        title: String,
        template: TabTemplate,
    },
    TabRenamed {
        tab_id: TabId,
        title: String,
    },
    TabClosed {
        tab_id: TabId,
    },

    // Agent + tasks
    AgentSpawned {
        agent_id: AgentId,
        workspace_id: WorkspaceId,
        team: String,
        role: String,
    },
    AgentIdled {
        agent_id: AgentId,
    },
    AgentErrored {
        agent_id: AgentId,
        message: String,
    },
    TaskCreated {
        task_id: TaskId,
        workspace_id: WorkspaceId,
        title: String,
        assignee: Option<AgentId>,
    },
    TaskUpdated {
        task_id: TaskId,
        status: String,
    },
    TaskCompleted {
        task_id: TaskId,
    },
    MessagePosted {
        workspace_id: WorkspaceId,
        author: Actor,
        body: String,
    },
    ProjectThreadPosted {
        project_id: ProjectId,
        author: Actor,
        body: String,
    },

    // Safety
    ApprovalRequested {
        approval_id: ApprovalId,
        workspace_id: WorkspaceId,
        gate: String,
        summary: String,
    },
    ApprovalGranted {
        approval_id: ApprovalId,
    },
    ApprovalDenied {
        approval_id: ApprovalId,
        reason: Option<String>,
    },
    CostRecorded {
        workspace_id: WorkspaceId,
        tokens_input: u64,
        tokens_output: u64,
        dollars_cents: u64,
    },
    ScopeDenied {
        workspace_id: WorkspaceId,
        path: PathBuf,
        reason: String,
    },

    // Audit
    AuditEntry {
        category: String,
        summary: String,
        details: serde_json::Value,
    },
}

/// Cheap discriminant for pattern matching in indices + projections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    ProjectCreated,
    ProjectRenamed,
    ProjectAutonomyChanged,
    ProjectArchived,
    WorkspaceCreated,
    WorkspaceStateChanged,
    WorkspaceWorktreeAttached,
    TabOpened,
    TabRenamed,
    TabClosed,
    AgentSpawned,
    AgentIdled,
    AgentErrored,
    TaskCreated,
    TaskUpdated,
    TaskCompleted,
    MessagePosted,
    ProjectThreadPosted,
    ApprovalRequested,
    ApprovalGranted,
    ApprovalDenied,
    CostRecorded,
    ScopeDenied,
    AuditEntry,
}

impl EventPayload {
    pub fn kind(&self) -> EventKind {
        match self {
            EventPayload::ProjectCreated { .. } => EventKind::ProjectCreated,
            EventPayload::ProjectRenamed { .. } => EventKind::ProjectRenamed,
            EventPayload::ProjectAutonomyChanged { .. } => EventKind::ProjectAutonomyChanged,
            EventPayload::ProjectArchived { .. } => EventKind::ProjectArchived,
            EventPayload::WorkspaceCreated { .. } => EventKind::WorkspaceCreated,
            EventPayload::WorkspaceStateChanged { .. } => EventKind::WorkspaceStateChanged,
            EventPayload::WorkspaceWorktreeAttached { .. } => EventKind::WorkspaceWorktreeAttached,
            EventPayload::TabOpened { .. } => EventKind::TabOpened,
            EventPayload::TabRenamed { .. } => EventKind::TabRenamed,
            EventPayload::TabClosed { .. } => EventKind::TabClosed,
            EventPayload::AgentSpawned { .. } => EventKind::AgentSpawned,
            EventPayload::AgentIdled { .. } => EventKind::AgentIdled,
            EventPayload::AgentErrored { .. } => EventKind::AgentErrored,
            EventPayload::TaskCreated { .. } => EventKind::TaskCreated,
            EventPayload::TaskUpdated { .. } => EventKind::TaskUpdated,
            EventPayload::TaskCompleted { .. } => EventKind::TaskCompleted,
            EventPayload::MessagePosted { .. } => EventKind::MessagePosted,
            EventPayload::ProjectThreadPosted { .. } => EventKind::ProjectThreadPosted,
            EventPayload::ApprovalRequested { .. } => EventKind::ApprovalRequested,
            EventPayload::ApprovalGranted { .. } => EventKind::ApprovalGranted,
            EventPayload::ApprovalDenied { .. } => EventKind::ApprovalDenied,
            EventPayload::CostRecorded { .. } => EventKind::CostRecorded,
            EventPayload::ScopeDenied { .. } => EventKind::ScopeDenied,
            EventPayload::AuditEntry { .. } => EventKind::AuditEntry,
        }
    }
}
