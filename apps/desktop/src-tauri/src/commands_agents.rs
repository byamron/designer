//! Phase 13.D Tauri command shims — agent wire. Thin wrappers over the async
//! handlers in `ipc_agents.rs`. Registered in `main.rs`'s
//! `tauri::generate_handler![...]` (alphabetical, see `CLAUDE.md`
//! §"Parallel track conventions").

use crate::core::AppCore;
use crate::ipc_agents;
use designer_ipc::{IpcError, PostMessageRequest, PostMessageResponse};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn post_message(
    core: State<'_, Arc<AppCore>>,
    req: PostMessageRequest,
) -> Result<PostMessageResponse, IpcError> {
    ipc_agents::cmd_post_message(&core, req).await
}
