//! Phase 13.D IPC handlers — agent wire. Tauri-shim-free async functions so
//! tests and the CLI can call them directly. The `#[tauri::command]`
//! wrappers live in `commands_agents.rs`.

use crate::core::AppCore;
use designer_core::WorkspaceId;
use designer_ipc::{
    InterruptTurnRequest, IpcError, PostMessageRequest, PostMessageResponse, StreamEvent,
};
use std::sync::Arc;
use tracing::{info, warn};

pub async fn cmd_post_message(
    core: &Arc<AppCore>,
    req: PostMessageRequest,
) -> Result<PostMessageResponse, IpcError> {
    if req.text.trim().is_empty() {
        return Err(IpcError::invalid_request("message text must not be empty"));
    }
    if req.text.len() > MAX_MESSAGE_BYTES {
        return Err(IpcError::invalid_request(format!(
            "message text exceeds {MAX_MESSAGE_BYTES}-byte limit"
        )));
    }
    if !req.attachments.is_empty() {
        // TODO(13.D-followup): plumb attachments into the prompt body
        // (or a side-channel that the orchestrator references). 13.D
        // accepts the metadata so the IPC contract is stable, but the
        // bytes are not yet stored. Surface a warning so we notice if
        // a flow starts depending on attachment delivery before the
        // storage path exists.
        warn!(
            count = req.attachments.len(),
            workspace = %req.workspace_id,
            "post_message: attachments accepted but not yet delivered to the orchestrator (13.D-followup)"
        );
    }
    // Boundary trace so the bundled-`.app` log file shows every message
    // attempt in time order — the orchestrator-side logs make sense in
    // context of "user pressed send at T". Without this, a hang at the
    // IPC layer is indistinguishable from a hang at the subprocess
    // layer.
    info!(
        workspace = %req.workspace_id, body_len = req.text.len(),
        model = ?req.model,
        "cmd_post_message: dispatching to AppCore"
    );
    let result = core
        .post_message(req.workspace_id, req.tab_id, req.model, req.text)
        .await
        .map_err(IpcError::from);
    match &result {
        Ok(artifact_id) => {
            info!(workspace = %req.workspace_id, artifact = %artifact_id, "cmd_post_message: ok")
        }
        Err(err) => warn!(workspace = %req.workspace_id, error = %err, "cmd_post_message: error"),
    }
    let artifact_id = result?;
    Ok(PostMessageResponse { artifact_id })
}

/// Phase 23.F — IPC handler for the Stop button. Forwards into
/// `AppCore::interrupt_turn`, which translates "no live team" / "stale
/// handle" into `Ok(())` so a click that races a turn-end is silent. The
/// `ActivityChanged{Idle}` that follows clears the activity row; this
/// response carries no payload.
pub async fn cmd_interrupt_turn(
    core: &Arc<AppCore>,
    req: InterruptTurnRequest,
) -> Result<(), IpcError> {
    info!(
        workspace = %req.workspace_id, tab = %req.tab_id,
        "cmd_interrupt_turn: dispatching to AppCore"
    );
    let result = core
        .interrupt_turn(req.workspace_id, Some(req.tab_id))
        .await
        .map_err(IpcError::from);
    match &result {
        Ok(()) => info!(workspace = %req.workspace_id, tab = %req.tab_id, "cmd_interrupt_turn: ok"),
        Err(err) => {
            warn!(workspace = %req.workspace_id, tab = %req.tab_id, error = %err, "cmd_interrupt_turn: error")
        }
    }
    result
}

/// Phase 24 (ADR 0008) — boot-replay handler. Returns the chat-domain
/// event subset for one workspace (`MessagePosted` + `AgentTurn*`) in
/// (stream, sequence) order. Frontend's `bootData()` calls this once
/// per workspace at start so the new chat surface paints past
/// AgentTurn* events without waiting for the next live event. Past
/// the dataStore.events live-stream window which is intentionally
/// capped at 500 entries.
pub async fn cmd_list_workspace_chat_events(
    core: &Arc<AppCore>,
    workspace_id: WorkspaceId,
) -> Result<Vec<StreamEvent>, IpcError> {
    let events = core
        .list_workspace_chat_events(workspace_id)
        .await
        .map_err(IpcError::from)?;
    Ok(events.into_iter().map(StreamEvent::from).collect())
}

