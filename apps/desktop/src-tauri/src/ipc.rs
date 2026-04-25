//! Typed IPC handlers. These are the functions the Tauri shell would register
//! as `#[tauri::command]` once the WebView runtime is wired. They're plain
//! async methods here so tests and the CLI can invoke them directly.
//!
//! Safety invariant: every write goes through here, and every write passes a
//! safety check (scope / cost / approval). Frontend callers cannot bypass.

use crate::core::{AppCore, FallbackReason, HelperStatus, HelperStatusKind, RecoveryKind};
use designer_core::{ArtifactId, ProjectId, Tab, WorkspaceId};
use designer_ipc::*;
use designer_local_models::HelperHealth;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

pub async fn cmd_create_project(
    core: &Arc<AppCore>,
    req: CreateProjectRequest,
) -> Result<ProjectSummary, IpcError> {
    if req.name.trim().is_empty() {
        return Err(IpcError::InvalidRequest("name must not be empty".into()));
    }
    let project = core
        .create_project(req.name, req.root_path)
        .await
        .map_err(IpcError::from)?;
    Ok(ProjectSummary {
        project,
        workspace_count: 0,
    })
}

pub async fn cmd_list_projects(core: &Arc<AppCore>) -> Result<Vec<ProjectSummary>, IpcError> {
    let projects = core.list_projects().await;
    let mut out = Vec::with_capacity(projects.len());
    for p in projects {
        let count = core.workspaces_in(p.id).await.len();
        out.push(ProjectSummary {
            project: p,
            workspace_count: count,
        });
    }
    Ok(out)
}

pub async fn cmd_create_workspace(
    core: &Arc<AppCore>,
    req: CreateWorkspaceRequest,
) -> Result<WorkspaceSummary, IpcError> {
    if req.name.trim().is_empty() {
        return Err(IpcError::InvalidRequest("name must not be empty".into()));
    }
    let workspace = core
        .create_workspace(req.project_id, req.name, req.base_branch)
        .await
        .map_err(IpcError::from)?;
    let state = workspace.state;
    Ok(WorkspaceSummary {
        workspace,
        state,
        agent_count: 0,
    })
}

pub async fn cmd_list_workspaces(
    core: &Arc<AppCore>,
    project_id: ProjectId,
) -> Result<Vec<WorkspaceSummary>, IpcError> {
    let workspaces = core.workspaces_in(project_id).await;
    Ok(workspaces
        .into_iter()
        .map(|w| {
            let state = w.state;
            WorkspaceSummary {
                workspace: w,
                state,
                agent_count: 0,
            }
        })
        .collect())
}

pub async fn cmd_open_tab(core: &Arc<AppCore>, req: OpenTabRequest) -> Result<Tab, IpcError> {
    if req.title.trim().is_empty() {
        return Err(IpcError::InvalidRequest("title must not be empty".into()));
    }
    core.open_tab(req.workspace_id, req.title, req.template)
        .await
        .map_err(IpcError::from)
}

pub async fn cmd_spine(
    core: &Arc<AppCore>,
    workspace_id: Option<WorkspaceId>,
) -> Result<Vec<SpineRow>, IpcError> {
    Ok(core.spine(workspace_id).await)
}

/// Snapshot of the local-model helper. Pure read; never fails, hence no
/// `Result` wrapper.
pub async fn cmd_helper_status(core: &Arc<AppCore>) -> HelperStatusResponse {
    let (status, health) = core.helper_health();
    helper_status_to_response(status, health)
}

/// Approval flow (Phase 13.G).
///
/// **Why `cmd_request_approval` errors out instead of forwarding to the
/// store.** The IPC surface is callable from the webview, including from
/// any future XSS-escaped script. If we let the frontend forge
/// `ApprovalRequested` events, an attacker could plant a fake "Grant
/// write access?" entry in the inbox, wait for the user to click Grant,
/// and have the *next* real agent prompt inherit that granted state via
/// a coincidental id collision (or simply pollute the audit log). The
/// only legitimate producer of approval requests is the
/// `InboxPermissionHandler` invoked by the orchestrator on a real Claude
/// permission prompt. So this IPC stays an error stub — the legacy wire
/// name is preserved only because the `IpcClient` interface still
/// declares `requestApproval` for mock-orchestrator dev flows that
/// haven't been refactored.
pub async fn cmd_request_approval(
    _core: &Arc<AppCore>,
    _workspace_id: WorkspaceId,
    _gate: String,
    _summary: String,
) -> Result<String, IpcError> {
    Err(IpcError::Unknown(
        "cmd_request_approval is internal; agents request approvals via the orchestrator's \
         InboxPermissionHandler. The frontend cannot forge approvals."
            .into(),
    ))
}

