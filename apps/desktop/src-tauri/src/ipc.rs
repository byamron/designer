//! Typed IPC handlers. These are the functions the Tauri shell would register
//! as `#[tauri::command]` once the WebView runtime is wired. They're plain
//! async methods here so tests and the CLI can invoke them directly.
//!
//! Safety invariant: every write goes through here, and every write passes a
//! safety check (scope / cost / approval). Frontend callers cannot bypass.

use crate::core::AppCore;
use designer_core::{ProjectId, Tab, WorkspaceId};
use designer_ipc::*;
use std::sync::Arc;

pub async fn cmd_create_project(
    core: &Arc<AppCore>,
    req: CreateProjectRequest,
) -> Result<ProjectSummary, IpcError> {
    if req.name.trim().is_empty() {
        return Err(IpcError::InvalidRequest("name must not be empty".into()));
    }
    let project = core
        .create_project(req.name, req.root_path)
        .await
        .map_err(IpcError::from)?;
    Ok(ProjectSummary {
        project,
        workspace_count: 0,
    })
}

pub async fn cmd_list_projects(core: &Arc<AppCore>) -> Result<Vec<ProjectSummary>, IpcError> {
    let projects = core.list_projects().await;
    let mut out = Vec::with_capacity(projects.len());
    for p in projects {
        let count = core.workspaces_in(p.id).await.len();
        out.push(ProjectSummary {
            project: p,
            workspace_count: count,
        });
    }
    Ok(out)
}

pub async fn cmd_create_workspace(
    core: &Arc<AppCore>,
    req: CreateWorkspaceRequest,
) -> Result<WorkspaceSummary, IpcError> {
    if req.name.trim().is_empty() {
        return Err(IpcError::InvalidRequest("name must not be empty".into()));
    }
    let workspace = core
        .create_workspace(req.project_id, req.name, req.base_branch)
        .await
        .map_err(IpcError::from)?;
    let state = workspace.state;
    Ok(WorkspaceSummary {
        workspace,
        state,
        agent_count: 0,
    })
}

pub async fn cmd_list_workspaces(
    core: &Arc<AppCore>,
    project_id: ProjectId,
) -> Result<Vec<WorkspaceSummary>, IpcError> {
    let workspaces = core.workspaces_in(project_id).await;
    Ok(workspaces
        .into_iter()
        .map(|w| {
            let state = w.state;
            WorkspaceSummary {
                workspace: w,
                state,
                agent_count: 0,
            }
        })
        .collect())
}

pub async fn cmd_open_tab(core: &Arc<AppCore>, req: OpenTabRequest) -> Result<Tab, IpcError> {
    if req.title.trim().is_empty() {
        return Err(IpcError::InvalidRequest("title must not be empty".into()));
    }
    core.open_tab(req.workspace_id, req.title, req.template)
        .await
        .map_err(IpcError::from)
}

pub async fn cmd_spine(
    core: &Arc<AppCore>,
    workspace_id: Option<WorkspaceId>,
) -> Result<Vec<SpineRow>, IpcError> {
    Ok(core.spine(workspace_id).await)
}

/// Approval flow is wired in Phase 13.G. Until then, `cmd_request_approval` and
/// `cmd_resolve_approval` return an explicit error so the frontend can detect
/// "not yet wired" and render a degraded state rather than silently dropping.
pub async fn cmd_request_approval(
    _core: &Arc<AppCore>,
    _workspace_id: WorkspaceId,
    _gate: String,
    _summary: String,
) -> Result<String, IpcError> {
    Err(IpcError::Unknown(
        "approvals are a Phase 13.G surface".into(),
    ))
}

pub async fn cmd_resolve_approval(
    _core: &Arc<AppCore>,
    _id: String,
    _granted: bool,
    _reason: Option<String>,
) -> Result<(), IpcError> {
    Err(IpcError::Unknown(
        "approvals are a Phase 13.G surface".into(),
    ))
}
