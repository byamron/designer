//! AppCore methods reserved for Phase 13.G — safety surfaces + Keychain.
//!
//! This file starts as an empty `impl AppCore { … }` block. Track 13.G fills
//! in methods for the approval inbox (`list_approvals`, `resolve_approval`),
//! the cost / usage chip (reads `CostTracker` + rate-limit signals), and
//! Keychain-backed secret storage. Other tracks never edit this file.
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Mark cross-track hooks with `// TODO(13.X):` so grep finds them.
//! - IPC handlers live in `commands_safety.rs`.
//! - Do **not** touch `core.rs` itself.
//! - 13.G replaces `designer_claude::AutoAcceptSafeTools` with an
//!   `InboxPermissionHandler` via
//!   `ClaudeCodeOrchestrator::with_permission_handler()`. The trait seam is
//!   pre-introduced by Phase 13.0.
//! - Cost chip thresholds per ADR 0002 §D4: 50% green / 80% amber / 95%
//!   red + ambient notice >95%. Source of truth is the `rate_limit_event`
//!   in the stream-json feed (surfaced via `ClaudeSignal::RateLimit`).

use crate::core::AppCore;

#[allow(dead_code, reason = "reserved for Phase 13.G — safety + keychain")]
impl AppCore {
    // Phase 13.G will land:
    //   pub async fn list_approvals(&self, workspace_id: WorkspaceId) -> Result<Vec<Approval>, …>
    //   pub async fn resolve_approval_inbox(&self, id: ApprovalId, decision: …) -> Result<…>
    //   pub async fn usage_status(&self) -> Result<UsageStatus, …>
    //   pub fn subscribe_claude_signals(&self) -> broadcast::Receiver<ClaudeSignal>
    //   pub async fn put_secret(&self, key: &str, value: &str) -> Result<…>  // Keychain
    //   pub async fn get_secret(&self, key: &str) -> Result<Option<String>, …>
    //
    // `security-framework` crate is the Keychain binding. Service name
    // prefix: `com.designer.secret.*`.
}
