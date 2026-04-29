//! Tauri command shims for Friction (Tracks 13.K + 13.L + 13.M).
//!
//! Mirrors the pattern in `commands.rs` / `commands_safety.rs`: every wire
//! call is a thin wrapper around `ipc::cmd_*`, so tests can hit the same
//! async functions without a Tauri runtime.
//!
//! Track 13.M adds `cmd_capture_viewport`, which shells out to the macOS
//! `screencapture` binary to grab the focused window's bounds as PNG bytes.
//! Tauri 2.10 has no built-in webview-capture API; `screencapture` is the
//! shortest path that ships and degrades gracefully on non-macOS hosts.

use crate::core::AppCore;
use crate::ipc;
use designer_ipc::{
    AddressFrictionRequest, FrictionEntry, FrictionTransitionRequest, IpcError,
    ReportFrictionRequest, ReportFrictionResponse,
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
    req: FrictionTransitionRequest,
) -> Result<(), IpcError> {
    ipc::cmd_resolve_friction(&core, req).await
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
    req: FrictionTransitionRequest,
) -> Result<(), IpcError> {
    ipc::cmd_reopen_friction(&core, req).await
}

/// Capture the focused webview window's region as PNG bytes.
///
/// Track 13.M's ⌘⇧S path. The frontend hides the composer for one frame
/// before invoking this so the composer doesn't appear in its own
/// screenshot — see `FrictionWidget`.
///
/// macOS-only in v1: shells out to the system `screencapture` binary,
/// targeting the window's screen-space rect. The first call triggers a
/// Screen Recording permission prompt; once granted, subsequent calls are
/// silent. Non-macOS hosts return an explicit error so the FE can surface
/// "screenshot unavailable on this platform" rather than an opaque failure.
#[tauri::command]
pub async fn cmd_capture_viewport(window: tauri::WebviewWindow) -> Result<Vec<u8>, IpcError> {
    capture_viewport(&window).await
}

#[cfg(target_os = "macos")]
async fn capture_viewport(window: &tauri::WebviewWindow) -> Result<Vec<u8>, IpcError> {
    let scale = window
        .scale_factor()
        .map_err(|e| IpcError::unknown(format!("scale_factor: {e}")))?;
    let pos = window
        .outer_position()
        .map_err(|e| IpcError::unknown(format!("outer_position: {e}")))?;
    let size = window
        .inner_size()
        .map_err(|e| IpcError::unknown(format!("inner_size: {e}")))?;
    // Tauri returns physical pixels; `screencapture -R` wants points.
    let x = (pos.x as f64 / scale).round() as i64;
    let y = (pos.y as f64 / scale).round() as i64;
    let w = (size.width as f64 / scale).round() as i64;
    let h = (size.height as f64 / scale).round() as i64;
    let region = format!("{x},{y},{w},{h}");

    tokio::task::spawn_blocking(move || -> Result<Vec<u8>, IpcError> {
        let tmp = tempfile::Builder::new()
            .prefix("designer-friction-")
            .suffix(".png")
            .tempfile()
            .map_err(|e| IpcError::unknown(format!("tempfile: {e}")))?;
        let status = std::process::Command::new("screencapture")
            .args([
                "-x",
                "-t",
                "png",
                "-R",
                &region,
                tmp.path().to_string_lossy().as_ref(),
            ])
            .status()
            .map_err(|e| IpcError::unknown(format!("screencapture spawn: {e}")))?;
        if !status.success() {
            return Err(IpcError::unknown(format!(
                "screencapture exited with {status}"
            )));
        }
        std::fs::read(tmp.path()).map_err(|e| IpcError::unknown(format!("read capture: {e}")))
    })
    .await
    .map_err(|e| IpcError::unknown(format!("capture task: {e}")))?
}

#[cfg(not(target_os = "macos"))]
async fn capture_viewport(_window: &tauri::WebviewWindow) -> Result<Vec<u8>, IpcError> {
    Err(IpcError::invalid_request(
        "viewport capture is macOS-only in this build",
    ))
}
