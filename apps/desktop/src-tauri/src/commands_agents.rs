//! Phase 13.D Tauri command shims — agent wire. Thin wrappers over the async
//! handlers in `ipc_agents.rs`. Registered in `main.rs`'s
//! `tauri::generate_handler![...]` (alphabetical, see `CLAUDE.md`
//! §"Parallel track conventions").

use crate::core::AppCore;
use crate::ipc_agents;
use designer_core::WorkspaceId;
use designer_ipc::{
    InterruptTurnRequest, IpcError, PostMessageRequest, PostMessageResponse, StreamEvent,
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn interrupt_turn(
    core: State<'_, Arc<AppCore>>,
    req: InterruptTurnRequest,
) -> Result<(), IpcError> {
    ipc_agents::cmd_interrupt_turn(&core, req).await
}

/// Phase 24 (ADR 0008) — boot-replay command. Returns the workspace's
/// chat-domain event history so the new chat surface can fold past
/// `AgentTurn*` events at app start without waiting for live events.
#[tauri::command]
pub async fn list_workspace_chat_events(
    core: State<'_, Arc<AppCore>>,
    workspace_id: WorkspaceId,
) -> Result<Vec<StreamEvent>, IpcError> {
    ipc_agents::cmd_list_workspace_chat_events(&core, workspace_id).await
}

#[tauri::command]
pub async fn post_message(
    core: State<'_, Arc<AppCore>>,
    req: PostMessageRequest,
) -> Result<PostMessageResponse, IpcError> {
    ipc_agents::cmd_post_message(&core, req).await
}
