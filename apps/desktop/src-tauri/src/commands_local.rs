//! Tauri `#[tauri::command]` handlers for Phase 13.F (local-model surfaces).
//!
//! Three new commands:
//! - `cmd_recap_workspace` — produces a `report` artifact summarizing the
//!   workspace's recent activity via `LocalOps::recap`.
//! - `cmd_audit_artifact` — runs `LocalOps::audit_claim` against an artifact's
//!   summary and emits a `comment` artifact anchored to it (author_role
//!   `"auditor"`).
//! - `cmd_helper_status` — re-exports the existing read on `AppCore::helper_health`
//!   that 12.B introduced. (Lives in `commands.rs` as well, but tracks
//!   register their own surface here for grep-ability.)
//!
//! The existing `cmd_helper_status` in `commands.rs` is unchanged — this file
//! adds new commands; it does not duplicate that one.

use crate::core::AppCore;
use designer_core::{ArtifactId, WorkspaceId};
use designer_ipc::{ArtifactSummary, IpcError};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecapWorkspaceRequest {
    pub workspace_id: WorkspaceId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditArtifactRequest {
    pub artifact_id: ArtifactId,
    /// Workspace the caller believes the target lives in. Validated against
    /// the projector's record so a misbehaving caller cannot land an audit
    /// comment in a workspace it didn't intend to write to. This is the
    /// future seam for per-workspace authorization in 13.G — for now it's a
    /// structural integrity check.
    pub expected_workspace_id: WorkspaceId,
    pub claim: String,
}

#[tauri::command]
pub async fn cmd_recap_workspace(
    core: State<'_, Arc<AppCore>>,
    req: RecapWorkspaceRequest,
) -> Result<ArtifactSummary, IpcError> {
    let env = core
        .recap_workspace(req.workspace_id)
        .await
        .map_err(IpcError::from)?;
    artifact_from_env(&core, &env).await
}

#[tauri::command]
pub async fn cmd_audit_artifact(
    core: State<'_, Arc<AppCore>>,
    req: AuditArtifactRequest,
) -> Result<ArtifactSummary, IpcError> {
    if req.claim.trim().is_empty() {
        return Err(IpcError::invalid_request("claim must not be empty"));
    }
    let env = core
        .audit_artifact(req.artifact_id, req.expected_workspace_id, req.claim)
        .await
        .map_err(|e| match e {
            // Cross-workspace boundary violation surfaces as InvalidRequest
            // (the data-shape error) so a frontend can distinguish it from a
            // missing/archived artifact (NotFound).
            designer_core::CoreError::Invariant(msg) => IpcError::invalid_request(msg),
            designer_core::CoreError::NotFound(msg) => IpcError::not_found(msg),
            other => IpcError::from(other),
        })?;
    artifact_from_env(&core, &env).await
}

async fn artifact_from_env(
    core: &Arc<AppCore>,
    env: &designer_core::EventEnvelope,
) -> Result<ArtifactSummary, IpcError> {
    if let designer_core::EventPayload::ArtifactCreated { artifact_id, .. } = &env.payload {
        let a = core
            .get_artifact(*artifact_id)
            .await
            .ok_or_else(|| IpcError::not_found(artifact_id.to_string()))?;
        Ok(ArtifactSummary::from(a))
    } else {
        Err(IpcError::unknown("expected ArtifactCreated envelope"))
    }
}
