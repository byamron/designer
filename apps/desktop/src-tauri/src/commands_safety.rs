//! Tauri `#[tauri::command]` handlers reserved for Phase 13.G (safety +
//! Keychain).
//!
//! Add new handlers here; register them in `lib.rs`'s
//! `tauri::generate_handler![…]` list. Don't touch `commands.rs` or other
//! `commands_*.rs` siblings.
//!
//! The existing `cmd_request_approval` and `cmd_resolve_approval` in the
//! main `commands.rs` are the initial stubs from Phase 12.C; Phase 13.G
//! enriches them in-place (or supersedes with inbox-scoped variants defined
//! here). Track 13.G picks one and documents the choice in the matching
//! AppCore method docstring.
//!
//! Cost-chip thresholds per ADR 0002 §D4: 50% green / 80% amber / 95% red.

// Phase 13.G will add:
//   #[tauri::command]
//   pub async fn cmd_list_approvals(core: State<'_, …>, req: ListApprovalsRequest) -> Result<Vec<Approval>, IpcError>
//   pub async fn cmd_usage_status(core: State<'_, …>) -> Result<UsageStatus, IpcError>
//   pub async fn cmd_put_secret(core: State<'_, …>, req: PutSecretRequest) -> Result<(), IpcError>
//   pub async fn cmd_get_secret(core: State<'_, …>, req: GetSecretRequest) -> Result<Option<String>, IpcError>
