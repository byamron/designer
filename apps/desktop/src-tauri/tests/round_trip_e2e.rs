//! Phase 24I — AppCore round-trip integration test.
//!
//! Drives `cmd_post_message` through the IPC layer, scripts a Phase 24
//! tool-use turn on the mock, parks on the production
//! [`InboxPermissionHandler`], resolves the approval via
//! `cmd_resolve_approval`, and asserts every Phase 24 event lands in the
//! store via the message-coalescer bridge.
//!
//! The test is the contract the harness exists to enable: a user posts,
//! the agent uses a tool, the user approves, the result lands — read
//! from the same event log the projector reads.
//!
//! See `core-docs/roadmap.md` §"Phase 24I" for motivation and
//! `apps/desktop/src-tauri/src/test_support.rs` for the harness itself.

use designer_claude::{ScriptedBlock, ScriptedTurn};
use designer_core::{
    AgentStopReason, ClaudeMessageId, ClaudeSessionId, EventPayload, StreamId, TokenUsage,
};
use designer_desktop::test_support::IntegrationHarness;
use serde_json::json;
use std::time::Duration;

/// End-to-end round trip:
///
/// 1. `cmd_post_message` dispatches a user message to a scripted mock turn.
/// 2. The mock emits `AgentTurnStarted` and a `ToolUse` block; the
///    coalescer mirrors both into the store.
/// 3. The `InboxPermissionHandler` parks the agent on a fresh
///    `ApprovalId`; the harness polls `cmd_list_pending_approvals`
///    until the request appears.
/// 4. `cmd_resolve_approval(granted=true)` wakes the agent — the mock
///    resumes the scripted turn and emits `AgentToolResult` +
///    `AgentTurnEnded`.
/// 5. `ApprovalGranted` lands on the workspace stream (per
///    `InboxPermissionHandler::resolve`'s contract).
///
/// Every assertion reads from `harness.read_events()` so a future
/// refactor of the bridge / projector / IPC layer that breaks the
/// contract surfaces here, not in dogfood.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn user_post_through_tool_approval_to_result() {
    let h = IntegrationHarness::boot().await;
    let project = h.create_project("RoundTrip").await;
    let workspace_id = h.create_workspace(project, "alpha").await;
    let tab_id = h.open_tab(workspace_id).await;
    h.spawn_team(workspace_id, tab_id).await;

    // A two-block turn: a streamed text reply, then a tool use that
    // parks on the inbox until the harness resolves it.
    h.script_turn(
        workspace_id,
        tab_id,
        ScriptedTurn {
            turn_id: ClaudeMessageId::new("msg_round_trip"),
            session_id: ClaudeSessionId::new("sess_round_trip"),
            model: "claude-mock".into(),
            blocks: vec![
                ScriptedBlock::Text {
                    text: "Reading the file first.".into(),
                },
                ScriptedBlock::ToolUse {
                    tool_use_id: "tool_round_trip".into(),
                    name: "Write".into(),
                    input: json!({"file_path": "/tmp/round_trip.txt", "content": "hi"}),
                    result_content: "wrote 2 bytes".into(),
                    is_error: false,
                },
            ],
            stop_reason: AgentStopReason::EndTurn,
            usage: TokenUsage::default(),
        },
    );

    // `cmd_post_message` does not return until the mock's scripted
    // turn completes, and the mock parks on `decide()` until the test
    // resolves the approval. Dispatch on a task so the test thread is
    // free to poll `cmd_list_pending_approvals` and call
    // `cmd_resolve_approval` while the post is in flight.
    let post_handle = {
        let core = h.core.clone();
        tokio::spawn(async move {
            designer_desktop::ipc_agents::cmd_post_message(
                &core,
                designer_ipc::PostMessageRequest {
                    workspace_id,
                    text: "please write the file".into(),
                    attachments: vec![],
                    tab_id: Some(tab_id),
                    model: None,
                },
            )
            .await
        })
    };

    // 1. AgentTurnStarted lands on the workspace stream via the coalescer.
    let turn_started = wait_for_event(&h, Duration::from_secs(2), |env| {
        matches!(&env.payload, EventPayload::AgentTurnStarted { .. })
            && env.stream == StreamId::Workspace(workspace_id)
    })
    .await
    .expect("AgentTurnStarted should land in the event log");
    assert!(matches!(
        &turn_started.payload,
        EventPayload::AgentTurnStarted { turn_id, .. }
            if turn_id.as_str() == "msg_round_trip"
    ));

    // 2. The inbox handler parks on a ToolUse; surface the approval
    // through `cmd_list_pending_approvals` (same IPC the inbox UI uses).
    let pending = wait_for_pending_approval(&h, workspace_id, Duration::from_secs(2))
        .await
        .expect("ApprovalRequested should park on the inbox handler");

    // 3. Resolve via the production IPC. The handler appends
    // `ApprovalGranted` to the workspace stream and wakes the mock.
    h.resolve_approval(pending.approval_id, true, Some("ok"))
        .await
        .expect("cmd_resolve_approval");

    // 4. AgentToolResult must follow the resolution. The coalescer
    // bridges OrchestratorEvent::AgentToolResult into
    // EventPayload::AgentToolResult.
    let tool_result = wait_for_event(&h, Duration::from_secs(2), |env| {
        matches!(&env.payload, EventPayload::AgentToolResult { tool_use_id, .. }
            if tool_use_id == "tool_round_trip")
    })
    .await
    .expect("AgentToolResult should land after the approval is granted");
    if let EventPayload::AgentToolResult {
        content, is_error, ..
    } = &tool_result.payload
    {
        assert_eq!(content, "wrote 2 bytes");
        assert!(!*is_error, "granted tool should not surface is_error=true");
    }

    // 5. AgentTurnEnded — the scripted EndTurn must land after the
    // tool result, with no `Error` reason (the deny path is covered by
    // `crates/designer-claude/src/mock.rs::script_next_turn_tests`).
    let turn_ended = wait_for_event(&h, Duration::from_secs(2), |env| {
        matches!(&env.payload, EventPayload::AgentTurnEnded { turn_id, .. }
            if turn_id.as_str() == "msg_round_trip")
    })
    .await
    .expect("AgentTurnEnded should land");
    assert!(matches!(
        &turn_ended.payload,
        EventPayload::AgentTurnEnded {
            stop_reason: AgentStopReason::EndTurn,
            ..
        }
    ));

    // 6. ApprovalGranted lands on the workspace stream (NOT
    // StreamId::System) — workspace-scoped subscribers see the
    // resolution where they saw the request, per the
    // InboxPermissionHandler contract.
    let approval_granted = wait_for_event(&h, Duration::from_secs(1), |env| {
        matches!(&env.payload, EventPayload::ApprovalGranted { approval_id }
            if *approval_id == pending.approval_id)
    })
    .await
    .expect("ApprovalGranted should land on the workspace stream");
    assert_eq!(
        approval_granted.stream,
        StreamId::Workspace(workspace_id),
        "ApprovalGranted must land on the workspace stream, not System"
    );

    // The spawned post_message future returns once the scripted turn
    // unwinds. A panic / IPC error would otherwise hide behind the
    // event-log assertions.
    post_handle
        .await
        .expect("post_message task panicked")
        .expect("cmd_post_message returned an error");
}

/// Poll `read_events()` until a matching envelope appears or the
/// deadline expires. We poll instead of subscribing so the test reads
/// from the same surface the projector / inbox view use — a regression
/// that breaks the projection but leaves the broadcast intact still
/// fails the test.
async fn wait_for_event<F>(
    h: &IntegrationHarness,
    deadline: Duration,
    pred: F,
) -> Option<designer_core::EventEnvelope>
where
    F: Fn(&designer_core::EventEnvelope) -> bool,
{
    let start = std::time::Instant::now();
    loop {
        if let Some(env) = h.read_events().await.into_iter().find(|e| pred(e)) {
            return Some(env);
        }
        if start.elapsed() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
}

async fn wait_for_pending_approval(
    h: &IntegrationHarness,
    workspace_id: designer_core::WorkspaceId,
    deadline: Duration,
) -> Option<designer_desktop::core_safety::PendingApproval> {
    let start = std::time::Instant::now();
    loop {
        let pending = h.pending_approvals(Some(workspace_id)).await;
        if let Some(p) = pending.into_iter().next() {
            return Some(p);
        }
        if start.elapsed() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
}
