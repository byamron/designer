//! Event envelope + payload. Payloads are strongly typed by tag and serialized
//! as JSON for storage. `version` on the envelope lets us evolve a payload
//! schema without breaking old events; projections match on `(kind, version)`.

use crate::anchor::Anchor;
use crate::domain::{
    Actor, ArtifactKind, Autonomy, PayloadRef, ReportClassification, TabTemplate, WorkspaceState,
};
use crate::finding::{Finding, ThumbSignal};
use crate::ids::{
    AgentId, ApprovalId, ArtifactId, EventId, FindingId, FrictionId, ProjectId, ProposalId,
    StreamId, TabId, TaskId, TrackId, WorkspaceId,
};
use crate::proposal::{Proposal, ProposalResolution};
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
///
/// `large_enum_variant` is allowed because Track 13.K's `FrictionReported`
/// is intentionally heavy (an Anchor + screenshot ref + provenance fields
/// for the bug-report record). It's a low-frequency event (user-driven,
/// not per-tool-call), so the per-`EventEnvelope` size cost is amortized
/// across the steady-state cheap variants.
#[allow(clippy::large_enum_variant)]
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
    /// User unlinked the workspace from its repo. Inverse of
    /// `WorkspaceWorktreeAttached` — Designer's pointer is severed but
    /// the repo on disk is untouched. Additive event (ADR 0002 addendum)
    /// added in service of the per-project unlink affordance.
    WorkspaceWorktreeDetached {
        workspace_id: WorkspaceId,
    },
    /// User permanently deleted a workspace from the sidebar Archived
    /// section. The projection drops the workspace from its map; past
    /// events tied to the id remain in the append-only log but are
    /// orphaned (no projector handler resolves them once the workspace
    /// entry is gone). Archiving is the soft-delete path
    /// (`WorkspaceStateChanged { state: Archived }`); this is the
    /// hard-delete path that follows it.
    WorkspaceDeleted {
        workspace_id: WorkspaceId,
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
        /// The tab the message was posted into. Optional for replay
        /// compatibility with pre-tab-isolation events; legacy `None`
        /// values are attributed to the workspace's first tab in the
        /// projector. Per the ADR 0002 addendum, additive event-vocabulary
        /// changes don't require a new ADR.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab_id: Option<TabId>,
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

    // Artifact foundation (Phase 13.1) — typed blocks rendered inline in the
    // unified workspace thread. Emitters land in 13.D (messages + agent
    // outputs), 13.E (code-change + pr), 13.F (report + comment), 13.G
    // (approval + comment). This crate just defines the envelope shape +
    // projection so those tracks can ship in parallel.
    ArtifactCreated {
        artifact_id: ArtifactId,
        workspace_id: WorkspaceId,
        artifact_kind: ArtifactKind,
        title: String,
        summary: String,
        payload: PayloadRef,
        author_role: Option<String>,
        /// Tab scope for `Message` artifacts (per-tab thread isolation).
        /// Other artifact kinds (spec, pr, code-change, etc.) stay
        /// workspace-scoped and emit `None`. Legacy events without the
        /// field decode via `serde(default)`; the projector attributes
        /// them to the workspace's first tab when the artifact is a
        /// message.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tab_id: Option<TabId>,
        /// Phase 22.B — manager-voice summary for `Report` artifacts.
        /// Optional and additive; pre-22.B replay decodes to `None`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary_high: Option<String>,
        /// Phase 22.B — Source classification for `Report` artifacts.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        classification: Option<ReportClassification>,
    },
    ArtifactUpdated {
        artifact_id: ArtifactId,
        summary: String,
        payload: PayloadRef,
        parent_version: u32,
        /// Phase 22.B — late-return manager-voice summary. Emitted when
        /// the local-model hook returns after the 500ms append deadline.
        /// Optional and additive; pre-22.B replay decodes to `None`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary_high: Option<String>,
        /// Phase 22.B — late-return classification update.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        classification: Option<ReportClassification>,
    },
    ArtifactPinned {
        artifact_id: ArtifactId,
    },
    ArtifactUnpinned {
        artifact_id: ArtifactId,
    },
    ArtifactArchived {
        artifact_id: ArtifactId,
    },

    // Friction (Track 13.K + 13.L) — internal feedback capture. 13.L drops
    // the GitHub gist + issue filer and reworks triage as a master list with
    // an explicit Open / Addressed / Resolved state machine. Old records
    // written before 13.L (envelope `version: 1`) still decode through the
    // legacy `FrictionLinked` variant — projection treats them as
    // `addressed` with `pr_url: None`. New records (envelope `version: 2`)
    // emit `FrictionAddressed { pr_url }` directly.
    //
    // `FrictionFileFailed` lost its producer in 13.L but stays in the
    // vocabulary for legacy decode + a future external-filing path.
    FrictionReported {
        friction_id: FrictionId,
        workspace_id: Option<WorkspaceId>,
        project_id: Option<ProjectId>,
        anchor: Anchor,
        body: String,
        screenshot_ref: Option<ScreenshotRef>,
        route: String,
        app_version: String,
        claude_version: Option<String>,
        last_user_actions: Vec<String>,
        file_to_github: bool,
        /// Absolute path to the markdown record on disk. Added in 13.L so
        /// the triage view's "Open file" action knows which directory to
        /// reveal. `Option` so legacy 13.K records (where the field
        /// wasn't on the event) still decode via `serde(default)`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        local_path: Option<PathBuf>,
    },
    /// 13.L — submitter marked the friction record as addressed. Optional
    /// `pr_url` links the change that resolved it; `None` is valid (the user
    /// fixed it without a PR).
    FrictionAddressed {
        friction_id: FrictionId,
        pr_url: Option<String>,
    },
    /// 13.L — resolved entry was reopened. Projects back to `Open`.
    FrictionReopened {
        friction_id: FrictionId,
    },
    /// Legacy 13.K event: kept so envelopes written with `version: 1` still
    /// decode. 13.L projector treats this as `FrictionAddressed { pr_url:
    /// None }`. New records must emit `FrictionAddressed` instead.
    #[deprecated(note = "removed in 13.L; legacy decode only — emit FrictionAddressed")]
    FrictionLinked {
        friction_id: FrictionId,
        github_issue_url: String,
    },
    /// Legacy 13.K event: kept so envelopes written with `version: 1` still
    /// decode. 13.L dropped the producer (no more `gh` filer); reserved for
    /// a future external-filing path.
    #[deprecated(note = "removed in 13.L; reserved for future external-filing path")]
    FrictionFileFailed {
        friction_id: FrictionId,
        error_kind: FrictionFileError,
    },
    FrictionResolved {
        friction_id: FrictionId,
    },

    // Phase 21.A — learning layer (frozen by Lane 0 ADR; see ADR 0002
    // addendum 2026-04-26). `FindingRecorded` carries a single observation
    // produced by a deterministic detector; `FindingSignaled` carries the
    // user's thumbs-up/down calibration on a finding. Phase A only records;
    // Phase B reads `FindingSignaled` to retune thresholds.
    FindingRecorded {
        finding: Finding,
    },
    FindingSignaled {
        finding_id: FindingId,
        signal: ThumbSignal,
    },

    // Phase 21.A1.2 — proposals over findings (additive per the Lane 0
    // ADR addendum 2026-04-26). A proposal is the user-facing
    // recommendation synthesized from one or more findings; the
    // synthesizer runs at boundaries (`TrackCompleted` + first
    // workspace-home view of the day), never per event. See
    // `apps/desktop/src-tauri/src/core_proposals.rs`.
    ProposalEmitted {
        proposal: Proposal,
    },
    ProposalResolved {
        proposal_id: ProposalId,
        resolution: ProposalResolution,
    },
    /// Calibration thumb on a proposal. Phase B reads these to retune
    /// detector / synthesizer thresholds; Phase 21.A1.2 just persists
    /// the signal so the surface can render the calibrated badge.
    ProposalSignaled {
        proposal_id: ProposalId,
        signal: ThumbSignal,
    },
}

