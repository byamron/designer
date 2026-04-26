//! Permission-prompt handler seam.
//!
//! Claude Code emits permission prompts over stdio when a tool use would
//! touch something requiring user confirmation (writes, destructive bash,
//! etc.) — see `--permission-prompt-tool stdio` in
//! `core-docs/integration-notes.md` §12.A. `ClaudeCodeOrchestrator` consults
//! the installed [`PermissionHandler`] on every prompt. The default
//! [`AutoAcceptSafeTools`] auto-accepts read-only tools so Phase 13.D can
//! ship before Phase 13.G's approval inbox lands; 13.G replaces the default
//! via [`ClaudeCodeOrchestrator::with_permission_handler`].
//!
//! The seam is introduced by Phase 13.0 (pre-track scaffolding) so 13.D and
//! 13.G don't collide on the same permission-handling code path.
//!
//! See ADR 0002 §D3 for the scoping rationale (allowlist shape, write
//! denial until the inbox lands).

use async_trait::async_trait;
use designer_core::WorkspaceId;
use serde::{Deserialize, Serialize};

/// A single permission request from Claude. Claude's stdio protocol sends
/// the tool name plus a compact description; we also carry the raw input so
/// more sophisticated handlers (e.g., an inbox that shows the diff) can
/// inspect it. The exact stdio wire format is owned by 13.D (the track that
/// reads from the subprocess); this struct is the orchestrator-level
/// normalized view both 13.D and 13.G consume.
///
/// **Field stability.** The trait shape is frozen by ADR 0002 §"PermissionHandler"
/// — `decide(req) -> PermissionDecision`. Adding additive fields to the
/// request struct is allowed (old call sites that don't set them get the
/// `Default` value); changing or removing fields is not.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    /// Tool name as Claude reports it, e.g. `"Read"`, `"Bash"`, `"Write"`.
    pub tool: String,
    /// Serialized tool input (usually a JSON object). Opaque at this layer;
    /// specific handlers may parse (e.g. extract a Bash command string).
    pub input: serde_json::Value,
    /// Short human-readable summary the handler can show in UI or log.
    pub summary: String,
    /// Workspace the prompt belongs to, when the orchestrator can attribute
    /// it. `None` when the call site is older than Phase 13.G's wiring (e.g.
    /// the existing `AutoAcceptSafeTools` tests). The `InboxPermissionHandler`
    /// requires a workspace to anchor the approval artifact; it denies the
    /// request immediately when the field is `None`, so 13.D's stdio reader
    /// must populate it before swapping the handler in.
    #[serde(default)]
    pub workspace_id: Option<WorkspaceId>,
}

/// Outcome the handler returns. `Accept` / `Deny` are sent straight back to
/// Claude via its stdio protocol.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum PermissionDecision {
    Accept,
    Deny { reason: String },
}

/// Contract for anything that can decide whether a tool use is allowed.
///
/// - Phase 13.D uses [`AutoAcceptSafeTools`] as the default — unblocks
///   real Claude sessions that need to read files while the approval inbox
///   is being built.
/// - Phase 13.G swaps in `InboxPermissionHandler` (not in this crate; lives
///   under `designer-safety` or the desktop crate) via
///   [`ClaudeCodeOrchestrator::with_permission_handler`]. That handler
///   surfaces a request to the user via the approval inbox and blocks until
///   a decision arrives.
#[async_trait]
pub trait PermissionHandler: Send + Sync {
    async fn decide(&self, req: PermissionRequest) -> PermissionDecision;
}

/// Default handler for Phase 13.D — auto-accepts read-only tool calls so
/// Claude sessions can actually do useful work (they read a lot of files).
/// Denies everything else by default; Phase 13.G replaces this with an
/// inbox-routing handler.
///
/// **Safe-tool allowlist (v1, per ADR 0002 §D3):**
/// - `Read`, `Grep`, `Glob` — read-only file access.
/// - `Bash` with a command whose first token is one of `ls`, `cat`,
///   `git status`, `git diff`, `git log`, `pwd`, `echo`, `which`.
///   Multi-command bash (`&&`, `;`, `|`) is denied — too easy to hide a
///   write.
///
/// Everything else returns [`PermissionDecision::Deny`] with a message
/// pointing the user at "approve via inbox (Phase 13.G)".
#[derive(Debug, Clone, Default)]
pub struct AutoAcceptSafeTools;

