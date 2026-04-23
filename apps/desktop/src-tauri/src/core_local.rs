//! AppCore methods reserved for Phase 13.F — local-model surfaces.
//!
//! This file starts as an empty `impl AppCore { … }` block. Track 13.F fills
//! in methods that wrap `LocalOps` (recap, summarize_row, audit_claim) and
//! expose them to the frontend. Other tracks never edit this file.
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Mark cross-track hooks with `// TODO(13.X):` so grep finds them.
//! - IPC handlers live in `commands_local.rs`.
//! - Do **not** touch `core.rs` itself.
//! - `HelperStatus` and `HelperEvent` are already plumbed from Phase 12.B;
//!   13.F surfaces them in the UI via `provenance_label` + `provenance_id`
//!   (see `designer_ipc::HelperStatusResponse`).

use crate::core::AppCore;

#[allow(dead_code, reason = "reserved for Phase 13.F — local-model surfaces")]
impl AppCore {
    // Phase 13.F will land:
    //   pub async fn recap(&self, window: RecapWindow) -> Result<RecapResponse, …>
    //   pub async fn summarize_row(&self, row: SpineRowId) -> Result<String, …>
    //   pub async fn audit_claim(&self, claim: AuditClaim) -> Result<AuditVerdict, …>
    //
    // All three delegate to `self.local_ops` and render provenance via the
    // Phase 12.B DTO vocabulary.
}
