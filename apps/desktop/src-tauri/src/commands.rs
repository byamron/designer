//! `#[tauri::command]` wrappers. Thin shims over `ipc::cmd_*` so tests and the
//! CLI can still invoke those async functions directly without a Tauri runtime.
//!
//! Every write path — project/workspace/tab creation, theme change, approvals
//! — passes through here. Tauri serializes inputs/outputs as JSON and
//! dispatches to the Rust function via the managed `Arc<AppCore>` state.

use crate::core::AppCore;
use crate::ipc;
use crate::settings::{ResolvedTheme, Settings, ThemeChoice};
use designer_core::{ArtifactId, ProjectId, Tab, WorkspaceId};
use designer_ipc::{
    ArtifactDetail, ArtifactSummary, CreateProjectRequest, CreateWorkspaceRequest, IpcError,
    OpenTabRequest, ProjectSummary, SpineRow, TogglePinRequest, WorkspaceSummary,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn list_projects(core: State<'_, Arc<AppCore>>) -> Result<Vec<ProjectSummary>, IpcError> {
    ipc::cmd_list_projects(&core).await
}

#[tauri::command]
pub async fn create_project(
    core: State<'_, Arc<AppCore>>,
    req: CreateProjectRequest,
) -> Result<ProjectSummary, IpcError> {
    ipc::cmd_create_project(&core, req).await
}

#[tauri::command]
pub async fn validate_project_path(
    core: State<'_, Arc<AppCore>>,
    path: String,
) -> Result<String, IpcError> {
    ipc::cmd_validate_project_path(&core, path).await
}

#[tauri::command]
pub async fn list_workspaces(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
) -> Result<Vec<WorkspaceSummary>, IpcError> {
    ipc::cmd_list_workspaces(&core, project_id).await
}

#[tauri::command]
pub async fn create_workspace(
    core: State<'_, Arc<AppCore>>,
    req: CreateWorkspaceRequest,
) -> Result<WorkspaceSummary, IpcError> {
    ipc::cmd_create_workspace(&core, req).await
}

#[tauri::command]
pub async fn open_tab(core: State<'_, Arc<AppCore>>, req: OpenTabRequest) -> Result<Tab, IpcError> {
    ipc::cmd_open_tab(&core, req).await
}

#[tauri::command]
pub async fn spine(
    core: State<'_, Arc<AppCore>>,
    workspace_id: Option<WorkspaceId>,
) -> Result<Vec<SpineRow>, IpcError> {
    ipc::cmd_spine(&core, workspace_id).await
}

#[tauri::command]
pub async fn request_approval(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
    gate: String,
    summary: String,
) -> Result<String, IpcError> {
    ipc::cmd_request_approval(&core, workspace_id, gate, summary).await
}

#[tauri::command]
pub async fn resolve_approval(
    core: State<'_, Arc<AppCore>>,
    id: String,
    granted: bool,
    reason: Option<String>,
) -> Result<(), IpcError> {
    ipc::cmd_resolve_approval(&core, id, granted, reason).await
}

// -- Theme ---------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeState {
    pub choice: ThemeChoice,
    pub resolved: ResolvedTheme,
}

#[tauri::command]
pub fn get_theme(core: State<'_, Arc<AppCore>>) -> Result<ThemeState, IpcError> {
    let settings = Settings::load(&core.config.data_dir);
    Ok(ThemeState {
        choice: settings.theme,
        resolved: settings.resolve(),
    })
}

#[tauri::command]
pub fn set_theme(
    core: State<'_, Arc<AppCore>>,
    choice: ThemeChoice,
) -> Result<ThemeState, IpcError> {
    let mut settings = Settings::load(&core.config.data_dir);
    settings.theme = choice;
    settings
        .save(&core.config.data_dir)
        .map_err(|e| IpcError::unknown(format!("settings write failed: {e}")))?;
    let resolved = settings.resolve();
    // NSWindow background is only visible at first paint; subsequent theme
    // changes are handled by CSS via `documentElement.dataset.theme`. The
    // next cold boot reads `settings.json` and applies the new bg color.
    Ok(ThemeState {
        choice: settings.theme,
        resolved,
    })
}

#[tauri::command]
pub async fn list_pinned_artifacts(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
) -> Result<Vec<ArtifactSummary>, IpcError> {
    ipc::cmd_list_pinned_artifacts(&core, workspace_id).await
}

#[tauri::command]
pub async fn list_artifacts(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
) -> Result<Vec<ArtifactSummary>, IpcError> {
    ipc::cmd_list_artifacts(&core, workspace_id).await
}

#[tauri::command]
pub async fn list_spine_artifacts(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
) -> Result<Vec<ArtifactSummary>, IpcError> {
    ipc::cmd_list_spine_artifacts(&core, workspace_id).await
}

#[tauri::command]
pub async fn get_artifact(
    core: State<'_, Arc<AppCore>>,
    artifact_id: ArtifactId,
) -> Result<ArtifactDetail, IpcError> {
    ipc::cmd_get_artifact(&core, artifact_id).await
}

#[tauri::command]
pub async fn toggle_pin_artifact(
    core: State<'_, Arc<AppCore>>,
    req: TogglePinRequest,
) -> Result<bool, IpcError> {
    ipc::cmd_toggle_pin_artifact(&core, req).await
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), IpcError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| IpcError::unknown(format!("reveal_in_finder failed: {e}")))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err(IpcError::unknown(
            "reveal_in_finder only supported on macOS",
        ))
    }
}
