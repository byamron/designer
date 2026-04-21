//! Domain aggregates. Projections derive these by replaying events.

use crate::ids::{ProjectId, TabId, WorkspaceId};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TabTemplate {
    Plan,
    Design,
    Build,
    Blank,
}
