//! Projections derive aggregate state from the event log. A `Projector` can
//! rebuild itself from a replay, incorporate new events live, and persist a
//! snapshot so startup doesn't need to scan the full log.

use crate::domain::{
    Artifact, ArtifactKind, Autonomy, PayloadRef, Project, Tab, TabTemplate, Track, TrackState,
    Workspace, WorkspaceState,
};
use crate::event::{EventEnvelope, EventPayload};
use crate::ids::{ArtifactId, ProjectId, StreamId, TabId, TrackId, WorkspaceId};
use crate::roadmap::{NodeClaim, NodeId, NodeShipment};
use parking_lot::RwLock;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use thiserror::Error;

/// Artifact kinds that always land in the activity spine — substantive
/// artifacts a user opens to inspect or pin. Tool-use `Report` artifacts
/// (per-Read/Edit `Used <X>` cards from 13.G) are intentionally absent;
/// they're useful inline in the thread but turn the spine into a firehose
/// when surfaced as standalone rows.
pub const SPINE_ARTIFACT_KINDS: &[ArtifactKind] = &[
    ArtifactKind::Spec,
    ArtifactKind::Prototype,
    ArtifactKind::CodeChange,
    ArtifactKind::Pr,
];

/// `author_role` values that promote a `Report` artifact into the spine.
/// Recap + auditor are the meaningful synthesis surfaces; everything else
/// (tool-use, helper warmup, etc.) stays in the thread.
pub const SPINE_AUTHOR_ROLES: &[&str] = &["recap", "auditor"];

/// Should this artifact appear in the activity spine? Returns `true` for
/// allowlisted kinds, plus `Report` artifacts authored by `recap` /
/// `auditor`. Filter only — `archived_at` / workspace scoping is the
/// caller's responsibility.
pub fn artifact_belongs_in_spine(a: &Artifact) -> bool {
    if SPINE_ARTIFACT_KINDS.contains(&a.kind) {
        return true;
    }
    if matches!(a.kind, ArtifactKind::Report) {
        if let Some(role) = a.author_role.as_deref() {
            return SPINE_AUTHOR_ROLES.contains(&role);
        }
    }
    false
}

#[derive(Debug, Error)]
pub enum ProjectionError {
    #[error("projection '{0}' inconsistent: {1}")]
    Inconsistent(String, String),
}

pub trait Projection: Send + Sync {
    /// Apply a single event. Idempotent within a given sequence.
    fn apply(&self, event: &EventEnvelope);

    /// Replace state with a replayed ordered slice.
    fn replay(&self, events: &[EventEnvelope]) {
        for event in events {
            self.apply(event);
        }
    }

    fn name(&self) -> &'static str;
}

/// The core product projection: projects + workspaces (with tabs).
#[derive(Debug, Default, Clone)]
pub struct Projector {
    inner: Arc<RwLock<ProjectorState>>,
}

#[derive(Debug, Default, Clone)]
struct ProjectorState {
    projects: BTreeMap<ProjectId, Project>,
    workspaces: BTreeMap<WorkspaceId, Workspace>,
    /// All artifacts, keyed by id. Latest version is held in `version`.
    artifacts: BTreeMap<ArtifactId, Artifact>,
    /// Pinned artifact ids in insertion order per workspace.
    pinned_artifacts: BTreeMap<WorkspaceId, Vec<ArtifactId>>,
    /// All tracks, keyed by id. Phase 13.E.
    tracks: BTreeMap<TrackId, Track>,
    /// Track ids in insertion order per workspace.
    tracks_by_workspace: BTreeMap<WorkspaceId, Vec<TrackId>>,
    /// Phase 22.A — live claims keyed by roadmap node, in `claimed_at`
    /// ascending order; ties break on `track_id` lexicographic for
    /// deterministic event-replay (UUIDv7 ordering agrees with claim time
    /// in practice). Cleaned on `TrackArchived`.
    node_to_claimants: BTreeMap<NodeId, Vec<NodeClaim>>,
    /// Phase 22.A — reverse index for O(1) "what did this track claim?"
    /// lookups. Set on `TrackStarted`-with-anchor; cleared on
    /// `TrackArchived`.
    claimants_to_node: HashMap<TrackId, NodeId>,
    /// Phase 22.A — append-only shipping history keyed by node. Phase
    /// 22.A defines the shape; Phase 22.I owns the population path on
    /// `TrackCompleted`.
    node_to_shipments: BTreeMap<NodeId, Vec<NodeShipment>>,
    /// Highest sequence already applied per stream. Backs the trait
    /// `apply` doc-comment promise of "idempotent within a given
    /// sequence" — without it, the dual-apply boot path
    /// (synchronous `apply` at the call site of `store.append` plus
    /// the broadcast-subscriber task that fans events back into the
    /// same projector) double-projects every event. Symptom: any
    /// payload that mutates by `push` (e.g. `TabOpened`) duplicates
    /// under load. The race surfaced in CI on 2026-05-01 against
    /// `core::tests::open_tab_appends_and_projects` (`tabs.len()`
    /// observed 2 instead of 1).
    last_applied: HashMap<StreamId, u64>,
}

