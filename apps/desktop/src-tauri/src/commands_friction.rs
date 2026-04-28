//! Tauri command shims for Friction (Tracks 13.K + 13.L).
//!
//! Mirrors the pattern in `commands.rs` / `commands_safety.rs`: every wire
//! call is a thin wrapper around `ipc::cmd_*`, so tests can hit the same
//! async functions without a Tauri runtime.

use crate::core::AppCore;
use crate::ipc;
use designer_core::FrictionId;
use designer_ipc::{
    AddressFrictionRequest, FrictionEntry, IpcError, ReportFrictionRequest, ReportFrictionResponse,
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn cmd_report_friction(
    core: State<'_, Arc<AppCore>>,
    req: ReportFrictionRequest,
) -> Result<ReportFrictionResponse, IpcError> {
    ipc::cmd_report_friction(&core, req).await
}

#[tauri::command]
pub async fn cmd_list_friction(
    core: State<'_, Arc<AppCore>>,
) -> Result<Vec<FrictionEntry>, IpcError> {
    ipc::cmd_list_friction(&core).await
}

#[tauri::command]
pub async fn cmd_resolve_friction(
    core: State<'_, Arc<AppCore>>,
    friction_id: FrictionId,
) -> Result<(), IpcError> {
    ipc::cmd_resolve_friction(&core, friction_id).await
}

#[tauri::command]
pub async fn cmd_address_friction(
    core: State<'_, Arc<AppCore>>,
    req: AddressFrictionRequest,
) -> Result<(), IpcError> {
    ipc::cmd_address_friction(&core, req).await
}

#[tauri::command]
pub async fn cmd_reopen_friction(
    core: State<'_, Arc<AppCore>>,
    friction_id: FrictionId,
) -> Result<(), IpcError> {
    ipc::cmd_reopen_friction(&core, friction_id).await
}
