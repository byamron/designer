//! Tauri `#[tauri::command]` handlers reserved for Phase 13.F (local-model
//! surfaces).
//!
//! Add new handlers here; register them in `lib.rs`'s
//! `tauri::generate_handler![…]` list. Don't touch `commands.rs` or other
//! `commands_*.rs` siblings.
//!
//! The existing `cmd_helper_status` from Phase 12.B stays in the main
//! `commands.rs` (it's session-bootstrap information, not a 13.F-owned
//! surface). Phase 13.F only adds the recap / summarize / audit handlers.

// Phase 13.F will add:
//   #[tauri::command]
//   pub async fn cmd_recap(core: State<'_, …>, req: RecapRequest) -> Result<RecapResponse, IpcError>
//   pub async fn cmd_summarize_row(core: State<'_, …>, req: SummarizeRowRequest) -> Result<String, IpcError>
//   pub async fn cmd_audit_claim(core: State<'_, …>, req: AuditClaimRequest) -> Result<AuditVerdict, IpcError>
