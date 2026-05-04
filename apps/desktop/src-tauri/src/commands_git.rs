//! Tauri `#[tauri::command]` handlers for Phase 13.E (track primitive +
//! git wire + repo linking). Thin shims over the typed `ipc::cmd_*`
//! functions so tests and the CLI can invoke the same code paths
//! without a Tauri runtime.

use crate::core::AppCore;
use crate::ipc;
use designer_core::{TrackId, WorkspaceId};
use designer_ipc::{
    CompleteTrackRequest, IpcError, LinkRepoRequest, RequestMergeRequest, StartTrackRequest,
    TrackSummary, UnlinkRepoRequest,
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn cmd_link_repo(
    core: State<'_, Arc<AppCore>>,
    req: LinkRepoRequest,
) -> Result<(), IpcError> {
    ipc::cmd_link_repo(&core, req).await
}

#[tauri::command]
pub async fn cmd_unlink_repo(
    core: State<'_, Arc<AppCore>>,
    req: UnlinkRepoRequest,
) -> Result<(), IpcError> {
    ipc::cmd_unlink_repo(&core, req).await
}

#[tauri::command]
pub async fn cmd_start_track(
    core: State<'_, Arc<AppCore>>,
    req: StartTrackRequest,
) -> Result<TrackId, IpcError> {
    ipc::cmd_start_track(&core, req).await
}

#[tauri::command]
pub async fn cmd_request_merge(
    core: State<'_, Arc<AppCore>>,
    req: RequestMergeRequest,
) -> Result<u64, IpcError> {
    ipc::cmd_request_merge(&core, req).await
}

#[tauri::command]
pub async fn cmd_complete_track(
    core: State<'_, Arc<AppCore>>,
    req: CompleteTrackRequest,
) -> Result<(), IpcError> {
    ipc::cmd_complete_track(&core, req).await
}

#[tauri::command]
pub async fn cmd_list_tracks(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
) -> Result<Vec<TrackSummary>, IpcError> {
    ipc::cmd_list_tracks(&core, workspace_id).await
}

#[tauri::command]
pub async fn cmd_get_track(
    core: State<'_, Arc<AppCore>>,
    track_id: TrackId,
) -> Result<TrackSummary, IpcError> {
    ipc::cmd_get_track(&core, track_id).await
}
