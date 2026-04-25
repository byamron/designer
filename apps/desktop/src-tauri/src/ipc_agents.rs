//! Phase 13.D IPC handlers — agent wire. Tauri-shim-free async functions so
//! tests and the CLI can call them directly. The `#[tauri::command]`
//! wrappers live in `commands_agents.rs`.

use crate::core::AppCore;
use designer_ipc::{IpcError, PostMessageRequest, PostMessageResponse};
use std::sync::Arc;

pub async fn cmd_post_message(
    core: &Arc<AppCore>,
    req: PostMessageRequest,
) -> Result<PostMessageResponse, IpcError> {
    if req.text.trim().is_empty() {
        return Err(IpcError::InvalidRequest(
            "message text must not be empty".into(),
        ));
    }
    let artifact_id = core
        .post_message(req.workspace_id, req.text)
        .await
        .map_err(IpcError::from)?;
    Ok(PostMessageResponse { artifact_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, AppCoreBoot};
    use crate::core_agents::{coalesce_window_from_env, spawn_message_coalescer};
    use crate::ipc as ipc_shared;
    use designer_core::ArtifactKind;
    use designer_safety::CostCap;
    use tempfile::tempdir;

    async fn boot_test_core() -> Arc<AppCore> {
        // Make the coalescer flush almost instantly so the round-trip
        // assertion below doesn't have to wait the production 120 ms.
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "5");
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        let core = AppCore::boot(config).await.unwrap();
        // Production wiring lives in `main.rs`'s `setup`; tests must spawn
        // the coalescer explicitly so the round-trip path is exercised.
        spawn_message_coalescer(core.clone(), coalesce_window_from_env());
        core
    }

    /// Round-trip per the 13.D deliverable: `cmd_post_message` →
    /// `MockOrchestrator` → `MessagePosted` + `ArtifactCreated` event
    /// emission, projector picks them up, `cmd_list_artifacts` returns them.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn round_trip_post_message_to_list_artifacts() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        // Empty workspace starts with zero artifacts.
        let before = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
        assert_eq!(before.len(), 0);

        let resp = cmd_post_message(
            &core,
            PostMessageRequest {
                workspace_id: ws.id,
                text: "Please draft a sequence diagram for the auth flow".into(),
                attachments: vec![],
            },
        )
        .await
        .unwrap();

        // The user-side artifact lands synchronously.
        let mid = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
        assert!(mid.iter().any(|a| a.id == resp.artifact_id));

        // Wait for the mock's simulated reply + the coalescer flush. With
        // DESIGNER_MESSAGE_COALESCE_MS=5 set in boot_test_core, the flush
        // arrives well within 200 ms.
        let mut attempts = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            let now = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
            let saw_message = now
                .iter()
                .any(|a| a.kind == ArtifactKind::Message && a.id != resp.artifact_id);
            let saw_diagram = now.iter().any(|a| a.kind == ArtifactKind::Diagram);
            if saw_message && saw_diagram {
                break;
            }
            attempts += 1;
            assert!(
                attempts < 25,
                "coalescer/diagram artifacts did not land: {:?}",
                now.iter()
                    .map(|a| (a.kind, a.title.clone()))
                    .collect::<Vec<_>>()
            );
        }
    }

    #[tokio::test]
    async fn rejects_empty_text() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let err = cmd_post_message(
            &core,
            PostMessageRequest {
                workspace_id: ws.id,
                text: "   ".into(),
                attachments: vec![],
            },
        )
        .await
        .expect_err("empty text should reject");
        assert!(matches!(err, IpcError::InvalidRequest(_)));
    }
}
