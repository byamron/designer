//! `SessionAnalysisInput` — the canonical bundle a [`crate::Detector`]
//! reads from.
//!
//! Per the roadmap (`core-docs/roadmap.md` §"Analysis inputs — what the
//! layer reads"), the deterministic detectors and the local model both
//! consume eight input categories:
//!
//! 1. **Event log.** The full event-sourced stream for the workspace
//!    (or project, when `workspace_id` is `None`).
//! 2. **Tool-call inventory.** Per-tool counts, file-path touch list,
//!    re-reads, grep repetition, bash commands executed.
//! 3. **Project configuration snapshot.** `CLAUDE.md`,
//!    `.claude/rules/*.md`, `.claude/skills/*/SKILL.md`,
//!    `.claude/agents/*.md`, `.claude/settings.json`, `core-docs/*.md`.
//! 4. **Project tech-stack fingerprint.** `package.json`, `Cargo.toml`,
//!    formatter / linter / test configs.
//! 5. **Auto-memory.** Notes Claude wrote to
//!    `~/.claude/projects/<project>/memory/`.
//! 6. **Approval/scope/cost history.** Designer's gate log
//!    (`ApprovalRequested/Granted/Denied`, `ScopeDenied`, `CostRecorded`).
//! 7. **Cross-workspace/track overlap.** From Phase 4's `recent_overlap()`
//!    primitive (Phase 21.A1: empty Vec; Phase 21.A2 wires the real
//!    primitive when those detectors land).
//! 8. **Project root path** + linked-repo path for filesystem reads.
//!
//! Phase 21.A1 ships the *shape* with a builder so detectors can write
//! against the locked struct from day one. Items 3–5, 7 are populated
//! lazily / on demand by individual detectors that need them — the input
//! bundle is a thin wrapper over the event stream + a few small
//! filesystem reads, never a full in-memory replica of the project.

use designer_core::{EventEnvelope, EventKind, EventPayload, ProjectId, WorkspaceId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// `ToolCallInventory` aggregation is intentionally empty in Phase 21.A1.
// Tool-call events don't yet have a typed `EventPayload` variant; they
// land as `ArtifactCreated { kind: Message }` from 13.D's coalescer
// without per-tool metadata. Detectors that need the inventory
// (`multi_step_tool_sequence`, `context_never_read`) populate it
// themselves in 21.A2 and pass via `build_with_overrides`. When typed
// tool-call events arrive, this module gains a real `derive_tool_inventory`.

/// The bundle a [`crate::Detector::analyze`] receives.
///
/// All fields are owned to keep the call boundary simple; detectors run
/// per-pass on a small slice of recent events, so the cost is bounded.
/// Per the roadmap §"Detector API — streaming, not buffered", future
/// passes can flip the inventory to a streaming view without breaking
/// the trait — `Detector::analyze` already takes `&SessionAnalysisInput`,
/// not the events directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionAnalysisInput {
    pub project_id: ProjectId,
    /// `None` for project-wide analysis (multi-workspace aggregation).
    /// Phase 21.A1 detectors all scope to a workspace; project-wide
    /// rollup is Phase 21.A3.
    pub workspace_id: Option<WorkspaceId>,
    /// The event stream the detectors read. Ordered by sequence within
    /// the stream. Bounded by the caller — typically the last
    /// `analysis_window` events for the workspace.
    pub events: Vec<EventEnvelope>,
    /// Per-tool counts. Populated from `events` at build time so each
    /// detector doesn't recompute it.
    pub tool_call_inventory: ToolCallInventory,
    /// Pre-aggregated approval / scope / cost summary. Populated from
    /// `events` at build time. Designer-unique detectors read this
    /// directly.
    pub gate_history: GateHistory,
    /// Path to the project root. `None` until [`SessionAnalysisInputBuilder::project_root`] is
    /// called — most filesystem-touching detectors return early when
    /// this is `None`.
    pub project_root: Option<PathBuf>,
    /// Snapshot of `~/.claude/projects/<project>/memory/`. Populated
    /// lazily — empty in Phase 21.A1's example test.
    pub auto_memory: Vec<MemoryNote>,
}

