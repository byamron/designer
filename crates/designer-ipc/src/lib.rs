//! Tauri IPC surface — the typed commands that flow between the React
//! frontend and the Rust core. Shared types for both sides live here; the
//! TypeScript counterpart (`packages/shared/src/ipc.ts`) is kept in sync by
//! hand for now (ts-rs codegen can be added post-Phase 8 if manual drift
//! becomes painful).

use designer_core::{
    Autonomy, Project, ProjectId, TabTemplate, Workspace, WorkspaceId, WorkspaceState,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IpcError {
    #[error("{0}")]
    Unknown(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("approval required: {0}")]
    ApprovalRequired(String),
    #[error("cost cap exceeded: {0}")]
    CostCapExceeded(String),
    #[error("scope denied: {0}")]
    ScopeDenied(String),
}

impl From<designer_core::CoreError> for IpcError {
    fn from(value: designer_core::CoreError) -> Self {
        IpcError::Unknown(value.to_string())
    }
}

// ---- Projects ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub root_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub project: Project,
    pub workspace_count: usize,
}

// ---- Workspaces ----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub project_id: ProjectId,
    pub name: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub workspace: Workspace,
    pub state: WorkspaceState,
    pub agent_count: usize,
}

// ---- Tabs ----------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenTabRequest {
    pub workspace_id: WorkspaceId,
    pub title: String,
    pub template: TabTemplate,
}

// ---- Settings ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetAutonomyRequest {
    pub project_id: ProjectId,
    pub autonomy: Autonomy,
}

// ---- Activity spine ------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpineState {
    Active,
    Idle,
    Blocked,
    NeedsYou,
    Errored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpineRow {
    pub id: String,
    pub altitude: SpineAltitude,
    pub label: String,
    pub summary: Option<String>,
    pub state: SpineState,
    pub children: Vec<SpineRow>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpineAltitude {
    Project,
    Workspace,
    Agent,
    Artifact,
}

// ---- Event subscription --------------------------------------------------

/// Wire shape for events flowing Rust → frontend. Flattened so the TS consumer
/// reads `kind`, `stream_id`, `sequence` directly without unwrapping an
/// envelope. Kept in sync with `packages/app/src/ipc/types.ts::StreamEvent`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub kind: String,
    pub stream_id: String,
    pub sequence: u64,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

impl From<&designer_core::EventEnvelope> for StreamEvent {
    fn from(env: &designer_core::EventEnvelope) -> Self {
        let kind = serde_json::to_value(env.kind())
            .ok()
            .and_then(|v| v.as_str().map(ToOwned::to_owned))
            .unwrap_or_else(|| "unknown".into());
        let payload = serde_json::to_value(&env.payload).ok();
        StreamEvent {
            kind,
            stream_id: env.stream.to_string(),
            sequence: env.sequence,
            timestamp: designer_core::rfc3339(env.timestamp),
            summary: None,
            payload,
        }
    }
}

impl From<designer_core::EventEnvelope> for StreamEvent {
    fn from(env: designer_core::EventEnvelope) -> Self {
        StreamEvent::from(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::{
        Actor, EventEnvelope, EventId, EventPayload, ProjectId, StreamId, Timestamp,
    };
    use std::path::PathBuf;

    fn envelope_with(payload: EventPayload, stream: StreamId) -> EventEnvelope {
        EventEnvelope {
            id: EventId::new(),
            stream,
            sequence: 7,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    #[test]
    fn stream_event_flattens_project_created() {
        let pid = ProjectId::new();
        let env = envelope_with(
            EventPayload::ProjectCreated {
                project_id: pid,
                name: "Designer".into(),
                root_path: PathBuf::from("/tmp/demo"),
            },
            StreamId::Project(pid),
        );
        let ev = StreamEvent::from(&env);
        assert_eq!(ev.kind, "project_created");
        assert_eq!(ev.sequence, 7);
        assert!(ev.stream_id.starts_with("project:"));
        // Timestamp serializes as RFC3339 at the UNIX epoch.
        assert!(ev.timestamp.starts_with("1970-01-01"));
        // Payload round-trips the tag and fields.
        let payload = ev.payload.as_ref().expect("payload present");
        assert_eq!(payload.get("kind").and_then(|v| v.as_str()), Some("project_created"));
        assert_eq!(payload.get("name").and_then(|v| v.as_str()), Some("Designer"));
    }

    #[test]
    fn stream_event_serializes_with_camel_flattening() {
        let pid = ProjectId::new();
        let env = envelope_with(
            EventPayload::ProjectRenamed { project_id: pid, name: "New".into() },
            StreamId::Project(pid),
        );
        let ev = StreamEvent::from(env);
        // summary is None → omitted entirely, not null.
        let json = serde_json::to_value(&ev).unwrap();
        assert!(json.get("summary").is_none());
        assert!(json.get("payload").is_some());
        assert_eq!(json.get("kind").and_then(|v| v.as_str()), Some("project_renamed"));
    }
}