impl Projector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn projects(&self) -> Vec<Project> {
        self.inner.read().projects.values().cloned().collect()
    }

    pub fn workspaces_in(&self, project_id: ProjectId) -> Vec<Workspace> {
        self.inner
            .read()
            .workspaces
            .values()
            .filter(|w| w.project_id == project_id)
            .cloned()
            .collect()
    }

    pub fn workspace(&self, id: WorkspaceId) -> Option<Workspace> {
        self.inner.read().workspaces.get(&id).cloned()
    }

    pub fn project(&self, id: ProjectId) -> Option<Project> {
        self.inner.read().projects.get(&id).cloned()
    }

    /// All artifacts for a workspace, oldest first.
    pub fn artifacts_in(&self, workspace_id: WorkspaceId) -> Vec<Artifact> {
        self.inner
            .read()
            .artifacts
            .values()
            .filter(|a| a.workspace_id == workspace_id && a.archived_at.is_none())
            .cloned()
            .collect()
    }

    /// Artifacts visible from a specific tab. Per-tab thread isolation:
    /// `Message` artifacts are returned only when their `tab_id` matches
    /// the requested tab; all other artifact kinds (spec, pr,
    /// code-change, …) remain workspace-wide because they are shared
    /// work products, not conversation. Legacy `Message` events with no
    /// `tab_id` are attributed to the workspace's first tab at projection
    /// time, so they appear there and nowhere else.
    pub fn artifacts_in_tab(&self, workspace_id: WorkspaceId, tab_id: TabId) -> Vec<Artifact> {
        self.inner
            .read()
            .artifacts
            .values()
            .filter(|a| a.workspace_id == workspace_id && a.archived_at.is_none())
            .filter(|a| match a.kind {
                ArtifactKind::Message => a.tab_id == Some(tab_id),
                _ => true,
            })
            .cloned()
            .collect()
    }

    /// Artifacts for the activity spine — same as `artifacts_in`, but
    /// filtered to substantive kinds. `show_all` bypasses the filter for
    /// debugging (mirrors the `show_all_artifacts_in_spine` feature flag).
    pub fn spine_artifacts_in(&self, workspace_id: WorkspaceId, show_all: bool) -> Vec<Artifact> {
        self.inner
            .read()
            .artifacts
            .values()
            .filter(|a| a.workspace_id == workspace_id && a.archived_at.is_none())
            .filter(|a| show_all || artifact_belongs_in_spine(a))
            .cloned()
            .collect()
    }

    /// Pinned artifacts for a workspace, in insertion order.
    pub fn pinned_artifacts(&self, workspace_id: WorkspaceId) -> Vec<Artifact> {
        let state = self.inner.read();
        state
            .pinned_artifacts
            .get(&workspace_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| state.artifacts.get(id))
                    .filter(|a| a.archived_at.is_none())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn artifact(&self, id: ArtifactId) -> Option<Artifact> {
        self.inner.read().artifacts.get(&id).cloned()
    }

    /// All tracks for a workspace, oldest first. Archived tracks are
    /// included — callers filter when they want the live set.
    pub fn tracks_in(&self, workspace_id: WorkspaceId) -> Vec<Track> {
        let state = self.inner.read();
        state
            .tracks_by_workspace
            .get(&workspace_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| state.tracks.get(id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn track(&self, id: TrackId) -> Option<Track> {
        self.inner.read().tracks.get(&id).cloned()
    }

    /// Phase 22.A — live claims for a roadmap node. Order is deterministic:
    /// `claimed_at` ascending, `track_id` lexicographic on ties.
    pub fn node_claimants(&self, node_id: &NodeId) -> Vec<NodeClaim> {
        self.inner
            .read()
            .node_to_claimants
            .get(node_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Phase 22.A — the node a track is currently claiming, if any.
    pub fn node_for_track(&self, track_id: TrackId) -> Option<NodeId> {
        self.inner.read().claimants_to_node.get(&track_id).cloned()
    }

    /// Phase 22.A — append-only shipping history for a node. Empty until
    /// 22.I emits the population path.
    pub fn node_shipments(&self, node_id: &NodeId) -> Vec<NodeShipment> {
        self.inner
            .read()
            .node_to_shipments
            .get(node_id)
            .cloned()
            .unwrap_or_default()
    }

    /// All `(NodeId, claims)` pairs — used by the canvas IPC to overlay
    /// presence onto every parsed node in one read.
    pub fn all_node_claimants(&self) -> Vec<(NodeId, Vec<NodeClaim>)> {
        self.inner
            .read()
            .node_to_claimants
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// All `(NodeId, shipments)` pairs.
    pub fn all_node_shipments(&self) -> Vec<(NodeId, Vec<NodeShipment>)> {
        self.inner
            .read()
            .node_to_shipments
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

impl Projection for Projector {
    fn apply(&self, event: &EventEnvelope) {
        let mut state = self.inner.write();
        // Drop events we have already projected for this stream. Two
        // call sites apply the same event in the live runtime — the
        // synchronous apply at the write site (read-your-own-writes)
        // and the broadcast subscriber spawned at boot — and the
        // payload arms below are not all idempotent on their own.
        // Strict-greater (>) so a re-replay from sequence 0 still
        // works; equal-or-lower is the duplicate path.
        if let Some(&prev) = state.last_applied.get(&event.stream) {
            if event.sequence <= prev {
                return;
            }
        }
        state
            .last_applied
            .insert(event.stream.clone(), event.sequence);
        match &event.payload {
            EventPayload::ProjectCreated {
                project_id,
                name,
                root_path,
            } => {
                state.projects.insert(
                    *project_id,
                    Project {
                        id: *project_id,
                        name: name.clone(),
                        root_path: root_path.clone(),
                        created_at: event.timestamp,
                        archived_at: None,
                        autonomy: Autonomy::default(),
                    },
                );
            }
            EventPayload::ProjectRenamed { project_id, name } => {
                if let Some(p) = state.projects.get_mut(project_id) {
                    p.name = name.clone();
                }
            }
            EventPayload::ProjectAutonomyChanged {
                project_id,
                autonomy,
            } => {
                if let Some(p) = state.projects.get_mut(project_id) {
                    p.autonomy = *autonomy;
                }
            }
            EventPayload::ProjectArchived { project_id } => {
                if let Some(p) = state.projects.get_mut(project_id) {
                    p.archived_at = Some(event.timestamp);
                }
            }
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name,
                base_branch,
            } => {
                state.workspaces.insert(
                    *workspace_id,
                    Workspace {
                        id: *workspace_id,
                        project_id: *project_id,
                        name: name.clone(),
                        state: WorkspaceState::Active,
                        base_branch: base_branch.clone(),
                        worktree_path: None,
                        created_at: event.timestamp,
                        tabs: vec![],
                    },
                );
            }
            EventPayload::WorkspaceStateChanged {
                workspace_id,
                state: new_state,
            } => {
                if let Some(w) = state.workspaces.get_mut(workspace_id) {
                    w.state = *new_state;
                }
            }
            EventPayload::WorkspaceWorktreeAttached { workspace_id, path } => {
                if let Some(w) = state.workspaces.get_mut(workspace_id) {
                    w.worktree_path = Some(path.clone());
                }
            }
            EventPayload::WorkspaceWorktreeDetached { workspace_id } => {
                if let Some(w) = state.workspaces.get_mut(workspace_id) {
                    w.worktree_path = None;
                }
            }
            EventPayload::WorkspaceDeleted { workspace_id } => {
                // Hard-delete: drop the projection. Past events tied to this
                // id remain in the append-only log but no longer resolve to
                // a workspace on replay. Soft-archive (recoverable) is
                // expressed via `WorkspaceStateChanged { Archived }`; this
                // path is only entered after an explicit user confirm in
                // the Archived sidebar section.
                state.workspaces.remove(workspace_id);
            }
            EventPayload::TabOpened {
                tab_id,
                workspace_id,
                title,
                template,
            } => {
                if let Some(w) = state.workspaces.get_mut(workspace_id) {
                    w.tabs.push(Tab {
                        id: *tab_id,
                        title: title.clone(),
                        template: *template,
                        created_at: event.timestamp,
                        closed_at: None,
                    });
                }
            }
            EventPayload::TabRenamed { tab_id, title } => {
                for w in state.workspaces.values_mut() {
                    if let Some(tab) = w.tabs.iter_mut().find(|t| t.id == *tab_id) {
                        tab.title = title.clone();
                    }
                }
            }
            EventPayload::TabClosed { tab_id } => {
                for w in state.workspaces.values_mut() {
                    if let Some(tab) = w.tabs.iter_mut().find(|t| t.id == *tab_id) {
                        tab.closed_at = Some(event.timestamp);
                    }
                }
            }
            // Artifact foundation (Phase 13.1).
            EventPayload::ArtifactCreated {
                artifact_id,
                workspace_id,
                artifact_kind,
                title,
                summary,
                payload,
                author_role,
                tab_id,
            } => {
                // Per-tab thread isolation: a `Message` artifact must
                // resolve to a tab. Explicit `tab_id` wins; otherwise we
                // attribute legacy events to the workspace's first
                // (oldest, non-closed) tab so existing histories remain
                // readable on the new model. Non-message kinds stay
                // workspace-scoped (`tab_id = None`).
                let resolved_tab = match (*artifact_kind, *tab_id) {
                    (_, Some(t)) => Some(t),
                    (ArtifactKind::Message, None) => state
                        .workspaces
                        .get(workspace_id)
                        .and_then(|w| w.tabs.iter().find(|t| t.closed_at.is_none()))
                        .or_else(|| {
                            state
                                .workspaces
                                .get(workspace_id)
                                .and_then(|w| w.tabs.first())
                        })
                        .map(|t| t.id),
                    _ => None,
                };
                state.artifacts.insert(
                    *artifact_id,
                    Artifact {
                        id: *artifact_id,
                        workspace_id: *workspace_id,
                        kind: *artifact_kind,
                        title: title.clone(),
                        summary: summary.clone(),
                        payload: payload.clone(),
                        author_role: author_role.clone(),
                        version: 1,
                        created_at: event.timestamp,
                        updated_at: event.timestamp,
                        pinned_at: None,
                        archived_at: None,
                        tab_id: resolved_tab,
                    },
                );
            }
            EventPayload::ArtifactUpdated {
                artifact_id,
                summary,
                payload,
                parent_version,
            } => {
                if let Some(a) = state.artifacts.get_mut(artifact_id) {
                    a.summary = summary.clone();
                    a.payload = payload.clone();
                    a.version = parent_version + 1;
                    a.updated_at = event.timestamp;
                }
            }
            EventPayload::ArtifactPinned { artifact_id } => {
                if let Some(a) = state.artifacts.get_mut(artifact_id) {
                    a.pinned_at = Some(event.timestamp);
                    let ws = a.workspace_id;
                    let list = state.pinned_artifacts.entry(ws).or_default();
                    if !list.contains(artifact_id) {
                        list.push(*artifact_id);
                    }
                }
            }
            EventPayload::ArtifactUnpinned { artifact_id } => {
                if let Some(a) = state.artifacts.get_mut(artifact_id) {
                    a.pinned_at = None;
                    let ws = a.workspace_id;
                    if let Some(list) = state.pinned_artifacts.get_mut(&ws) {
                        list.retain(|id| id != artifact_id);
                    }
                }
            }
            EventPayload::ArtifactArchived { artifact_id } => {
                if let Some(a) = state.artifacts.get_mut(artifact_id) {
                    a.archived_at = Some(event.timestamp);
                    let ws = a.workspace_id;
                    if let Some(list) = state.pinned_artifacts.get_mut(&ws) {
                        list.retain(|id| id != artifact_id);
                    }
                }
            }
            // Track lifecycle (Phase 13.E).
            EventPayload::TrackStarted {
                track_id,
                workspace_id,
                worktree_path,
                branch,
                anchor_node_id,
            } => {
                state.tracks.insert(
                    *track_id,
                    Track {
                        id: *track_id,
                        workspace_id: *workspace_id,
                        branch: branch.clone(),
                        worktree_path: worktree_path.clone(),
                        state: TrackState::Active,
                        pr_number: None,
                        pr_url: None,
                        created_at: event.timestamp,
                        completed_at: None,
                        archived_at: None,
                    },
                );
                let list = state.tracks_by_workspace.entry(*workspace_id).or_default();
                if !list.contains(track_id) {
                    list.push(*track_id);
                }
                // Phase 22.A — derive the roadmap claim when the track
                // started against a known node.
                if let Some(node_id) = anchor_node_id.as_ref() {
                    let claim = NodeClaim {
                        node_id: node_id.clone(),
                        workspace_id: *workspace_id,
                        track_id: *track_id,
                        subagent_role: None,
                        claimed_at: event.timestamp,
                    };
                    let claims = state.node_to_claimants.entry(node_id.clone()).or_default();
                    if !claims.iter().any(|c| c.track_id == *track_id) {
                        claims.push(claim);
                        // Maintain the deterministic order: claimed_at
                        // ascending, ties break on track_id lexicographic.
                        claims.sort_by(|a, b| {
                            a.claimed_at
                                .cmp(&b.claimed_at)
                                .then_with(|| a.track_id.to_string().cmp(&b.track_id.to_string()))
                        });
                    }
                    state.claimants_to_node.insert(*track_id, node_id.clone());
                }
            }
            EventPayload::PullRequestOpened {
                track_id,
                pr_number,
            } => {
                if let Some(t) = state.tracks.get_mut(track_id) {
                    t.pr_number = Some(*pr_number);
                    t.state = TrackState::PrOpen;
                }
            }
            EventPayload::TrackCompleted { track_id } => {
                if let Some(t) = state.tracks.get_mut(track_id) {
                    t.state = TrackState::Merged;
                    t.completed_at = Some(event.timestamp);
                }
            }
            EventPayload::TrackArchived { track_id } => {
                if let Some(t) = state.tracks.get_mut(track_id) {
                    t.state = TrackState::Archived;
                    t.archived_at = Some(event.timestamp);
                }
                // Phase 22.A — drop the live claim. Shipment records (22.I)
                // are append-only and persist regardless.
                if let Some(node_id) = state.claimants_to_node.remove(track_id) {
                    if let Some(claims) = state.node_to_claimants.get_mut(&node_id) {
                        claims.retain(|c| c.track_id != *track_id);
                        if claims.is_empty() {
                            state.node_to_claimants.remove(&node_id);
                        }
                    }
                }
            }
            // Events not relevant to the core projection are ignored — per-subsystem
            // projections handle them in safety/audit/orchestrator crates.
            _ => {}
        }

        // Unused variants for the match (silence warnings via a no-op bind).
        let _ = TabTemplate::Thread;
        let _ = PayloadRef::INLINE_THRESHOLD_BYTES;
    }

    fn name(&self) -> &'static str {
        "core"
    }
}