/// Per-tool aggregation derived from the event stream.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolCallInventory {
    /// Tool name → call count. Tool name is the orchestrator's reported
    /// label (`"Read"`, `"Bash"`, `"Edit"`, etc.).
    pub by_tool: HashMap<String, u32>,
    /// File path → number of times it appeared as a tool argument
    /// (read, edit, write). Useful for context-never-read +
    /// repeated-read detectors.
    pub by_file_path: HashMap<PathBuf, u32>,
    /// Bash command prefix → count. The *first whitespace-delimited
    /// token* of each Bash invocation. Used by
    /// `post_action_deterministic` to find shell-command repetition.
    pub by_bash_prefix: HashMap<String, u32>,
}

/// Gate-history aggregation. Populated from `ApprovalRequested/Granted/
/// Denied`, `ScopeDenied`, `CostRecorded`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GateHistory {
    pub approval_requested: u32,
    pub approval_granted: u32,
    pub approval_denied: u32,
    /// Path → count of `ScopeDenied` events. Same path repeating is the
    /// `scope_false_positive` signal.
    pub scope_denied_paths: HashMap<PathBuf, u32>,
    /// Total cents recorded across the bundle. Detectors compare this
    /// against rolling baselines they maintain themselves.
    pub total_cost_cents: u64,
}

/// A note Claude wrote to its auto-memory directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryNote {
    pub path: PathBuf,
    pub body: String,
}

impl SessionAnalysisInput {
    /// Start a builder bound to a project.
    pub fn builder(project_id: ProjectId) -> SessionAnalysisInputBuilder {
        SessionAnalysisInputBuilder {
            project_id,
            workspace_id: None,
            events: Vec::new(),
            project_root: None,
            auto_memory: Vec::new(),
        }
    }
}

/// Builder for [`SessionAnalysisInput`].
///
/// The events themselves are the canonical source; `tool_call_inventory`
/// and `gate_history` are derived deterministically from them inside
/// [`Self::build`]. Callers who want to override the derived aggregates
/// for tests can call [`Self::build_with_overrides`].
pub struct SessionAnalysisInputBuilder {
    project_id: ProjectId,
    workspace_id: Option<WorkspaceId>,
    events: Vec<EventEnvelope>,
    project_root: Option<PathBuf>,
    auto_memory: Vec<MemoryNote>,
}

impl SessionAnalysisInputBuilder {
    pub fn workspace(mut self, id: WorkspaceId) -> Self {
        self.workspace_id = Some(id);
        self
    }

    pub fn events(mut self, events: Vec<EventEnvelope>) -> Self {
        self.events = events;
        self
    }

    pub fn project_root(mut self, root: impl AsRef<Path>) -> Self {
        self.project_root = Some(root.as_ref().to_path_buf());
        self
    }

    pub fn auto_memory(mut self, notes: Vec<MemoryNote>) -> Self {
        self.auto_memory = notes;
        self
    }

    /// Finalize the bundle, deriving `gate_history` from the event
    /// stream. `tool_call_inventory` is an empty default in Phase 21.A1
    /// (see module-level note); detectors that need it populate it via
    /// `build_with_overrides`.
    pub fn build(self) -> SessionAnalysisInput {
        let gate_history = derive_gate_history(&self.events);
        SessionAnalysisInput {
            project_id: self.project_id,
            workspace_id: self.workspace_id,
            events: self.events,
            tool_call_inventory: ToolCallInventory::default(),
            gate_history,
            project_root: self.project_root,
            auto_memory: self.auto_memory,
        }
    }

    /// Test-only escape hatch: skip the derive step and supply
    /// hand-rolled aggregates. Useful for fixture tests that synthesize
    /// inventory data without minting full event envelopes.
    pub fn build_with_overrides(
        self,
        tool_call_inventory: ToolCallInventory,
        gate_history: GateHistory,
    ) -> SessionAnalysisInput {
        SessionAnalysisInput {
            project_id: self.project_id,
            workspace_id: self.workspace_id,
            events: self.events,
            tool_call_inventory,
            gate_history,
            project_root: self.project_root,
            auto_memory: self.auto_memory,
        }
    }
}