/// Where a friction record's screenshot lives. `Local` is the only state
/// possible synchronously at submit time; `Gist` is upgraded by the
/// background filer once `gh gist create --secret` succeeds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScreenshotRef {
    Local { path: PathBuf, sha256: String },
    Gist { url: String, sha256: String },
}

impl ScreenshotRef {
    /// Local PNG path if the screenshot is still on disk; `None` once the
    /// ref has been promoted to a gist (the gist task drops local copies
    /// per the spec's content-addressed dedupe rule).
    pub fn local_path(&self) -> Option<&std::path::Path> {
        match self {
            ScreenshotRef::Local { path, .. } => Some(path.as_path()),
            ScreenshotRef::Gist { .. } => None,
        }
    }

    pub fn sha256(&self) -> &str {
        match self {
            ScreenshotRef::Local { sha256, .. } | ScreenshotRef::Gist { sha256, .. } => sha256,
        }
    }
}

/// Why a `FrictionFileFailed` was emitted. Kept narrow on purpose so the
/// triage view can render an actionable hint per kind without a free-text
/// match. `gh` stderr is logged to the audit trail but not stored on the
/// event; events are user-visible and stderr can be noisy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FrictionFileError {
    /// The `gh` CLI is not installed or not on PATH.
    GhMissing,
    /// `gh` is installed but the user isn't authenticated.
    GhNotAuthed,
    /// Network looked offline (DNS / refused / timeout).
    NetworkOffline,
    /// `gh gist create` rejected the upload (10MB cap, file type, etc.).
    GistRejected { detail: String },
    /// `gh issue create` failed after the gist landed (orphan gist accepted).
    IssueCreateFailed { detail: String },
    /// Anything else. `detail` is for diagnostics only — don't pattern-match.
    Other { detail: String },
}

