//! Event envelope + payload. Payloads are strongly typed by tag and serialized
//! as JSON for storage. `version` on the envelope lets us evolve a payload
//! schema without breaking old events; projections match on `(kind, version)`.

use crate::domain::{Actor, Autonomy, TabTemplate, WorkspaceState};
use crate::ids::{
    AgentId, ApprovalId, EventId, ProjectId, StreamId, TabId, TaskId, TrackId, WorkspaceId,
};
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

    // Track primitive (Phase 13.E introduces; Phase 18 extends).
    // See spec §"Workspace and Track" and Decisions 29–32.
    /// A track started inside a workspace: one worktree + one branch + one
    /// agent team + one PR series. Emitted by Phase 13.E when
    /// `create_workspace` (or a later multi-track trigger) spawns a track.
    TrackStarted {
        track_id: TrackId,
        workspace_id: WorkspaceId,
        worktree_path: PathBuf,
        branch: String,
    },
    /// The track's PR merged (or the track was otherwise considered done).
    /// Typically followed by automatic worktree cleanup.
    TrackCompleted {
        track_id: TrackId,
    },
    /// The PR for a track was opened on GitHub (via `gh pr create`).
    PullRequestOpened {
        track_id: TrackId,
        pr_number: u64,
    },
    /// Completed track moved into workspace history (read-only reference).
    /// Reserved for Phase 18; Phase 13.E does not emit this yet, but the
    /// shape is frozen here so later migration is zero.
    TrackArchived {
        track_id: TrackId,
    },
    /// Workspace forked: a sibling workspace inherits the source's docs,
    /// decisions, and chat history as a read-only baseline. Reserved for
    /// Phase 18 (spec §"Workspace forking"); shape frozen here.
    WorkspaceForked {
        source_workspace_id: WorkspaceId,
        new_workspace_id: WorkspaceId,
        /// The source workspace's event-log sequence at fork time. Makes
        /// the baseline deterministic on replay.
        snapshot_sequence: u64,
    },
    /// Two forked workspaces reconciled: one absorbed the other, or the
    /// absorbed side was archived. Reserved for Phase 18.
    WorkspacesReconciled {
        target_workspace_id: WorkspaceId,
        absorbed_workspace_id: WorkspaceId,
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
    TrackStarted,
    TrackCompleted,
    PullRequestOpened,
    TrackArchived,
    WorkspaceForked,
    WorkspacesReconciled,
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
            EventPayload::TrackStarted { .. } => EventKind::TrackStarted,
            EventPayload::TrackCompleted { .. } => EventKind::TrackCompleted,
            EventPayload::PullRequestOpened { .. } => EventKind::PullRequestOpened,
            EventPayload::TrackArchived { .. } => EventKind::TrackArchived,
            EventPayload::WorkspaceForked { .. } => EventKind::WorkspaceForked,
            EventPayload::WorkspacesReconciled { .. } => EventKind::WorkspacesReconciled,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::TrackId;
    use std::path::PathBuf;

    /// Every new Phase 13.0-frozen event shape must round-trip through
    /// serde. If this test fails, the shape changed and the frozen contract
    /// is broken — every downstream track that read against the previous
    /// shape needs the update too.
    #[test]
    fn track_events_roundtrip_through_serde() {
        let ws = WorkspaceId::new();
        let track = TrackId::new();
        let other_ws = WorkspaceId::new();

        let cases = vec![
            EventPayload::TrackStarted {
                track_id: track,
                workspace_id: ws,
                worktree_path: PathBuf::from("/tmp/wt/a"),
                branch: "feature/a".into(),
            },
            EventPayload::TrackCompleted { track_id: track },
            EventPayload::PullRequestOpened {
                track_id: track,
                pr_number: 42,
            },
            EventPayload::TrackArchived { track_id: track },
            EventPayload::WorkspaceForked {
                source_workspace_id: ws,
                new_workspace_id: other_ws,
                snapshot_sequence: 123,
            },
            EventPayload::WorkspacesReconciled {
                target_workspace_id: ws,
                absorbed_workspace_id: other_ws,
            },
        ];

        for payload in cases {
            let json = serde_json::to_string(&payload).expect("serialize");
            let back: EventPayload = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(payload, back, "round-trip mismatch for {json}");
        }
    }

    #[test]
    fn track_events_map_to_matching_event_kinds() {
        let track = TrackId::new();
        assert_eq!(
            EventPayload::TrackCompleted { track_id: track }.kind(),
            EventKind::TrackCompleted
        );
        assert_eq!(
            EventPayload::TrackArchived { track_id: track }.kind(),
            EventKind::TrackArchived
        );
    }
}
