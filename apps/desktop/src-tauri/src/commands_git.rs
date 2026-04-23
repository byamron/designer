//! Tauri `#[tauri::command]` handlers reserved for Phase 13.E (track
//! primitive + git wire + repo linking).
//!
//! Add new handlers here; register them in `lib.rs`'s
//! `tauri::generate_handler![…]` list. Don't touch `commands.rs` or other
//! `commands_*.rs` siblings.
//!
//! See ADR 0002 §D2 for the repo-linking UX (native file picker v1; GitHub
//! URL reserved).

// Phase 13.E will add:
//   #[tauri::command]
//   pub async fn cmd_link_repo(core: State<'_, …>, req: LinkRepoRequest) -> Result<…, IpcError>
//   pub async fn cmd_create_track(core: State<'_, …>, req: CreateTrackRequest) -> Result<Track, IpcError>
//   pub async fn cmd_request_merge(core: State<'_, …>, req: RequestMergeRequest) -> Result<…, IpcError>
