//! Tauri `#[tauri::command]` handlers reserved for Phase 13.D (agent wire).
//!
//! Add new handlers here; register them in `lib.rs`'s
//! `tauri::generate_handler![…]` list. Don't touch `commands.rs` or other
//! `commands_*.rs` siblings.
//!
//! Handlers are thin: they delegate to methods on `AppCore` (defined in
//! `core_agents.rs`) and pass through `Result<_, IpcError>`.
//!
//! See ADR 0002 §D1 (workspace-lead session model) and §D3 (default
//! permission policy) for the scoping decisions.

// Phase 13.D will add:
//   #[tauri::command]
//   pub async fn cmd_post_message(
//       core: State<'_, Arc<AppCore>>,
//       req: PostMessageRequest,
//   ) -> Result<(), IpcError> { … }
