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
        assert_eq!(
            payload.get("kind").and_then(|v| v.as_str()),
            Some("project_created")
        );
        assert_eq!(
            payload.get("name").and_then(|v| v.as_str()),
            Some("Designer")
        );
    }

    #[test]
    fn stream_event_serializes_with_camel_flattening() {
        let pid = ProjectId::new();
        let env = envelope_with(
            EventPayload::ProjectRenamed {
                project_id: pid,
                name: "New".into(),
            },
            StreamId::Project(pid),
        );
        let ev = StreamEvent::from(env);
        // summary is None → omitted entirely, not null.
        let json = serde_json::to_value(&ev).unwrap();
        assert!(json.get("summary").is_none());
        assert!(json.get("payload").is_some());
        assert_eq!(
            json.get("kind").and_then(|v| v.as_str()),
            Some("project_renamed")
        );
    }
}

// ---- Local-model helper status ------------------------------------------

/// Flat DTO for the helper-status IPC. Combines boot-time selection (kind,
/// fallback reason) and live supervisor state (consecutive failures, last
/// restart) so the frontend can render provenance + diagnostics from one
/// poll. Intentionally string-typed instead of nesting Rust enums so the
/// TypeScript side stays trivial.
///
/// The Rust side owns the user-facing taxonomy (`provenance_label`,
/// `provenance_id`, `recovery`) so 13.F renderers across three surfaces
/// (spine rows, Home recap, audit verdict tiles) don't each re-implement
/// the string map and drift apart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperStatusResponse {
    /// `"live"` or `"fallback"`.
    pub kind: String,
    /// Snake-case reason when `kind == "fallback"`. Taxonomy:
    ///   - `user_disabled` — `DESIGNER_DISABLE_HELPER=1` forced fallback.
    ///   - `not_configured` — no binary path resolved.
    ///   - `binary_missing` — configured path is not a file.
    ///   - `ping_timeout` — binary spawned but ping exceeded boot deadline.
    ///   - `unsupported_os` — binary reported `macos-too-old`.
    ///   - `models_unavailable` — binary reported `foundation-models-unavailable`.
    ///   - `ping_failed` — binary spawned and responded with some other error.
    ///
    /// `None` when live.
    pub fallback_reason: Option<String>,
    /// Diagnostic detail (error string, missing path). Safe to surface in a
    /// bug report but **not** safe to render into user copy directly — the
    /// string may include machine tags like `foundation-models-error:`.
    pub fallback_detail: Option<String>,
    pub binary_path: Option<PathBuf>,
    pub version: Option<String>,
    pub model: Option<String>,
    pub running: bool,
    pub consecutive_failures: u32,
    /// Unix epoch ms of the last supervisor restart; `None` if never restarted.
    pub last_restart_ms: Option<u64>,
    /// User-facing provenance label pre-computed by Rust so renderers don't
    /// drift. One of: `"Summarized on-device"` (live),
    /// `"Local model briefly unavailable"` (cooling off / first failure),
    /// `"On-device models unavailable"` (terminal fallback — cannot recover
    /// without user action).
    pub provenance_label: String,
    /// Stable kebab-case id for `aria-describedby` wiring. Persistent across
    /// sessions so screen-reader focus doesn't shift when state changes. One
    /// of: `provenance-live`, `provenance-transient`, `provenance-terminal`.
    pub provenance_id: String,
    /// Whether the fallback is self-recoverable. `"user"` — user can flip an
    /// env var. `"reinstall"` — reinstall Designer. `"none"` — current
    /// hardware/OS cannot support the helper; UI should not offer retry.
    /// `None` when `kind == "live"`.
    pub recovery: Option<String>,
}