pub async fn cmd_resolve_approval(
    core: &Arc<AppCore>,
    id: String,
    granted: bool,
    reason: Option<String>,
) -> Result<(), IpcError> {
    use std::str::FromStr;
    let approval_id = designer_core::ApprovalId::from_str(&id)
        .map_err(|e| IpcError::InvalidRequest(format!("approval id: {e}")))?;
    core.resolve_approval_inbox(approval_id, granted, reason)
        .await
        .map_err(IpcError::from)?;
    Ok(())
}

// ---- Artifacts (Phase 13.1) ----------------------------------------------

pub async fn cmd_list_pinned_artifacts(
    core: &Arc<AppCore>,
    workspace_id: WorkspaceId,
) -> Result<Vec<ArtifactSummary>, IpcError> {
    Ok(core
        .list_pinned_artifacts(workspace_id)
        .await
        .into_iter()
        .map(ArtifactSummary::from)
        .collect())
}

pub async fn cmd_list_artifacts(
    core: &Arc<AppCore>,
    workspace_id: WorkspaceId,
) -> Result<Vec<ArtifactSummary>, IpcError> {
    Ok(core
        .list_artifacts(workspace_id)
        .await
        .into_iter()
        .map(ArtifactSummary::from)
        .collect())
}

pub async fn cmd_get_artifact(
    core: &Arc<AppCore>,
    artifact_id: ArtifactId,
) -> Result<ArtifactDetail, IpcError> {
    let artifact = core
        .get_artifact(artifact_id)
        .await
        .ok_or_else(|| IpcError::NotFound(artifact_id.to_string()))?;
    Ok(ArtifactDetail {
        payload: artifact.payload.clone(),
        summary: ArtifactSummary::from(artifact),
    })
}

pub async fn cmd_toggle_pin_artifact(
    core: &Arc<AppCore>,
    req: TogglePinRequest,
) -> Result<bool, IpcError> {
    core.toggle_pin_artifact(req.artifact_id)
        .await
        .map_err(IpcError::from)
}

fn helper_status_to_response(status: HelperStatus, health: HelperHealth) -> HelperStatusResponse {
    let kind = match status.kind {
        HelperStatusKind::Live => "live".to_string(),
        HelperStatusKind::Fallback => "fallback".to_string(),
    };
    let (fallback_reason, fallback_detail) = match &status.fallback_reason {
        None => (None, None),
        Some(FallbackReason::UserDisabled) => (Some("user_disabled".into()), None),
        Some(FallbackReason::NotConfigured) => (Some("not_configured".into()), None),
        Some(FallbackReason::BinaryMissing { path }) => (
            Some("binary_missing".into()),
            Some(path.display().to_string()),
        ),
        Some(FallbackReason::PingTimeout) => (Some("ping_timeout".into()), None),
        Some(FallbackReason::UnsupportedOs) => (Some("unsupported_os".into()), None),
        Some(FallbackReason::ModelsUnavailable) => (Some("models_unavailable".into()), None),
        Some(FallbackReason::PingFailed { error }) => {
            (Some("ping_failed".into()), Some(error.clone()))
        }
    };
    let (provenance_label, provenance_id) = provenance_for(&status);
    let recovery = status.fallback_reason.as_ref().map(|r| match r.recovery() {
        RecoveryKind::User => "user".to_string(),
        RecoveryKind::Reinstall => "reinstall".to_string(),
        RecoveryKind::None => "none".to_string(),
    });
    let version = status.version.or(health.version);
    let model = status.model.or(health.model);
    let last_restart_ms = health
        .last_restart
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    HelperStatusResponse {
        kind,
        fallback_reason,
        fallback_detail,
        binary_path: status.binary_path,
        version,
        model,
        running: health.running,
        consecutive_failures: health.consecutive_failures,
        last_restart_ms,
        provenance_label,
        provenance_id,
        recovery,
    }
}

