//! Tauri `#[tauri::command]` handlers for Phase 21.A1 (learning layer
//! foundation). Thin shims over the typed `ipc::cmd_*` functions so
//! tests and the CLI can invoke the same code paths without a Tauri
//! runtime.

use crate::core::AppCore;
use crate::ipc;
use designer_core::ProjectId;
use designer_ipc::{FindingDto, IpcError, SignalFindingRequest};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn cmd_list_findings(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
) -> Result<Vec<FindingDto>, IpcError> {
    ipc::cmd_list_findings(&core, project_id).await
}

#[tauri::command]
pub async fn cmd_signal_finding(
    core: State<'_, Arc<AppCore>>,
    req: SignalFindingRequest,
) -> Result<(), IpcError> {
    ipc::cmd_signal_finding(&core, req).await
}
