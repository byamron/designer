//! Domain aggregates. Projections derive these by replaying events.

use crate::ids::{ArtifactId, ProjectId, TabId, TrackId, WorkspaceId};
use crate::time::Timestamp;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Who performed an action. Agents carry a role (never a human name — see
/// spec decision #7).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Actor {
    User,
    Agent { team: String, role: String },
    System,
}

impl Actor {
    pub fn user() -> Self {
        Actor::User
    }
    pub fn system() -> Self {
        Actor::System
    }
    pub fn agent(team: impl Into<String>, role: impl Into<String>) -> Self {
        Actor::Agent {
            team: team.into(),
            role: role.into(),
        }
    }
}

/// A project: a codebase + the ongoing effort around it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub root_path: PathBuf,
    pub created_at: Timestamp,
    pub archived_at: Option<Timestamp>,
    pub autonomy: Autonomy,
}

/// Autonomy defaults. `Suggest` respects "trust is earned" (spec §UX). A
/// per-project knob only — no global override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Autonomy {
    #[default]
    Suggest,
    Act,
    Scheduled,
}

/// A workspace: a feature/initiative inside a project, with its own team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub project_id: ProjectId,
    pub name: String,
    pub state: WorkspaceState,
    pub base_branch: String,
    pub worktree_path: Option<PathBuf>,
    pub created_at: Timestamp,
    pub tabs: Vec<Tab>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceState {
    Active,
    Paused,
    Archived,
    Errored,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tab {
    pub id: TabId,
    pub title: String,
    pub template: TabTemplate,
    pub created_at: Timestamp,
    pub closed_at: Option<Timestamp>,
}

/// Tab type discriminant.
///
/// Historical values (`Plan`, `Design`, `Build`, `Blank`) are preserved for
/// replay compatibility; all new tabs use `Thread` after Phase 13.1 unified
/// the workspace surface (spec Decision 36). Legacy tabs are rendered as
/// `WorkspaceThread` too — the old enum variants are treated as cosmetic
/// aliases for `Thread`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TabTemplate {
    /// Unified workspace thread with inline artifact blocks (Phase 13.1+).
    Thread,
    /// Legacy — replayed events only. Treated as `Thread`.
    Plan,
    /// Legacy — replayed events only. Treated as `Thread`.
    Design,
    /// Legacy — replayed events only. Treated as `Thread`.
    Build,
    /// Legacy — replayed events only. Treated as `Thread`.
    Blank,
}

impl TabTemplate {
    /// Post-13.1: all tabs render the same thread surface.
    pub fn is_thread(&self) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// Artifact foundation (Phase 13.1)
// ---------------------------------------------------------------------------

/// A typed artifact — the data a block renderer knows how to display.
///
/// Lifecycle (one stream per workspace):
///   `ArtifactCreated` → (`ArtifactUpdated` …) → `ArtifactArchived`
///   `ArtifactPinned`/`ArtifactUnpinned` can interleave anywhere.
///
/// Contents live in `payload`, a `PayloadRef` that inlines small payloads
/// (<10 KB summaries / short markdown) and hashes larger blobs (prototype
/// HTML, diffs) into `~/.designer/artifacts/<hash>` on disk. `summary` is
/// always inline and short — the rail and collapsed-block views read it
/// without paying the full payload cost.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Artifact {
    pub id: ArtifactId,
    pub workspace_id: WorkspaceId,
    pub kind: ArtifactKind,
    pub title: String,
    pub summary: String,
    pub payload: PayloadRef,
    pub author_role: Option<String>,
    pub version: u32,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub pinned_at: Option<Timestamp>,
    pub archived_at: Option<Timestamp>,
}

/// The kinds of block the renderer registry knows how to display. Adding a
/// new kind is a non-breaking change (old replay ignores unknown kinds —
/// the generic-fallback renderer displays `title` + `summary`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactKind {
    /// A human or agent message in the thread. Rendered inline.
    Message,
    /// Structured spec (markdown). Pinnable.
    Spec,
    /// Semantic code-change batch (added/removed/changed + diff reference).
    CodeChange,
    /// PR status card (number, title, checks, state).
    Pr,
    /// Approval request (grant/deny action surface). Interactive.
    Approval,
    /// Audit or recap report (collapsed by default).
    Report,
    /// Prototype output (wraps the Phase 10 PrototypePreview component).
    Prototype,
    /// Comment anchored to another artifact.
    Comment,
    /// Task list / checklist.
    TaskList,
    /// Diagram (mermaid / flow / sequence).
    Diagram,
    /// Design variant picker (thumbnail grid).
    Variant,
    /// Track-rollup: N child events coalesced under one card.
    TrackRollup,
}

/// Payload storage discriminant. Small payloads live inline on the event;
/// larger blobs (prototype HTML, diffs) are content-addressed and written
/// to the artifact store. `Hash` payloads are fetched lazily on expand.
///
/// Threshold: 10 KB (per spec Decision 38 — keeps the event log compact
/// without forcing disk hops for summaries or short markdown).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PayloadRef {
    Inline { body: String },
    // TODO(13.1-storage): wire `~/.designer/artifacts/<hash>` write-through
    // before emitting Hash payloads in 13.E (diffs) or 13.F (prototype
    // HTML). Until then the enum variant exists so the event schema is
    // forward-compatible, but producers should only emit Inline.
    Hash { hash: String, size: u64 },
}

impl PayloadRef {
    pub const INLINE_THRESHOLD_BYTES: usize = 10 * 1024;

    pub fn inline(body: impl Into<String>) -> Self {
        PayloadRef::Inline { body: body.into() }
    }

    pub fn is_inline(&self) -> bool {
        matches!(self, PayloadRef::Inline { .. })
    }
}

// ---------------------------------------------------------------------------
// Track primitive (Phase 13.E — spec Decisions 29–30)
// ---------------------------------------------------------------------------

/// A track inside a workspace: one worktree + one branch + one agent team +
/// one PR series. Derived from the `TrackStarted / TrackCompleted /
/// PullRequestOpened / TrackArchived` events the projector replays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    pub workspace_id: WorkspaceId,
    pub branch: String,
    pub worktree_path: PathBuf,
    pub state: TrackState,
    pub pr_number: Option<u64>,
    pub pr_url: Option<String>,
    pub created_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub archived_at: Option<Timestamp>,
}

/// Track lifecycle. The state machine is intentionally narrow: a track moves
/// forward through `Active → RequestingMerge → PrOpen → Merged → Archived`.
/// `RequestingMerge` is the brief window between the user clicking
/// "Request merge" and `gh pr create` returning. Any failure during that
/// window flips the track back to `Active` so the user can retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackState {
    Active,
    RequestingMerge,
    PrOpen,
    Merged,
    Archived,
}
