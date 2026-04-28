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
    // `screencapture -R` takes top-left-origin points. Tauri returns physical
    // pixels for `outer_position` / `inner_size`; divide by the display scale
    // factor to translate back to points.
    let x = (pos.x as f64 / scale).round() as i64;
    let y = (pos.y as f64 / scale).round() as i64;
    let w = (size.width as f64 / scale).round() as i64;
    let h = (size.height as f64 / scale).round() as i64;

    // Stage to a tempfile — `screencapture` to stdout (`-`) is unreliable
    // on older macOS releases. The OS cleans `/tmp/`; the explicit unlink
    // below means no debris if the user runs the dogfood loop hundreds of
    // times in a session.
    let tmp = std::env::temp_dir().join(format!("designer-friction-{}.png", uuid_lite()));
    let region = format!("{x},{y},{w},{h}");
    let tmp_for_task = tmp.clone();
    let bytes = tokio::task::spawn_blocking(move || -> std::io::Result<Vec<u8>> {
        let status = std::process::Command::new("screencapture")
            .args([
                "-x", // silent — no shutter sound
                "-t",
                "png",
                "-R",
                &region,
                tmp_for_task.to_string_lossy().as_ref(),
            ])
            .status()?;
        if !status.success() {
            return Err(std::io::Error::other(format!(
                "screencapture exited with {status}"
            )));
        }
        let bytes = std::fs::read(&tmp_for_task)?;
        let _ = std::fs::remove_file(&tmp_for_task);
        Ok(bytes)
    })
    .await
    .map_err(|e| IpcError::unknown(format!("capture task: {e}")))?
    .map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        IpcError::unknown(format!("screencapture: {e}"))
    })?;
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
async fn capture_viewport(_window: &tauri::WebviewWindow) -> Result<Vec<u8>, IpcError> {
    Err(IpcError::invalid_request(
        "viewport capture is macOS-only in this build",
    ))
}

/// Tiny per-process unique id for the capture tempfile path. Avoids pulling
/// in another `uuid` instance on the call path; the requirement is only
/// "two concurrent captures don't clobber each other's tempfile" which a
/// monotonic counter satisfies.
#[cfg(target_os = "macos")]
fn uuid_lite() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{}-{seq}", std::process::id())
}
