//! IPC integration smokes. Drive `ipc::cmd_*` directly against a real
//! `AppCore` (mock orchestrator, sqlite in a tempdir). The Tauri shell is
//! a thin pass-through over these functions, so green here = the desktop
//! command surface works end-to-end without booting a WebView.
//!
//! See `core-docs/testing-strategy.md` §4 (IPC integration tests).

use designer_desktop::core::{AppConfig, AppCore};
use designer_desktop::ipc;
use designer_ipc::{CreateProjectRequest, CreateWorkspaceRequest, OpenTabRequest};
use designer_safety::CostCap;
use std::sync::Arc;
use tempfile::TempDir;

struct TestEnv {
    core: Arc<AppCore>,
    _data_dir: TempDir,
    project_root: TempDir,
}

async fn boot() -> TestEnv {
    let data_dir = tempfile::tempdir().expect("tempdir for data");
    let project_root = tempfile::tempdir().expect("tempdir for project root");
    let config = AppConfig {
        data_dir: data_dir.path().to_path_buf(),
        use_mock_orchestrator: true,
        claude_options: Default::default(),
        default_cost_cap: CostCap {
            max_dollars_cents: None,
            max_tokens: None,
        },
        helper_binary_path: None,
    };
    let core = AppCore::boot_with_orchestrator(config, None)
        .await
        .expect("boot");
    TestEnv {
        core,
        _data_dir: data_dir,
        project_root,
    }
}

/// Smoke: project → workspace → tab round-trips through the IPC layer
/// and surfaces back via the read-side commands.
#[tokio::test]
async fn project_workspace_tab_round_trip() {
    let env = boot().await;
    let project = ipc::cmd_create_project(
        &env.core,
        CreateProjectRequest {
            name: "Demo".into(),
            root_path: env.project_root.path().to_path_buf(),
        },
    )
    .await
    .expect("create project");

    // Read-side surfaces it.
    let listed = ipc::cmd_list_projects(&env.core).await.unwrap();
    assert!(listed.iter().any(|p| p.project.id == project.project.id));

    let ws = ipc::cmd_create_workspace(
        &env.core,
        CreateWorkspaceRequest {
            project_id: project.project.id,
            name: "alpha".into(),
            base_branch: "main".into(),
        },
    )
    .await
    .expect("create workspace");

    let workspaces = ipc::cmd_list_workspaces(&env.core, project.project.id)
        .await
        .unwrap();
    assert_eq!(workspaces.len(), 1);
    assert_eq!(workspaces[0].workspace.id, ws.workspace.id);

    let tab = ipc::cmd_open_tab(
        &env.core,
        OpenTabRequest {
            workspace_id: ws.workspace.id,
            title: "Plan".into(),
            template: designer_core::TabTemplate::Thread,
            artifact_id: None,
        },
    )
    .await
    .expect("open tab");
    assert_eq!(tab.title, "Plan");

    // Spine reflects the new workspace activity.
    let spine = ipc::cmd_spine(&env.core, Some(ws.workspace.id))
        .await
        .unwrap();
    assert!(
        !spine.is_empty(),
        "spine should have at least one row after tab open"
    );
}

/// `validate_project_path` is the inline check the create-project modal
/// uses to grey out submit. Boundary errors must surface as
/// `IpcError::InvalidRequest` so the frontend can render them — silent
/// validation drift would hide bad paths from users until create.
#[tokio::test]
async fn validate_project_path_boundary_checks() {
    use designer_ipc::IpcError;
    let env = boot().await;

    // Empty input.
    let err = ipc::cmd_validate_project_path(&env.core, "".into())
        .await
        .expect_err("empty path should reject");
    assert!(matches!(err, IpcError::InvalidRequest { .. }));

    // Relative path.
    let err = ipc::cmd_validate_project_path(&env.core, "relative/path".into())
        .await
        .expect_err("relative path should reject");
    assert!(matches!(err, IpcError::InvalidRequest { .. }));

    // Non-existent absolute.
    let err =
        ipc::cmd_validate_project_path(&env.core, "/does/not/exist/at/all/designer-test".into())
            .await
            .expect_err("missing path should reject");
    assert!(matches!(err, IpcError::InvalidRequest { .. }));

    // Existing directory canonicalizes successfully.
    let ok = ipc::cmd_validate_project_path(
        &env.core,
        env.project_root.path().to_string_lossy().into_owned(),
    )
    .await
    .expect("existing dir should pass");
    assert!(!ok.is_empty());
}

/// Two workspaces in one project both surface through the read-side
/// IPC. Projection drift would let one disappear after the other lands.
#[tokio::test]
async fn multi_workspace_projection() {
    let env = boot().await;
    let project = ipc::cmd_create_project(
        &env.core,
        CreateProjectRequest {
            name: "Multi".into(),
            root_path: env.project_root.path().to_path_buf(),
        },
    )
    .await
    .unwrap();

    for name in ["alpha", "beta"] {
        ipc::cmd_create_workspace(
            &env.core,
            CreateWorkspaceRequest {
                project_id: project.project.id,
                name: name.into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();
    }

    let workspaces = ipc::cmd_list_workspaces(&env.core, project.project.id)
        .await
        .unwrap();
    assert_eq!(workspaces.len(), 2);
    let mut names: Vec<&str> = workspaces
        .iter()
        .map(|w| w.workspace.name.as_str())
        .collect();
    names.sort();
    assert_eq!(names, vec!["alpha", "beta"]);
}

/// Restart persistence: drop the AppCore, reconstruct against the same
/// data dir, projections rebuild from the event store. A regression
/// here means data invisible after relaunch — top-of-funnel breakage.
#[tokio::test]
async fn restart_persistence_survives_drop_and_boot() {
    let data_dir = tempfile::tempdir().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let config = AppConfig {
        data_dir: data_dir.path().to_path_buf(),
        use_mock_orchestrator: true,
        claude_options: Default::default(),
        default_cost_cap: CostCap {
            max_dollars_cents: None,
            max_tokens: None,
        },
        helper_binary_path: None,
    };

    let (project_id, workspace_name) = {
        let core = AppCore::boot_with_orchestrator(config.clone(), None)
            .await
            .unwrap();
        let project = ipc::cmd_create_project(
            &core,
            CreateProjectRequest {
                name: "Persisted".into(),
                root_path: project_root.path().to_path_buf(),
            },
        )
        .await
        .unwrap();
        ipc::cmd_create_workspace(
            &core,
            CreateWorkspaceRequest {
                project_id: project.project.id,
                name: "kept".into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();
        (project.project.id, "kept".to_string())
        // core dropped here at end of scope.
    };

    // Allow tokio's background tasks holding `Arc<AppCore>` clones to
    // wind down before the second boot opens the same sqlite file.
    tokio::task::yield_now().await;

    let revived = AppCore::boot_with_orchestrator(config, None).await.unwrap();
    let projects = ipc::cmd_list_projects(&revived).await.unwrap();
    assert!(
        projects.iter().any(|p| p.project.id == project_id),
        "project should survive restart"
    );
    let workspaces = ipc::cmd_list_workspaces(&revived, project_id)
        .await
        .unwrap();
    assert!(
        workspaces
            .iter()
            .any(|w| w.workspace.name == workspace_name),
        "workspace should survive restart"
    );
}