/// Walk the event stream and aggregate gate history.
fn derive_gate_history(events: &[EventEnvelope]) -> GateHistory {
    let mut gh = GateHistory::default();
    for env in events {
        match &env.payload {
            EventPayload::ApprovalRequested { .. } => gh.approval_requested += 1,
            EventPayload::ApprovalGranted { .. } => gh.approval_granted += 1,
            EventPayload::ApprovalDenied { .. } => gh.approval_denied += 1,
            EventPayload::ScopeDenied { path, .. } => {
                *gh.scope_denied_paths.entry(path.clone()).or_insert(0) += 1;
            }
            EventPayload::CostRecorded { dollars_cents, .. } => {
                gh.total_cost_cents = gh.total_cost_cents.saturating_add(*dollars_cents);
            }
            _ => {}
        }
    }
    gh
}

/// Convenience: count events by `EventKind`. Useful for detectors
/// without populated aggregates.
pub fn count_by_kind(events: &[EventEnvelope]) -> HashMap<EventKind, u32> {
    let mut counts = HashMap::new();
    for env in events {
        *counts.entry(env.kind()).or_insert(0) += 1;
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::{Actor, EventId, ProjectId, StreamId, Timestamp, WorkspaceId};
    use std::path::PathBuf;

    fn env(payload: EventPayload, ws: WorkspaceId) -> EventEnvelope {
        EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: 1,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    #[test]
    fn builder_produces_bundle_with_derived_aggregates() {
        let project_id = ProjectId::new();
        let workspace_id = WorkspaceId::new();
        let events = vec![
            env(
                EventPayload::ApprovalRequested {
                    approval_id: designer_core::ApprovalId::new(),
                    workspace_id,
                    gate: "write".into(),
                    summary: "first approval".into(),
                },
                workspace_id,
            ),
            env(
                EventPayload::ApprovalGranted {
                    approval_id: designer_core::ApprovalId::new(),
                },
                workspace_id,
            ),
            env(
                EventPayload::ScopeDenied {
                    workspace_id,
                    path: PathBuf::from("/etc/passwd"),
                    reason: "outside scope".into(),
                },
                workspace_id,
            ),
            env(
                EventPayload::CostRecorded {
                    workspace_id,
                    tokens_input: 100,
                    tokens_output: 200,
                    dollars_cents: 42,
                    tab_id: None,
                    turn_id: None,
                },
                workspace_id,
            ),
        ];
        let bundle = SessionAnalysisInput::builder(project_id)
            .workspace(workspace_id)
            .events(events)
            .build();
        assert_eq!(bundle.gate_history.approval_requested, 1);
        assert_eq!(bundle.gate_history.approval_granted, 1);
        assert_eq!(bundle.gate_history.total_cost_cents, 42);
        assert_eq!(
            bundle
                .gate_history
                .scope_denied_paths
                .get(&PathBuf::from("/etc/passwd"))
                .copied(),
            Some(1)
        );
    }

    #[test]
    fn count_by_kind_aggregates_event_kinds() {
        let ws = WorkspaceId::new();
        let events = vec![
            env(
                EventPayload::ApprovalRequested {
                    approval_id: designer_core::ApprovalId::new(),
                    workspace_id: ws,
                    gate: "write".into(),
                    summary: "x".into(),
                },
                ws,
            ),
            env(
                EventPayload::ApprovalGranted {
                    approval_id: designer_core::ApprovalId::new(),
                },
                ws,
            ),
            env(
                EventPayload::ApprovalGranted {
                    approval_id: designer_core::ApprovalId::new(),
                },
                ws,
            ),
        ];
        let counts = count_by_kind(&events);
        assert_eq!(
            counts.get(&EventKind::ApprovalRequested).copied(),
            Some(1u32)
        );
        assert_eq!(counts.get(&EventKind::ApprovalGranted).copied(), Some(2u32));
    }
}
