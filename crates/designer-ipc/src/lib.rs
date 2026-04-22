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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub envelope: designer_core::EventEnvelope,
}