/// Single source of truth for the user-facing provenance copy. 13.F surfaces
/// should render these strings verbatim next to helper-derived artifacts;
/// keeping the mapping here means the spine row, Home recap card, and audit
/// tile all get the same label even if they're built independently.
///
/// The `id` is a stable kebab-case token suitable for `aria-describedby`.
fn provenance_for(status: &HelperStatus) -> (String, String) {
    match (&status.kind, status.fallback_reason.as_ref()) {
        (HelperStatusKind::Live, _) => ("Summarized on-device".into(), "provenance-live".into()),
        (
            HelperStatusKind::Fallback,
            Some(FallbackReason::UnsupportedOs | FallbackReason::ModelsUnavailable),
        ) => (
            "On-device models unavailable".into(),
            "provenance-terminal".into(),
        ),
        (HelperStatusKind::Fallback, _) => (
            "Local model briefly unavailable".into(),
            "provenance-transient".into(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn status(kind: HelperStatusKind, reason: Option<FallbackReason>) -> HelperStatus {
        HelperStatus {
            kind,
            fallback_reason: reason,
            binary_path: None,
            version: None,
            model: None,
        }
    }

    #[test]
    fn live_provenance_is_on_device() {
        let resp = helper_status_to_response(
            status(HelperStatusKind::Live, None),
            HelperHealth {
                running: true,
                ..Default::default()
            },
        );
        assert_eq!(resp.kind, "live");
        assert_eq!(resp.provenance_label, "Summarized on-device");
        assert_eq!(resp.provenance_id, "provenance-live");
        assert!(resp.recovery.is_none());
        assert!(resp.fallback_reason.is_none());
    }

    #[test]
    fn unsupported_os_is_terminal_with_no_recovery() {
        let resp = helper_status_to_response(
            status(
                HelperStatusKind::Fallback,
                Some(FallbackReason::UnsupportedOs),
            ),
            HelperHealth::default(),
        );
        assert_eq!(resp.fallback_reason.as_deref(), Some("unsupported_os"));
        assert_eq!(resp.provenance_id, "provenance-terminal");
        assert_eq!(resp.recovery.as_deref(), Some("none"));
    }

    #[test]
    fn models_unavailable_is_terminal_with_no_recovery() {
        let resp = helper_status_to_response(
            status(
                HelperStatusKind::Fallback,
                Some(FallbackReason::ModelsUnavailable),
            ),
            HelperHealth::default(),
        );
        assert_eq!(resp.fallback_reason.as_deref(), Some("models_unavailable"));
        assert_eq!(resp.provenance_id, "provenance-terminal");
        assert_eq!(resp.recovery.as_deref(), Some("none"));
    }

    #[test]
    fn user_disabled_is_user_recoverable() {
        let resp = helper_status_to_response(
            status(
                HelperStatusKind::Fallback,
                Some(FallbackReason::UserDisabled),
            ),
            HelperHealth::default(),
        );
        assert_eq!(resp.fallback_reason.as_deref(), Some("user_disabled"));
        assert_eq!(resp.recovery.as_deref(), Some("user"));
        assert_eq!(resp.provenance_id, "provenance-transient");
    }

    #[test]
    fn binary_missing_includes_path_as_detail() {
        let resp = helper_status_to_response(
            status(
                HelperStatusKind::Fallback,
                Some(FallbackReason::BinaryMissing {
                    path: PathBuf::from("/opt/nope"),
                }),
            ),
            HelperHealth::default(),
        );
        assert_eq!(resp.fallback_reason.as_deref(), Some("binary_missing"));
        assert_eq!(resp.fallback_detail.as_deref(), Some("/opt/nope"));
        assert_eq!(resp.recovery.as_deref(), Some("reinstall"));
    }

    #[test]
    fn ping_failed_preserves_error_in_detail() {
        let resp = helper_status_to_response(
            status(
                HelperStatusKind::Fallback,
                Some(FallbackReason::PingFailed {
                    error: "foundation-models-error: NSCocoaError 42".into(),
                }),
            ),
            HelperHealth::default(),
        );
        assert_eq!(resp.fallback_reason.as_deref(), Some("ping_failed"));
        assert!(resp
            .fallback_detail
            .as_deref()
            .unwrap()
            .contains("NSCocoaError"));
        assert_eq!(resp.recovery.as_deref(), Some("reinstall"));
    }

    #[test]
    fn ping_timeout_offers_reinstall() {
        let resp = helper_status_to_response(
            status(
                HelperStatusKind::Fallback,
                Some(FallbackReason::PingTimeout),
            ),
            HelperHealth::default(),
        );
        assert_eq!(resp.fallback_reason.as_deref(), Some("ping_timeout"));
        assert_eq!(resp.recovery.as_deref(), Some("reinstall"));
    }
}
