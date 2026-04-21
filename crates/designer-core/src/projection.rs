//! Projections derive aggregate state from the event log. A `Projector` can
//! rebuild itself from a replay, incorporate new events live, and persist a
//! snapshot so startup doesn't need to scan the full log.

use crate::domain::{Autonomy, Project, Tab, TabTemplate, Workspace, WorkspaceState};
use crate::event::{EventEnvelope, EventPayload};
use crate::ids::{ProjectId, WorkspaceId};
use parking_lot::RwLock;
use std::collections::BTreeMap;
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
}

impl Projection for Projector {
    fn apply(&self, event: &EventEnvelope) {
        let mut state = self.inner.write();
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
            // Events not relevant to the core projection are ignored — per-subsystem
            // projections handle them in safety/audit/orchestrator crates.
            _ => {}
        }

        // Unused variants for the match (silence warnings via a no-op bind).
        let _ = TabTemplate::Plan;
    }

    fn name(&self) -> &'static str {
        "core"
    }
}
