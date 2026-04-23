//! AppCore methods reserved for Phase 13.D — agent wire.
//!
//! This file intentionally starts as an empty `impl AppCore { … }` block so
//! the Phase 13.0 scaffolding can partition the `AppCore` surface across the
//! four Phase 13 tracks without file-level contention. Track 13.D fills in
//! methods here (`post_message`, permission-prompt routing, streaming-reply
//! fan-out, etc.); other tracks never edit this file.
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Mark cross-track hooks with `// TODO(13.X):` so grep finds them.
//! - Keep method bodies here; IPC handlers live in `commands_agents.rs`.
//! - Do **not** touch `core.rs` itself. Add methods to this `impl` block.

use crate::core::AppCore;

#[allow(dead_code, reason = "reserved for Phase 13.D — agent wire")]
impl AppCore {
    // Phase 13.D will land:
    //   pub async fn post_message(
    //       &self,
    //       workspace_id: WorkspaceId,
    //       author_role: String,
    //       body: String,
    //   ) -> Result<(), …> { … }
    //
    // And any helpers needed for the stream-json → UI fan-out.
}
