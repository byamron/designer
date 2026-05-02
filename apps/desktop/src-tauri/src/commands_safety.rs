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
use crate::settings::{FeatureFlags, Settings};
use designer_core::WorkspaceId;
use designer_ipc::IpcError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostChipPreferences {
    pub enabled: bool,
}

/// DTO mirroring `FeatureFlags` for IPC boundary stability. Fields stay
/// in lock-step with the Rust struct; adding a flag means updating both
/// sides + the `cmd_set_feature_flag` match arm.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlagsResponse {
    pub show_models_section: bool,
}

impl From<&FeatureFlags> for FeatureFlagsResponse {
    fn from(f: &FeatureFlags) -> Self {
        FeatureFlagsResponse {
            show_models_section: f.show_models_section,
        }
    }
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

#[tauri::command]
pub fn cmd_get_feature_flags(
    core: State<'_, Arc<AppCore>>,
) -> Result<FeatureFlagsResponse, IpcError> {
    let settings = Settings::load(&core.config.data_dir);
    Ok(FeatureFlagsResponse::from(&settings.feature_flags))
}

/// DP-C — toggle a per-feature flag by field name. Match arms enumerate
/// the supported flags so an unknown name returns `InvalidRequest`
/// rather than silently writing nothing.
#[tauri::command]
pub fn cmd_set_feature_flag(
    core: State<'_, Arc<AppCore>>,
    name: String,
    enabled: bool,
) -> Result<FeatureFlagsResponse, IpcError> {
    let mut settings = Settings::load(&core.config.data_dir);
    match name.as_str() {
        "show_models_section" => settings.feature_flags.show_models_section = enabled,
        other => {
            return Err(IpcError::invalid_request(format!(
                "unknown feature flag: {other}"
            )))
        }
    }
    settings
        .save(&core.config.data_dir)
        .map_err(|e| IpcError::unknown(format!("settings write failed: {e}")))?;
    Ok(FeatureFlagsResponse::from(&settings.feature_flags))
}

#[cfg(test)]
mod feature_flag_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn feature_flags_default_off_when_settings_file_missing() {
        let dir = tempdir().unwrap();
        let s = Settings::load(dir.path());
        let dto = FeatureFlagsResponse::from(&s.feature_flags);
        assert!(!dto.show_models_section);
    }

    /// Round-trip: write a flag via `Settings::save`, read it back through
    /// the DTO conversion the IPC command uses. Pins the contract that
    /// `cmd_set_feature_flag` -> on-disk -> `cmd_get_feature_flags`
    /// reflects the latest write.
    #[test]
    fn feature_flag_set_then_get_round_trips() {
        let dir = tempdir().unwrap();
        let mut s = Settings::load(dir.path());
        s.feature_flags.show_models_section = true;
        s.save(dir.path()).expect("save settings");

        let reloaded = Settings::load(dir.path());
        let dto = FeatureFlagsResponse::from(&reloaded.feature_flags);
        assert!(dto.show_models_section, "flip should persist across reload");

        // Flip back and confirm idempotency.
        let mut s2 = Settings::load(dir.path());
        s2.feature_flags.show_models_section = false;
        s2.save(dir.path()).expect("save settings");
        let again = Settings::load(dir.path());
        assert!(!FeatureFlagsResponse::from(&again.feature_flags).show_models_section);
    }

    /// The IPC `cmd_set_feature_flag` command rejects unknown names with
    /// `IpcError::InvalidRequest` (rather than silently writing nothing
    /// or no-oping with a successful-looking response). Mirroring the
    /// inline match-arm: if a frontend ever drifts ahead of the Rust
    /// flag definitions, the call surfaces a typed error the client
    /// can render.
    #[test]
    fn unknown_feature_flag_is_invalid_request() {
        let dir = tempdir().unwrap();
        let mut settings = Settings::load(dir.path());
        let known_before = settings.feature_flags.show_models_section;
        let name = "show_made_up_section";

        // Mirror the command body's match — verifying the contract
        // without dragging in `tauri::State`.
        let outcome = match name {
            "show_models_section" => {
                settings.feature_flags.show_models_section = true;
                Ok(())
            }
            other => Err(designer_ipc::IpcError::invalid_request(format!(
                "unknown feature flag: {other}"
            ))),
        };

        match outcome {
            Ok(()) => panic!("unknown flag name should be rejected"),
            Err(designer_ipc::IpcError::InvalidRequest { message }) => {
                assert!(message.contains("unknown feature flag"));
                assert!(message.contains(name));
            }
            Err(other) => panic!("expected InvalidRequest, got {other:?}"),
        }
        // Settings unchanged because no successful arm wrote.
        assert_eq!(settings.feature_flags.show_models_section, known_before);
    }
}