impl std::fmt::Display for FrictionFileError {
    /// User-facing message rendered into the triage view. Each kind maps
    /// to an actionable hint. `Debug` would surface struct-syntax noise
    /// (`GistRejected { detail: "..." }`) — don't use it for the triage row.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrictionFileError::GhMissing => write!(f, "gh CLI missing — install GitHub CLI."),
            FrictionFileError::GhNotAuthed => {
                write!(f, "gh not authenticated — run `gh auth login`.")
            }
            FrictionFileError::NetworkOffline => write!(f, "Network offline — retry when online."),
            FrictionFileError::GistRejected { detail } => {
                write!(f, "Gist upload rejected: {detail}")
            }
            FrictionFileError::IssueCreateFailed { detail } => {
                write!(f, "Gist landed but issue create failed: {detail}")
            }
            FrictionFileError::Other { detail } => write!(f, "{detail}"),
        }
    }
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
    WorkspaceWorktreeDetached,
    WorkspaceDeleted,
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
    ArtifactCreated,
    ArtifactUpdated,
    ArtifactPinned,
    ArtifactUnpinned,
    ArtifactArchived,
    FrictionReported,
    FrictionAddressed,
    FrictionReopened,
    FrictionLinked,
    FrictionFileFailed,
    FrictionResolved,
    FindingRecorded,
    FindingSignaled,
    ProposalEmitted,
    ProposalResolved,
    ProposalSignaled,
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
            EventPayload::WorkspaceWorktreeDetached { .. } => EventKind::WorkspaceWorktreeDetached,
            EventPayload::WorkspaceDeleted { .. } => EventKind::WorkspaceDeleted,
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
            EventPayload::ArtifactCreated { .. } => EventKind::ArtifactCreated,
            EventPayload::ArtifactUpdated { .. } => EventKind::ArtifactUpdated,
            EventPayload::ArtifactPinned { .. } => EventKind::ArtifactPinned,
            EventPayload::ArtifactUnpinned { .. } => EventKind::ArtifactUnpinned,
            EventPayload::ArtifactArchived { .. } => EventKind::ArtifactArchived,
            EventPayload::FrictionReported { .. } => EventKind::FrictionReported,
            EventPayload::FrictionAddressed { .. } => EventKind::FrictionAddressed,
            EventPayload::FrictionReopened { .. } => EventKind::FrictionReopened,
            #[allow(deprecated)]
            EventPayload::FrictionLinked { .. } => EventKind::FrictionLinked,
            #[allow(deprecated)]
            EventPayload::FrictionFileFailed { .. } => EventKind::FrictionFileFailed,
            EventPayload::FrictionResolved { .. } => EventKind::FrictionResolved,
            EventPayload::FindingRecorded { .. } => EventKind::FindingRecorded,
            EventPayload::FindingSignaled { .. } => EventKind::FindingSignaled,
            EventPayload::ProposalEmitted { .. } => EventKind::ProposalEmitted,
            EventPayload::ProposalResolved { .. } => EventKind::ProposalResolved,
            EventPayload::ProposalSignaled { .. } => EventKind::ProposalSignaled,
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

    /// Tracks 13.K + 13.L — Friction variants must round-trip through
    /// serde and map to the matching `EventKind`. The 13.L rename
    /// (`FrictionLinked` → `FrictionAddressed`) is the only non-additive
    /// payload change in this branch; old records continue to decode via
    /// the legacy variant.
    #[test]
    #[allow(deprecated)]
    fn friction_events_roundtrip_and_map_kinds() {
        use crate::Anchor;
        use crate::FrictionId;
        let fid = FrictionId::new();
        let anchor = Anchor::DomElement {
            selector_path: "[data-component=\"WorkspaceSidebar\"]".into(),
            route: "/workspace/x".into(),
            component: Some("WorkspaceSidebar".into()),
            stable_id: None,
            text_snippet: Some("Track A".into()),
        };
        let cases = [
            EventPayload::FrictionReported {
                friction_id: fid,
                workspace_id: None,
                project_id: None,
                anchor,
                body: "row layout looks off".into(),
                screenshot_ref: Some(ScreenshotRef::Local {
                    path: PathBuf::from("/tmp/x.png"),
                    sha256: "abc".into(),
                }),
                route: "/workspace/x".into(),
                app_version: "0.1.0".into(),
                claude_version: Some("2.1.0".into()),
                last_user_actions: vec!["spawn".into()],
                file_to_github: true,
                local_path: Some(PathBuf::from("/tmp/x.md")),
            },
            EventPayload::FrictionAddressed {
                friction_id: fid,
                pr_url: Some("https://github.com/byamron/designer/pull/9".into()),
            },
            EventPayload::FrictionReopened { friction_id: fid },
            EventPayload::FrictionLinked {
                friction_id: fid,
                github_issue_url: "https://github.com/byamron/designer/issues/42".into(),
            },
            EventPayload::FrictionFileFailed {
                friction_id: fid,
                error_kind: FrictionFileError::NetworkOffline,
            },
            EventPayload::FrictionResolved { friction_id: fid },
        ];

        let kinds = [
            EventKind::FrictionReported,
            EventKind::FrictionAddressed,
            EventKind::FrictionReopened,
            EventKind::FrictionLinked,
            EventKind::FrictionFileFailed,
            EventKind::FrictionResolved,
        ];
        for (payload, expected_kind) in cases.iter().zip(kinds.iter()) {
            assert_eq!(payload.kind(), *expected_kind);
            let json = serde_json::to_string(payload).expect("serialize");
            let back: EventPayload = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(payload, &back, "round-trip mismatch for {json}");
        }
    }

    /// 13.L migration: a fixture written before the rename (envelope
    /// `version: 1`, payload `kind: friction_linked`) must continue to
    /// decode. Production projection treats it as `addressed` with
    /// `pr_url: None` — that mapping lives in `core_friction::project_friction`
    /// and is exercised there. This test pins only the legacy decode.
    #[test]
    #[allow(deprecated)]
    fn legacy_friction_linked_envelope_decodes() {
        use crate::ids::EventId;
        use crate::Anchor;
        use crate::FrictionId;
        let envelope_json = serde_json::json!({
            "id": EventId::new(),
            "stream": { "kind": "system" },
            "sequence": 1,
            "timestamp": Timestamp::UNIX_EPOCH,
            "actor": Actor::user(),
            "version": 1,
            "causation_id": null,
            "correlation_id": null,
            "payload": {
                "kind": "friction_linked",
                "friction_id": FrictionId::new(),
                "github_issue_url": "https://github.com/x/y/issues/1"
            }
        });
        let env: EventEnvelope = serde_json::from_value(envelope_json).expect("legacy decode");
        assert_eq!(env.version, 1);
        assert!(matches!(env.payload, EventPayload::FrictionLinked { .. }));
        // Stable kind discriminant preserved for indices.
        assert_eq!(env.kind(), EventKind::FrictionLinked);
        // Helpful sanity: the new variant is what 13.L emits going forward.
        let anchor = Anchor::DomElement {
            selector_path: "x".into(),
            route: "/r".into(),
            component: None,
            stable_id: None,
            text_snippet: None,
        };
        let _ = anchor;
    }

    /// Phase 21.A1 — finding events round-trip through serde and report
    /// the right `EventKind`. Without this, a downstream projector that
    /// pattern-matches on `kind` could silently drop finding events when
    /// a serde rename slips in.
    #[test]
    fn finding_events_roundtrip_through_serde() {
        use crate::finding::{Finding, Severity, ThumbSignal};
        use crate::ids::FindingId;
        let project_id = ProjectId::new();
        let finding = Finding {
            id: FindingId::new(),
            detector_name: "noop".into(),
            detector_version: 1,
            project_id,
            workspace_id: None,
            timestamp: Timestamp::UNIX_EPOCH,
            severity: Severity::Notice,
            confidence: 0.75,
            summary: "noop saw nothing".into(),
            evidence: vec![],
            suggested_action: None,
            window_digest: "deadbeef".into(),
        };
        let recorded = EventPayload::FindingRecorded {
            finding: finding.clone(),
        };
        let signaled = EventPayload::FindingSignaled {
            finding_id: finding.id,
            signal: ThumbSignal::Up,
        };
        for payload in [recorded.clone(), signaled.clone()] {
            let json = serde_json::to_string(&payload).expect("serialize");
            let back: EventPayload = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(payload, back, "round-trip mismatch for {json}");
        }
        assert_eq!(recorded.kind(), EventKind::FindingRecorded);
        assert_eq!(signaled.kind(), EventKind::FindingSignaled);
    }

    /// Phase 21.A1.2 — proposal events round-trip through serde and report
    /// the right `EventKind`. Mirrors `finding_events_roundtrip_through_serde`
    /// for the proposal-side payloads.
    #[test]
    fn proposal_events_roundtrip_through_serde() {
        use crate::finding::Severity;
        use crate::ids::ProposalId;
        use crate::proposal::{Proposal, ProposalKind, ProposalResolution};
        let proposal = Proposal {
            id: ProposalId::new(),
            project_id: ProjectId::new(),
            workspace_id: None,
            source_findings: vec![],
            title: "Repeated correction".into(),
            summary: "User corrected the same pattern 3x.".into(),
            severity: Severity::Notice,
            kind: ProposalKind::Hint,
            suggested_diff: None,
            created_at: Timestamp::UNIX_EPOCH,
        };
        let emitted = EventPayload::ProposalEmitted {
            proposal: proposal.clone(),
        };
        let resolved = EventPayload::ProposalResolved {
            proposal_id: proposal.id,
            resolution: ProposalResolution::Accepted,
        };
        let signaled = EventPayload::ProposalSignaled {
            proposal_id: proposal.id,
            signal: ThumbSignal::Up,
        };
        for payload in [emitted.clone(), resolved.clone(), signaled.clone()] {
            let json = serde_json::to_string(&payload).expect("serialize");
            let back: EventPayload = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(payload, back, "round-trip mismatch for {json}");
        }
        assert_eq!(emitted.kind(), EventKind::ProposalEmitted);
        assert_eq!(resolved.kind(), EventKind::ProposalResolved);
        assert_eq!(signaled.kind(), EventKind::ProposalSignaled);
    }
}
