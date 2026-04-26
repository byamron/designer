//! Typed IPC handlers. These are the functions the Tauri shell would register
//! as `#[tauri::command]` once the WebView runtime is wired. They're plain
//! async methods here so tests and the CLI can invoke them directly.
//!
//! Safety invariant: every write goes through here, and every write passes a
//! safety check (scope / cost / approval). Frontend callers cannot bypass.

use crate::core::{AppCore, FallbackReason, HelperStatus, HelperStatusKind, RecoveryKind};
use designer_core::{ArtifactId, ProjectId, Tab, TrackId, WorkspaceId};
use designer_ipc::*;
use designer_local_models::HelperHealth;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

pub async fn cmd_create_project(
    core: &Arc<AppCore>,
    req: CreateProjectRequest,
) -> Result<ProjectSummary, IpcError> {
    if req.name.trim().is_empty() {
        return Err(IpcError::invalid_request("name must not be empty"));
    }
    // Expand `~` and validate the path on the way in. Without this, a user
    // typing `~/code/foo` (or a stale path) gets a project that "succeeds"
    // but every subsequent git/worktree op explodes with confusing errors.
    let resolved = expand_and_validate_dir(&req.root_path.to_string_lossy())
        .map_err(IpcError::invalid_request)?;
    let project = core
        .create_project(req.name, resolved)
        .await
        .map_err(IpcError::from)?;
    Ok(ProjectSummary {
        project,
        workspace_count: 0,
    })
}

/// Inline-validation IPC for the create-project / link-repo modals so the
/// UI can grey out the submit button before the user clicks. Returns the
/// canonical absolute path on success, or a typed error reason. Does NOT
/// mutate state — pure check.
pub async fn cmd_validate_project_path(
    _core: &Arc<AppCore>,
    path: String,
) -> Result<String, IpcError> {
    let resolved = expand_and_validate_dir(&path).map_err(IpcError::invalid_request)?;
    Ok(resolved.to_string_lossy().into_owned())
}

/// Expand `~` to `$HOME` and return the canonical absolute path if it
/// exists and is a directory. Otherwise return a user-facing reason
/// suitable for an `IpcError::InvalidRequest` message.
fn expand_and_validate_dir(input: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Path is required.".into());
    }
    let expanded = expand_tilde(trimmed);
    let path = std::path::Path::new(&expanded);
    if !path.is_absolute() {
        return Err(format!(
            "Path must be absolute (got `{}`). Tip: drag-drop a folder from Finder, or paste an absolute path like `/Users/you/code/project`.",
            trimmed
        ));
    }
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }
    // Canonicalize to resolve symlinks + normalize. Failure shouldn't
    // block; fall back to the expanded form.
    Ok(path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
}

fn expand_tilde(input: &str) -> String {
    if let Some(rest) = input.strip_prefix('~') {
        if rest.is_empty() || rest.starts_with('/') {
            if let Ok(home) = std::env::var("HOME") {
                return format!("{home}{rest}");
            }
        }
    }
    input.to_string()
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
        return Err(IpcError::invalid_request("name must not be empty"));
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
        return Err(IpcError::invalid_request("title must not be empty"));
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
    Err(IpcError::unknown(
        "cmd_request_approval is internal; agents request approvals via the orchestrator's \
         InboxPermissionHandler. The frontend cannot forge approvals.",
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
        .map_err(|e| IpcError::invalid_request(format!("approval id: {e}")))?;
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
        .ok_or_else(|| IpcError::not_found(artifact_id.to_string()))?;
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

// ---- Track + git wire (Phase 13.E) ---------------------------------------

pub async fn cmd_link_repo(core: &Arc<AppCore>, req: LinkRepoRequest) -> Result<(), IpcError> {
    if req.repo_path.as_os_str().is_empty() {
        return Err(IpcError::invalid_request("repo_path must not be empty"));
    }
    core.link_repo(req.workspace_id, req.repo_path)
        .await
        .map_err(IpcError::from)
}

pub async fn cmd_start_track(
    core: &Arc<AppCore>,
    req: StartTrackRequest,
) -> Result<TrackId, IpcError> {
    if req.branch.trim().is_empty() {
        return Err(IpcError::invalid_request("branch must not be empty"));
    }
    core.start_track(req.workspace_id, req.branch, req.base)
        .await
        .map_err(IpcError::from)
}

pub async fn cmd_request_merge(
    core: &Arc<AppCore>,
    req: RequestMergeRequest,
) -> Result<u64, IpcError> {
    core.request_merge(req.track_id)
        .await
        .map_err(IpcError::from)
}

pub async fn cmd_list_tracks(
    core: &Arc<AppCore>,
    workspace_id: WorkspaceId,
) -> Result<Vec<TrackSummary>, IpcError> {
    Ok(core
        .list_tracks(workspace_id)
        .await
        .into_iter()
        .map(TrackSummary::from)
        .collect())
}

pub async fn cmd_get_track(
    core: &Arc<AppCore>,
    track_id: TrackId,
) -> Result<TrackSummary, IpcError> {
    core.get_track(track_id)
        .await
        .map(TrackSummary::from)
        .ok_or_else(|| IpcError::not_found(track_id.to_string()))
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