/// Single-token safe Bash prefixes. Matched against the first whitespace
/// token of the command after trimming.
const SAFE_BASH_SINGLE_TOKEN: &[&str] = &["ls", "cat", "pwd", "echo", "which"];

/// Two-token safe Bash prefixes (`git status`, etc.). Matched against the
/// first two whitespace tokens.
const SAFE_BASH_TWO_TOKENS: &[(&str, &str)] = &[("git", "status"), ("git", "diff"), ("git", "log")];

fn bash_command_is_safe(cmd: &str) -> bool {
    let trimmed = cmd.trim();
    // Reject obvious multi-command bash — we don't try to parse it.
    if trimmed.contains("&&") || trimmed.contains("||") || trimmed.contains(';') {
        return false;
    }
    // Reject pipes too — even `ls | something` could feed into a mutation.
    if trimmed.contains('|') {
        return false;
    }
    let mut parts = trimmed.split_whitespace();
    let Some(first) = parts.next() else {
        return false;
    };
    if SAFE_BASH_SINGLE_TOKEN.contains(&first) {
        return true;
    }
    if let Some(second) = parts.next() {
        if SAFE_BASH_TWO_TOKENS.contains(&(first, second)) {
            return true;
        }
    }
    false
}

#[async_trait]
impl PermissionHandler for AutoAcceptSafeTools {
    async fn decide(&self, req: PermissionRequest) -> PermissionDecision {
        match req.tool.as_str() {
            "Read" | "Grep" | "Glob" => PermissionDecision::Accept,
            "Bash" => {
                let cmd = req
                    .input
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if bash_command_is_safe(cmd) {
                    PermissionDecision::Accept
                } else {
                    PermissionDecision::Deny {
                        reason: format!(
                            "Bash command not on the v1 safe-prefix allowlist (needs 13.G approval inbox): {cmd}"
                        ),
                    }
                }
            }
            other => PermissionDecision::Deny {
                reason: format!(
                    "{other} requires user approval (not yet routed; Phase 13.G installs the inbox handler)"
                ),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req(tool: &str, input: serde_json::Value) -> PermissionRequest {
        PermissionRequest {
            tool: tool.to_string(),
            input,
            summary: format!("test {tool}"),
            workspace_id: None,
        }
    }

    #[tokio::test]
    async fn read_tools_are_accepted() {
        let h = AutoAcceptSafeTools;
        for tool in ["Read", "Grep", "Glob"] {
            assert_eq!(
                h.decide(req(tool, json!({}))).await,
                PermissionDecision::Accept,
                "{tool} should be accepted"
            );
        }
    }

    #[tokio::test]
    async fn write_tools_are_denied() {
        let h = AutoAcceptSafeTools;
        for tool in ["Write", "Edit", "MultiEdit", "NotebookEdit"] {
            assert!(
                matches!(
                    h.decide(req(tool, json!({}))).await,
                    PermissionDecision::Deny { .. }
                ),
                "{tool} should be denied"
            );
        }
    }

    #[tokio::test]
    async fn safe_bash_commands_are_accepted() {
        let h = AutoAcceptSafeTools;
        for cmd in [
            "ls",
            "ls -la",
            "cat README.md",
            "pwd",
            "echo hello",
            "git status",
            "git diff HEAD~1",
            "git log --oneline",
            "which claude",
        ] {
            assert_eq!(
                h.decide(req("Bash", json!({ "command": cmd }))).await,
                PermissionDecision::Accept,
                "'{cmd}' should be accepted"
            );
        }
    }

    #[tokio::test]
    async fn unsafe_bash_commands_are_denied() {
        let h = AutoAcceptSafeTools;
        for cmd in [
            "rm -rf /",
            "git push",
            "git commit -m x",
            "cat foo && rm bar",
            "ls ; rm -rf .",
            "ls || echo hi",
            "cat README | sh",
            "mv a b",
        ] {
            assert!(
                matches!(
                    h.decide(req("Bash", json!({ "command": cmd }))).await,
                    PermissionDecision::Deny { .. }
                ),
                "'{cmd}' should be denied"
            );
        }
    }

    #[tokio::test]
    async fn bash_with_missing_command_denies() {
        let h = AutoAcceptSafeTools;
        // Malformed tool input shouldn't crash; it should deny.
        assert!(matches!(
            h.decide(req("Bash", json!({}))).await,
            PermissionDecision::Deny { .. }
        ));
    }
}
