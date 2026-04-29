//! Tauri `#[tauri::command]` handlers for Phase 21.A1 (learning layer
//! foundation) and Phase 21.A1.2 (proposals over findings). Thin shims
//! over the typed `ipc::cmd_*` functions so tests and the CLI can
//! invoke the same code paths without a Tauri runtime.

use crate::core::AppCore;
use crate::ipc;
use designer_core::ProjectId;
use designer_ipc::{
    FindingDto, IpcError, ListProposalsRequest, ProposalDto, ResolveProposalRequest,
    SignalFindingRequest, SignalProposalRequest,
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn cmd_list_findings(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
) -> Result<Vec<FindingDto>, IpcError> {
    ipc::cmd_list_findings(&core, project_id).await
}

/// Soft-deprecated in Phase 21.A1.2 — calibration thumbs move to
/// `cmd_signal_proposal`. Kept working during the transition window so
/// any code path still calling against findings doesn't break;
/// scheduled for removal once the surface rewrite stabilizes.
#[deprecated(
    note = "calibration moved to cmd_signal_proposal in 21.A1.2; kept working during transition"
)]
#[tauri::command]
pub async fn cmd_signal_finding(
    core: State<'_, Arc<AppCore>>,
    req: SignalFindingRequest,
) -> Result<(), IpcError> {
    ipc::cmd_signal_finding(&core, req).await
}

#[tauri::command]
pub async fn cmd_list_proposals(
    core: State<'_, Arc<AppCore>>,
    req: ListProposalsRequest,
) -> Result<Vec<ProposalDto>, IpcError> {
    ipc::cmd_list_proposals(&core, req).await
}

#[tauri::command]
pub async fn cmd_resolve_proposal(
    core: State<'_, Arc<AppCore>>,
    req: ResolveProposalRequest,
) -> Result<(), IpcError> {
    ipc::cmd_resolve_proposal(&core, req).await
}

#[tauri::command]
pub async fn cmd_signal_proposal(
    core: State<'_, Arc<AppCore>>,
    req: SignalProposalRequest,
) -> Result<(), IpcError> {
    ipc::cmd_signal_proposal(&core, req).await
}
