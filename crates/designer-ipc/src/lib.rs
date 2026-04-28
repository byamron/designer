//! Tauri IPC surface — the typed commands that flow between the React
//! frontend and the Rust core. Shared types for both sides live here; the
//! TypeScript counterpart (`packages/shared/src/ipc.ts`) is kept in sync by
//! hand for now (ts-rs codegen can be added post-Phase 8 if manual drift
//! becomes painful).

use designer_core::{
    Anchor, Artifact, ArtifactId, ArtifactKind, Autonomy, Finding, FindingId, FrictionId,
    PayloadRef, Project, ProjectId, Severity, TabTemplate, ThumbSignal, Track, TrackId, TrackState,
    Workspace, WorkspaceId, WorkspaceState,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

/// Wire-level error returned across the Tauri IPC boundary. Variants use
/// **struct** form (named field) instead of newtype-tuple form so serde's
/// internally-tagged representation can serialize them. (`#[serde(tag =
/// "kind")]` cannot serialize newtype variants whose inner type is a
/// scalar — it fails at runtime with "cannot serialize tagged newtype
/// variant containing a string".) The TypeScript translator in
/// `packages/app/src/ipc/error.ts` matches on `kind` and reads the
/// per-variant payload field.
#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IpcError {
    #[error("{message}")]
    Unknown { message: String },
    #[error("not found: {id}")]
    NotFound { id: String },
    #[error("invalid request: {message}")]
    InvalidRequest { message: String },
    #[error("approval required: {message}")]
    ApprovalRequired { message: String },
    #[error("cost cap exceeded: {message}")]
    CostCapExceeded { message: String },
    #[error("scope denied: {path}")]
    ScopeDenied { path: String },
}

impl IpcError {
    /// Convenience for the common ad-hoc string error site. Use the
    /// specific constructors (`not_found`, `invalid_request`, etc.) when
    /// the variant is known.
    pub fn unknown(message: impl Into<String>) -> Self {
        IpcError::Unknown {
            message: message.into(),
        }
    }
    pub fn not_found(id: impl Into<String>) -> Self {
        IpcError::NotFound { id: id.into() }
    }
    pub fn invalid_request(message: impl Into<String>) -> Self {
        IpcError::InvalidRequest {
            message: message.into(),
        }
    }
    pub fn approval_required(message: impl Into<String>) -> Self {
        IpcError::ApprovalRequired {
            message: message.into(),
        }
    }
    pub fn cost_cap_exceeded(message: impl Into<String>) -> Self {
        IpcError::CostCapExceeded {
            message: message.into(),
        }
    }
    pub fn scope_denied(path: impl Into<String>) -> Self {
        IpcError::ScopeDenied { path: path.into() }
    }
}

impl From<designer_core::CoreError> for IpcError {
    fn from(value: designer_core::CoreError) -> Self {
        use designer_core::CoreError;
        match value {
            CoreError::Invariant(message) => IpcError::InvalidRequest { message },
            CoreError::NotFound(id) => IpcError::NotFound { id },
            CoreError::InvalidId(message) => IpcError::InvalidRequest { message },
            other => IpcError::Unknown {
                message: other.to_string(),
            },
        }
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
    /// Post-13.1 the template is effectively always `Thread`. The field
    /// remains for replay compatibility with pre-13.1 events; the
    /// frontend no longer exposes a picker.
    #[serde(default = "default_tab_template")]
    pub template: TabTemplate,
}

fn default_tab_template() -> TabTemplate {
    TabTemplate::Thread
}

// ---- Artifacts (Phase 13.1) ----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactSummary {
    pub id: ArtifactId,
    pub workspace_id: WorkspaceId,
    pub kind: ArtifactKind,
    pub title: String,
    pub summary: String,
    pub author_role: Option<String>,
    pub version: u32,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: bool,
}