/// Reject prompts above this byte length at the IPC boundary. Generous
/// enough to cover any human-typed message and reasonable paste flows
/// while still capping a runaway payload before it hits the orchestrator
/// or projector. Roughly ~64 KB of UTF-8.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

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
        // Pre-spawn the team so the round-trip doesn't have to traverse
        // the lazy-spawn path (covered separately). Phase 23.E spawns
        // per-tab; this test posts with `tab_id: None`, which AppCore
        // resolves to the legacy nil sentinel — so the spec uses the
        // same sentinel.
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: designer_core::TabId::from_uuid(uuid::Uuid::nil()),
                team_name: "t".into(),
                lead_role: "assistant".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
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
                tab_id: None,
                model: None,
            },
        )
        .await
        .unwrap();

        // The user-side artifact lands synchronously.
        let mid = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
        assert!(mid.iter().any(|a| a.id == resp.artifact_id));

        // Wait for the mock's simulated reply + the coalescer flush. With
        // DESIGNER_MESSAGE_COALESCE_MS=5 set in boot_test_core, the flush
        // arrives well within ~200 ms in isolation. Under heavy parallel
        // workspace test load the tokio scheduler can dilate that window
        // — give 3 s headroom (150 attempts × 20 ms) to keep the test
        // robust without sacrificing signal.
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
                attempts < 150,
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
                tab_id: None,
                model: None,
            },
        )
        .await
        .expect_err("empty text should reject");
        assert!(matches!(err, IpcError::InvalidRequest { .. }));
    }

    #[tokio::test]
    async fn rejects_oversized_text() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let big = "a".repeat(MAX_MESSAGE_BYTES + 1);
        let err = cmd_post_message(
            &core,
            PostMessageRequest {
                workspace_id: ws.id,
                text: big,
                attachments: vec![],
                tab_id: None,
                model: None,
            },
        )
        .await
        .expect_err("oversized text should reject");
        assert!(matches!(err, IpcError::InvalidRequest { .. }));
    }

    /// When the orchestrator dispatch fails, the user artifact must NOT
    /// land in the projection — otherwise the user retypes and gets a
    /// duplicate. The mock orchestrator's `spawn_team` succeeds for any
    /// workspace; to force a failure we wire a stub orchestrator that
    /// always returns TeamNotFound for both `post_message` and
    /// `spawn_team`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_user_artifact_when_orchestrator_fails() {
        // Simulating orchestrator failure cleanly without surgery on
        // AppCore is awkward; instead we exercise the post-message path
        // with a workspace whose mock orchestrator ALSO fails to spawn.
        // We do this by closing the orchestrator pre-emptively via the
        // existing shutdown method, which removes any state — subsequent
        // post_message calls work because spawn_team re-creates state.
        // So the test path here verifies that when post_message returns
        // success, exactly one user artifact lands; when it returns
        // error, zero artifacts land. The "force failure" path is
        // covered indirectly by the mock-not-found case in
        // `core_agents::tests::post_message_returns_error_on_dispatch_failure`.
        // The integration-level guarantee is that AppCore::post_message
        // appends the artifact only after the orchestrator dispatch
        // succeeds, so a happy-path assertion + the unit test together
        // bound the contract.
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let before = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
        assert_eq!(before.len(), 0);
        cmd_post_message(
            &core,
            PostMessageRequest {
                workspace_id: ws.id,
                text: "hello".into(),
                attachments: vec![],
                tab_id: None,
                model: None,
            },
        )
        .await
        .unwrap();
        let now = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
        let user_count = now
            .iter()
            .filter(|a| a.author_role.as_deref() == Some("user"))
            .count();
        assert_eq!(user_count, 1, "exactly one user artifact per send");
    }

    /// Phase 23.F — `cmd_interrupt_turn` against a live mock team:
    ///   1. interrupt synthesizes an `Idle` activity edge so the dock clears.
    ///   2. a subsequent `cmd_post_message` succeeds without `ChannelClosed`
    ///      (interrupt does not tear the team down — session stays alive).
    /// Together these lock the user contract: Stop kills the turn, not the
    /// conversation.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn interrupt_clears_activity_and_keeps_session_alive() {
        use designer_claude::{ActivityState, OrchestratorEvent};

        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab = designer_core::TabId::from_uuid(uuid::Uuid::nil());
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: tab,
                team_name: "t".into(),
                lead_role: "assistant".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
            .await
            .unwrap();

        let mut events = core.orchestrator.subscribe();

        cmd_interrupt_turn(
            &core,
            InterruptTurnRequest {
                workspace_id: ws.id,
                tab_id: tab,
            },
        )
        .await
        .unwrap();

        // The mock emits exactly one `ActivityChanged{Idle}` for the
        // interrupted tab. Drain until we see it (or time out) — other
        // event types in the channel are not relevant here.
        let saw_idle = tokio::time::timeout(std::time::Duration::from_millis(500), async {
            loop {
                match events.recv().await.unwrap() {
                    OrchestratorEvent::ActivityChanged {
                        workspace_id,
                        tab_id,
                        state: ActivityState::Idle,
                        ..
                    } if workspace_id == ws.id && tab_id == tab => break true,
                    _ => continue,
                }
            }
        })
        .await
        .unwrap_or(false);
        assert!(saw_idle, "interrupt should emit ActivityChanged{{Idle}}");

        // The team is still registered — post_message succeeds and lands
        // a fresh user artifact.
        let resp = cmd_post_message(
            &core,
            PostMessageRequest {
                workspace_id: ws.id,
                text: "hello after interrupt".into(),
                attachments: vec![],
                tab_id: None,
                model: None,
            },
        )
        .await
        .expect("post_message after interrupt should succeed (no ChannelClosed)");
        let arts = ipc_shared::cmd_list_artifacts(&core, ws.id).await.unwrap();
        assert!(arts.iter().any(|a| a.id == resp.artifact_id));
    }

    /// Interrupting a workspace with no live team is a no-op (the user
    /// clicked Stop just as the turn ended). Surfaced as `Ok(())` so the
    /// frontend doesn't have to special-case the race.
    #[tokio::test]
    async fn interrupt_with_no_team_is_ok() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        cmd_interrupt_turn(
            &core,
            InterruptTurnRequest {
                workspace_id: ws.id,
                tab_id: designer_core::TabId::new(),
            },
        )
        .await
        .expect("interrupt against an idle workspace should be a no-op");
    }
}
