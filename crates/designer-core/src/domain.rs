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

/// Canonical `author_role` strings. The field on `Artifact` is `String` (free-
/// form) but every emitter inside Designer writes one of these — keeping the
/// vocabulary discoverable in one place avoids 13.D / 13.E / 13.F / 13.G drift
/// (FB-codified after the 13.F review).
pub mod author_roles {
    /// Helper-driven workspace recap card (`cmd_recap_workspace`).
    pub const RECAP: &str = "recap";
    /// On-device claim audit comment (`cmd_audit_artifact`).
    pub const AUDITOR: &str = "auditor";
    /// Generic agent-team output where the role isn't otherwise specified.
    pub const AGENT: &str = "agent";
    /// Track-aware emitter (13.E) — code-change / pr artifacts. Will gain
    /// per-track suffixing when track ids land on the artifact event.
    pub const TRACK: &str = "track";
    /// Safety / approval surface (13.G) — approval requests + scope-deny
    /// comments.
    pub const SAFETY: &str = "safety";
    /// Workspace-lead Claude session (13.D) — the persistent manager-level
    /// chat producer.
    pub const WORKSPACE_LEAD: &str = "workspace-lead";
    /// Default lead role inside a fresh agent team (the "team lead").
    pub const TEAM_LEAD: &str = "team-lead";
    /// User-authored thread message.
    pub const USER: &str = "user";
    /// Non-user, non-agent system event (e.g. orphan-sweep denial,
    /// process-restart audit row, scope-deny comment).
    pub const SYSTEM: &str = "system";
}

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
    /// Per-tab scope for `Message` artifacts. `Some(tab_id)` means this
    /// message belongs to a specific tab's thread. Non-message artifacts
    /// (spec, pr, etc.) are workspace-wide and use `None`. Legacy
    /// pre-tab-isolation message events without the field are
    /// attributed to the workspace's first tab on replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<TabId>,
    /// Phase 22.B — manager-voice summary for the Recent Reports surface.
    /// Additive: `summary` continues to drive rail / collapsed-block
    /// views (Decision 39); `summary_high` is read only by the Recent
    /// Reports surface. Reports without it fall back to `summary`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_high: Option<String>,
    /// Phase 22.B — Source classification (Feature / Fix / Improvement /
    /// Reverted). Only populated on `Report` artifacts; pre-22.B reports
    /// without classification fall back to "Improvement" at render time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classification: Option<ReportClassification>,
}

/// Phase 22.B — coarse source classification for shipped-work reports.
/// Set at write time by the local-model summary hook (or a heuristic
/// fallback). Pre-22.B reports without a classification fall back to
/// `Improvement` for surfacing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReportClassification {
    Feature,
    Fix,
    Improvement,
    Reverted,
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
    /// Phase 22.A — the roadmap canvas surface itself. Lives in the
    /// project Home tab when `show_roadmap_canvas` is on. Never appears
    /// in the activity spine.
    Roadmap,
    /// Phase 22.A reserves the registry slot; 22.D ships the renderer
    /// (inline diff card on the canvas). Falls through to the generic
    /// renderer until 22.D lands.
    RoadmapEditProposal,
    /// Phase 22.A reserves the registry slot; 22.D ships the renderer
    /// (status-change card on the canvas). Falls through to the generic
    /// renderer until 22.D lands.
    CompletionClaim,
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

/// Track lifecycle. The projected (replayable) state machine is
/// `Active → PrOpen → Merged → Archived`. `RequestingMerge` is reserved
/// for a future event-sourced flag (it's not produced by replay today)
/// and currently exists only as a transient frontend hint while the user
/// is mid-`gh pr create`. Designer enforces idempotence of merge requests
/// in-process via an in-memory in-flight set in `core_git.rs`, so two
/// concurrent calls cannot both reach `gh`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackState {
    Active,
    /// Reserved — not emitted by replay today. See `core_git.rs` for the
    /// in-memory idempotence machinery used during the live `gh pr create`
    /// window.
    RequestingMerge,
    PrOpen,
    Merged,
    Archived,
}

// ---------------------------------------------------------------------------
// Phase 24 — chat pass-through (ADR 0008)
// ---------------------------------------------------------------------------

/// Claude Code's own `message_id` from a `message_start` envelope.
/// Designer does not mint these; we carry the runtime's identifier
/// verbatim so the read-side correlation matches what the CLI emits.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ClaudeMessageId(pub String);

impl ClaudeMessageId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ClaudeMessageId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Claude Code's own `session_id` from a `system/init` envelope.
/// Used with `--resume <id>` to continue a conversation across subprocess
/// respawns (e.g. on model switch — see Phase 24 spec D5).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ClaudeSessionId(pub String);

impl ClaudeSessionId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ClaudeSessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Type of a content block inside an agent turn. Mirrors the Anthropic
/// Messages API content-block model (text, tool_use, thinking).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentContentBlockKind {
    Text,
    ToolUse {
        name: String,
        tool_use_id: String,
    },
    Thinking,
}

/// Why an agent turn ended. Mirrors `stop_reason` on the Messages API
/// `message_delta` plus a synthesized `Interrupted` value the translator
/// emits on `result/error_during_execution` (see Phase 24 §11.0 P2 spike).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
    Interrupted,
    Error,
}

/// Token accounting on an `AgentTurnEnded`. Mirrors the `usage` object on
/// Claude's `result/success` envelope. `cache_read` and `cache_creation`
/// are zero when prompt caching wasn't engaged.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
    pub cache_read: u32,
    pub cache_creation: u32,
}
