//! Projections derive aggregate state from the event log. A `Projector` can
//! rebuild itself from a replay, incorporate new events live, and persist a
//! snapshot so startup doesn't need to scan the full log.

use crate::domain::{
    Artifact, Autonomy, PayloadRef, Project, Tab, TabTemplate, Track, TrackState, Workspace,
    WorkspaceState,
};
use crate::event::{EventEnvelope, EventPayload};
use crate::ids::{ArtifactId, ProjectId, StreamId, TrackId, WorkspaceId};
use parking_lot::RwLock;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use thiserror::Error;

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
            } => {
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