impl From<Artifact> for ArtifactSummary {
    fn from(a: Artifact) -> Self {
        ArtifactSummary {
            id: a.id,
            workspace_id: a.workspace_id,
            kind: a.kind,
            title: a.title,
            summary: a.summary,
            author_role: a.author_role,
            version: a.version,
            created_at: a.created_at.to_string(),
            updated_at: a.updated_at.to_string(),
            pinned: a.pinned_at.is_some(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactDetail {
    pub summary: ArtifactSummary,
    pub payload: PayloadRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TogglePinRequest {
    pub artifact_id: ArtifactId,
}

// ---- Agent wire (Phase 13.D) --------------------------------------------

/// Request body for `cmd_post_message`. Drops the user's draft into the
/// active workspace's thread and dispatches it to the orchestrator. The
/// `attachments` field carries opaque metadata the frontend assembled —
/// today the backend just records the names; richer plumbing (paste
/// upload, etc.) lands in 13.E/F as those tracks materialize their data
/// stores.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostMessageRequest {
    pub workspace_id: WorkspaceId,
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<PostMessageAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostMessageAttachment {
    pub id: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostMessageResponse {
    pub artifact_id: ArtifactId,
}

// ---- Track + git wire (Phase 13.E) ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkRepoRequest {
    pub workspace_id: WorkspaceId,
    pub repo_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTrackRequest {
    pub workspace_id: WorkspaceId,
    pub branch: String,
    /// Defaults to the workspace's `base_branch` when `None`.
    #[serde(default)]
    pub base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestMergeRequest {
    pub track_id: TrackId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackSummary {
    pub id: TrackId,
    pub workspace_id: WorkspaceId,
    pub branch: String,
    pub worktree_path: PathBuf,
    pub state: TrackState,
    pub pr_number: Option<u64>,
    pub pr_url: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
}

impl From<Track> for TrackSummary {
    fn from(t: Track) -> Self {
        TrackSummary {
            id: t.id,
            workspace_id: t.workspace_id,
            branch: t.branch,
            worktree_path: t.worktree_path,
            state: t.state,
            pr_number: t.pr_number,
            pr_url: t.pr_url,
            created_at: t.created_at.to_string(),
            completed_at: t.completed_at.map(|t| t.to_string()),
            archived_at: t.archived_at.map(|t| t.to_string()),
        }
    }
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

// ---- Friction (Tracks 13.K + 13.L) ---------------------------------------

/// Request body for `cmd_report_friction`. The screenshot is bundled inline
/// as raw bytes — Tauri serializes `Vec<u8>` efficiently and screenshots
/// are ≤ a few MB after the frontend's pre-shrink. The backend writes the
/// markdown record + PNG sidecar under `<repo>/.designer/friction/<id>.{md,png}`
/// (or `~/.designer/friction/` when no repo is linked).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportFrictionRequest {
    pub anchor: Anchor,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_data: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<ProjectId>,
    /// Active route at submit time (for the markdown record + replay).
    pub route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportFrictionResponse {
    pub friction_id: FrictionId,
    pub local_path: PathBuf,
}

/// State a friction record is in *right now* — derived by projecting all
/// `Friction*` events for a given `friction_id`. Master-list filter chips
/// in the triage view map directly onto these variants (plus `All`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrictionState {
    /// `FrictionReported` is the latest state-changing event for this id.
    /// Reopened entries also land here (after `FrictionReopened`).
    Open,
    /// `FrictionAddressed` (or legacy `FrictionLinked`) is the latest
    /// state-changing event. `pr_url` may be `None` if the user fixed it
    /// without a PR (or the legacy variant carried no PR field).
    Addressed,
    /// `FrictionResolved` is the latest state-changing event.
    Resolved,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrictionEntry {
    pub friction_id: FrictionId,
    pub workspace_id: Option<WorkspaceId>,
    pub project_id: Option<ProjectId>,
    pub created_at: String,
    pub body: String,
    pub route: String,
    /// Synthesized title (descriptor + first 60 chars of body).
    pub title: String,
    /// User-facing descriptor of the anchor (component name / route /
    /// file path). Pre-rendered server-side so the triage view doesn't
    /// have to re-implement the synthesis.
    pub anchor_descriptor: String,
    pub state: FrictionState,
    /// PR that addressed this entry, when one was supplied. Set on
    /// `FrictionAddressed`; legacy `FrictionLinked` records map to `None`
    /// (the GitHub issue URL they carried is not a PR).
    pub pr_url: Option<String>,
    pub screenshot_path: Option<PathBuf>,
    pub local_path: PathBuf,
}

/// Request body for `cmd_address_friction`. `pr_url` is optional — many
/// real fixes ship without a PR (config tweak, doc edit, etc.). The
/// `workspace_id` carries the originating stream so the backend doesn't
/// have to re-scan the event log to locate it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressFrictionRequest {
    pub friction_id: FrictionId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
}

/// Request body for `cmd_resolve_friction` and `cmd_reopen_friction`.
/// Same shape so the FE can use one DTO for both transitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrictionTransitionRequest {
    pub friction_id: FrictionId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
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
    fn ipc_error_serialization_shape_has_kind_tag() {
        // Verify the tagged-enum shape so the TypeScript translator can
        // pattern-match on `kind`. If serde's representation ever shifts
        // (e.g. a serde upgrade flips tuple-variant handling) the
        // frontend translator must be updated in lockstep.
        let err = IpcError::cost_cap_exceeded("10$ cap reached");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json.get("kind").and_then(|v| v.as_str()),
            Some("cost_cap_exceeded")
        );
        assert_eq!(
            json.get("message").and_then(|v| v.as_str()),
            Some("10$ cap reached")
        );
        let err = IpcError::scope_denied("/etc/passwd");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json.get("kind").and_then(|v| v.as_str()),
            Some("scope_denied")
        );
        assert_eq!(
            json.get("path").and_then(|v| v.as_str()),
            Some("/etc/passwd")
        );
        let err = IpcError::unknown("orchestrator died");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json.get("kind").and_then(|v| v.as_str()), Some("unknown"));
        assert_eq!(
            json.get("message").and_then(|v| v.as_str()),
            Some("orchestrator died")
        );
        // Round-trip through deserialize so the contract is bidirectional.
        let back: IpcError = serde_json::from_value(json).unwrap();
        assert!(matches!(back, IpcError::Unknown { .. }));
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

// ---- Learning layer (Phase 21.A1) ---------------------------------------

/// Latest persisted thumbs-up/down for a finding, as projected from
/// the System stream's `FindingSignaled` events. `None` when the user
/// hasn't calibrated this finding yet. Last-write-wins on `(FindingId,
/// signal)` — double-thumbing the same direction updates the
/// timestamp without splitting the badge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingCalibration {
    pub signal: ThumbSignal,
    pub timestamp: String,
}

/// Wire shape for a finding rendered by the Settings → Activity →
/// "Designer noticed" page. Mirrors `designer_core::Finding` but
/// timestamp is RFC3339-stringified so the TS side gets a primitive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingDto {
    pub id: FindingId,
    pub detector_name: String,
    pub detector_version: u32,
    pub project_id: ProjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
    pub timestamp: String,
    pub severity: Severity,
    pub confidence: f32,
    pub summary: String,
    pub evidence: Vec<Anchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_action: Option<serde_json::Value>,
    pub window_digest: String,
    /// Phase 21.A1.1 — populated when the user has thumbed this
    /// finding. Present means "calibrated"; the row renders the
    /// `calibrated 👍/👎` badge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calibration: Option<FindingCalibration>,
}

impl From<Finding> for FindingDto {
    fn from(f: Finding) -> Self {
        FindingDto {
            id: f.id,
            detector_name: f.detector_name,
            detector_version: f.detector_version,
            project_id: f.project_id,
            workspace_id: f.workspace_id,
            timestamp: designer_core::rfc3339(f.timestamp),
            severity: f.severity,
            confidence: f.confidence,
            summary: f.summary,
            evidence: f.evidence,
            suggested_action: f.suggested_action,
            window_digest: f.window_digest,
            calibration: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalFindingRequest {
    pub finding_id: FindingId,
    pub signal: ThumbSignal,
}
