//! Phase 13.G — `#[tauri::command]` handlers for safety surfaces and
//! Keychain status. Companion module to `core_safety.rs` (the AppCore
//! methods these handlers call).
//!
//! Conventions:
//! - Register every command in `main.rs`'s `tauri::generate_handler![…]`,
//!   alphabetical for low conflict odds.
//! - The pre-13.G `cmd_request_approval` / `cmd_resolve_approval` stubs
//!   in `commands.rs` keep their wire names — the existing frontend
//!   client (`ipcClient().resolveApproval`) still routes to
//!   `commands::resolve_approval`. We replace the *body* in `ipc.rs`
//!   instead of forking a new IPC name (per ADR 0002 §"PermissionHandler"
//!   and `commands_safety.rs` boilerplate guidance).
//! - Cost-chip thresholds (50 / 80 / 95) live on the frontend so the
//!   chip can update purely from `cost_status` polls without a
//!   round-trip per band change.

use crate::core::AppCore;
use crate::core_safety::{CostStatus, KeychainStatus, PendingApproval};
use crate::settings::Settings;
use designer_core::WorkspaceId;
use designer_ipc::IpcError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostChipPreferences {
    pub enabled: bool,
}

#[tauri::command]
pub async fn cmd_list_pending_approvals(
    core: State<'_, Arc<AppCore>>,
    workspace_id: Option<WorkspaceId>,
) -> Result<Vec<PendingApproval>, IpcError> {
    Ok(core.list_pending_approvals(workspace_id).await)
}

#[tauri::command]
pub async fn cmd_get_cost_status(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
) -> Result<CostStatus, IpcError> {
    Ok(core.cost_status(workspace_id))
}

#[tauri::command]
pub async fn cmd_get_keychain_status(
    core: State<'_, Arc<AppCore>>,
) -> Result<KeychainStatus, IpcError> {
    Ok(core.keychain_status())
}

#[tauri::command]
pub fn cmd_get_cost_chip_preference(
    core: State<'_, Arc<AppCore>>,
) -> Result<CostChipPreferences, IpcError> {
    let settings = Settings::load(&core.config.data_dir);
    Ok(CostChipPreferences {
        enabled: settings.cost_chip_enabled,
    })
}

#[tauri::command]
pub fn cmd_set_cost_chip_preference(
    core: State<'_, Arc<AppCore>>,
    enabled: bool,
) -> Result<CostChipPreferences, IpcError> {
    let mut settings = Settings::load(&core.config.data_dir);
    settings.cost_chip_enabled = enabled;
    settings
        .save(&core.config.data_dir)
        .map_err(|e| IpcError::unknown(format!("settings write failed: {e}")))?;
    Ok(CostChipPreferences {
        enabled: settings.cost_chip_enabled,
    })
}
