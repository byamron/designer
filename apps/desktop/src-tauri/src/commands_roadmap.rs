//! Phase 22.A — IPC surface for the Roadmap canvas.

use crate::core::AppCore;
use crate::core_roadmap::RoadmapView;
use designer_core::{
    roadmap::{NodeId, NodeStatus},
    ProjectId,
};
use designer_ipc::IpcError;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn cmd_get_roadmap(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
) -> Result<RoadmapView, IpcError> {
    core.get_roadmap(project_id).await.map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_set_node_status(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
    node_id: NodeId,
    status: NodeStatus,
) -> Result<(), IpcError> {
    core.set_node_status(project_id, node_id, status)
        .await
        .map_err(IpcError::from)
}
