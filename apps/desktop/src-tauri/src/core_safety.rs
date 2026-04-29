//! Phase 13.G — safety surfaces on `AppCore`.
//!
//! Holds:
//!
//! * The `InboxPermissionHandler` instance the desktop binary installs in
//!   `ClaudeCodeOrchestrator::with_permission_handler` (replacing the
//!   `AutoAcceptSafeTools` default per ADR 0002 §"PermissionHandler").
//! * `list_pending_approvals` / `resolve_approval_inbox` — IPC-facing
//!   bridge that joins the handler's parked map with the projected approval
//!   artifacts so the inbox view has both status (handler) and content
//!   (artifact).
//! * `cost_status` — usage / cap snapshot for the topbar cost chip
//!   (Decision 34: chip is off by default; toggle is in Settings).
//! * `keychain_status` — read-only check for Claude Code's OAuth credential
//!   in the macOS Keychain. Decision 26 prohibits writes; we never read
//!   the password contents, only its presence.
//! * `record_scope_denial` — scope-deny helper that emits both `ScopeDenied`
//!   and a `comment` artifact anchored to the offending code-change
//!   artifact (per the Phase 13.G deliverable §4).
//! * `sweep_orphan_approvals` — boot-time replay-safety pass: for every
//!   `ApprovalRequested` event with no matching grant/deny in the log, emit
//!   `ApprovalDenied { reason: "process_restart" }` so the inbox doesn't
//!   surface phantom rows whose original requesting subprocess is gone.
//!
//! All write paths go through the event store; the gate, projection, and
//! audit log are derived. A frontend compromise cannot bypass these
//! enforcement points (Decision 22).

use crate::core::AppCore;
use designer_claude::{GateStatusSink, InboxPermissionHandler, PROCESS_RESTART_REASON};
use designer_core::{
    author_roles, Actor, ApprovalId, ArtifactId, ArtifactKind, EventPayload, EventStore,
    PayloadRef, Projection, SqliteEventStore, StreamId, StreamOptions, WorkspaceId,
};
use designer_safety::{ApprovalGate, ApprovalStatus, CostUsage, InMemoryApprovalGate};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

/// Global AppCore handle to the inbox permission handler. Lives in a
/// process-global slot because `AppCore` is constructed before the
/// orchestrator selects its handler — the same handler instance must be
/// shared between the orchestrator (caller of `decide`) and the IPC layer
/// (caller of `resolve`). Keeping it on `AppCore` would require a circular
/// `Arc`; keeping it here keeps the wiring direct.
///
/// Set once at boot by `install_inbox_handler`. Never cleared in
/// production; tests that need isolation pass per-test handlers
/// explicitly to `AppCore::resolve_approval_inbox`.
static INBOX_HANDLER: once_cell::sync::OnceCell<Arc<InboxPermissionHandler<SqliteEventStore>>> =
    once_cell::sync::OnceCell::new();

/// Adapter so the inbox handler can update the in-memory
/// `InMemoryApprovalGate`'s pending map after each resolution. Without
/// this, `gate.status(id)` reports `Pending` for every inbox-routed
/// approval even after the user grants/denies — the staff-engineer review's
/// "two writers" concern. The adapter lives on the desktop side so
/// `designer-safety` doesn't need a dep on `designer-claude` (which would
/// reverse the natural layering).
pub struct GateSinkAdapter {
    gate: Arc<InMemoryApprovalGate<SqliteEventStore>>,
}

impl GateSinkAdapter {
    pub fn new(gate: Arc<InMemoryApprovalGate<SqliteEventStore>>) -> Self {
        Self { gate }
    }
}

impl GateStatusSink for GateSinkAdapter {
    fn record_status(&self, id: ApprovalId, granted: bool) {
        let status = if granted {
            ApprovalStatus::Granted
        } else {
            ApprovalStatus::Denied
        };
        self.gate.record_status(id, status);
    }
}

/// Process-global serialization lock for `sweep_orphan_approvals`. Held
/// for the duration of the sweep so two concurrent callers (boot racing a
/// manual rerun, or two test cores in the same process) don't both read
/// the same orphan set and double-write `process_restart` denials. Lives
/// here rather than on `AppCore` so the field surface stays unchanged.
fn sweep_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: once_cell::sync::OnceCell<tokio::sync::Mutex<()>> =
        once_cell::sync::OnceCell::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn install_inbox_handler(
    handler: Arc<InboxPermissionHandler<SqliteEventStore>>,
) -> Arc<InboxPermissionHandler<SqliteEventStore>> {
    if INBOX_HANDLER.set(handler.clone()).is_err() {
        // Already installed — return the existing one so the caller still
        // has a usable handle. Tests that need isolation pass a per-test
        // handler explicitly to `AppCore::resolve_approval_inbox` rather
        // than touching this global.
        return INBOX_HANDLER.get().expect("just-set").clone();
    }
    handler
}

pub fn inbox_handler() -> Option<Arc<InboxPermissionHandler<SqliteEventStore>>> {
    INBOX_HANDLER.get().cloned()
}

/// Pending row surfaced to the inbox view. Joins the handler's "parked"
/// state with the projected approval artifact for content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingApproval {
    pub approval_id: ApprovalId,
    pub workspace_id: WorkspaceId,
    pub artifact_id: ArtifactId,
    pub gate: String,
    pub summary: String,
    pub created_at: String,
}

/// Snapshot of the workspace's current cost vs. the cap. Returned by
/// `cmd_get_cost_status`; the topbar chip renders the ratio (Decision 34
/// thresholds — 50% green / 80% amber / 95% red — live on the frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostStatus {
    pub workspace_id: WorkspaceId,
    pub spent_dollars_cents: u64,
    pub cap_dollars_cents: Option<u64>,
    pub spent_tokens: u64,
    pub cap_tokens: Option<u64>,
    /// `None` when no dollar cap is configured — the chip falls back to
    /// "no cap" copy. When set, `(spent / cap).clamp(0, 1)` — the
    /// frontend converts to the chip color band.
    pub ratio: Option<f32>,
}

/// Read-only view of the Claude Code OAuth credential in the macOS Keychain.
/// Decision 26 — Designer never *writes* Claude's tokens; this surface only
/// confirms the credential is present so the user can see "connected" in
/// Settings → Account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeychainStatus {
    /// `"connected"` when a Claude OAuth credential is reachable in the
    /// Keychain, `"disconnected"` otherwise, `"unsupported_os"` on
    /// non-macOS hosts.
    pub state: String,
    /// Best-effort timestamp (RFC3339) of the last time we confirmed the
    /// credential exists. Never claims to have *validated* the token —
    /// that would require sending it to Anthropic, which Designer never
    /// does.
    pub last_verified: Option<String>,
    /// One-line copy the UI can render verbatim. Stable strings so screen
    /// readers don't get re-announced spam when the underlying state stays
    /// the same.
    pub message: String,
}

#[allow(dead_code, reason = "wired by `AppCore::install_safety` at boot")]
impl AppCore {
    /// List all approvals the inbox handler is currently parked on, joined
    /// with their artifact rows (so the inbox view can render gate +
    /// summary without a follow-up fetch).
    pub async fn list_pending_approvals(
        &self,
        workspace_id: Option<WorkspaceId>,
    ) -> Vec<PendingApproval> {
        let Some(handler) = inbox_handler() else {
            return vec![];
        };
        let pending: std::collections::HashSet<_> = handler.pending_ids().into_iter().collect();
        if pending.is_empty() {
            return vec![];
        }

        // Walk recent events to find ApprovalRequested rows whose ids the
        // handler is parked on. We pair them with the matching artifact via
        // the inline payload's approval_id field.
        let events = self
            .store
            .read_all(StreamOptions::default())
            .await
            .unwrap_or_default();

        let mut requests: std::collections::HashMap<
            ApprovalId,
            (WorkspaceId, String, String, String),
        > = std::collections::HashMap::new();
        let mut artifact_for_approval: std::collections::HashMap<ApprovalId, ArtifactId> =
            std::collections::HashMap::new();

        for env in &events {
            match &env.payload {
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id: ws,
                    gate,
                    summary,
                } if pending.contains(approval_id) => {
                    requests.insert(
                        *approval_id,
                        (
                            *ws,
                            gate.clone(),
                            summary.clone(),
                            designer_core::rfc3339(env.timestamp),
                        ),
                    );
                }
                EventPayload::ArtifactCreated {
                    artifact_id,
                    artifact_kind: ArtifactKind::Approval,
                    payload: PayloadRef::Inline { body },
                    ..
                } => {
                    if let Some(id) = approval_id_from_payload(body) {
                        if pending.contains(&id) {
                            artifact_for_approval.insert(id, *artifact_id);
                        }
                    }
                }
                _ => {}
            }
        }

        let mut out: Vec<PendingApproval> = requests
            .into_iter()
            .filter_map(|(approval_id, (ws, gate, summary, created_at))| {
                if let Some(filter_ws) = workspace_id {
                    if filter_ws != ws {
                        return None;
                    }
                }
                let artifact_id = *artifact_for_approval.get(&approval_id)?;
                Some(PendingApproval {
                    approval_id,
                    workspace_id: ws,
                    artifact_id,
                    gate,
                    summary,
                    created_at,
                })
            })
            .collect();
        // Stable order — oldest pending first reads naturally as a queue.
        out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        out
    }

    /// Resolve a parked approval. Idempotent — a second call for the same
    /// id is a no-op (the first wakeup already released the agent).
    pub async fn resolve_approval_inbox(
        &self,
        approval_id: ApprovalId,
        granted: bool,
        reason: Option<String>,
    ) -> designer_core::Result<bool> {
        match inbox_handler() {
            Some(handler) => handler.resolve(approval_id, granted, reason).await,
            None => {
                // No handler installed (e.g. unit-test harness) — fall back
                // to the legacy InMemoryApprovalGate so the audit chain
                // still records the decision.
                if granted {
                    self.gate
                        .grant(approval_id, Actor::user())
                        .await
                        .map(|_| true)
                } else {
                    self.gate
                        .deny(approval_id, reason, Actor::user())
                        .await
                        .map(|_| true)
                }
            }
        }
    }

    /// Snapshot of usage vs cap for the cost chip. Cheap; safe to poll on
    /// the frontend (the chip refreshes whenever a `CostRecorded` stream
    /// event lands).
    pub fn cost_status(&self, workspace_id: WorkspaceId) -> CostStatus {
        let usage: CostUsage = self.cost.usage(workspace_id);
        let cap = self.cost.cap_for(workspace_id);
        let ratio = match (usage.dollars_cents, cap.max_dollars_cents) {
            (_, None) => None,
            (_, Some(0)) => Some(1.0),
            (spent, Some(max)) => Some(((spent as f32) / (max as f32)).clamp(0.0, 1.0)),
        };
        CostStatus {
            workspace_id,
            spent_dollars_cents: usage.dollars_cents,
            cap_dollars_cents: cap.max_dollars_cents,
            spent_tokens: usage.tokens_input + usage.tokens_output,
            cap_tokens: cap.max_tokens,
            ratio,
        }
    }

    /// Macos Keychain check for the Claude Code OAuth credential. Surfaces
    /// presence only — Decision 26 forbids us from reading the secret
    /// itself, and we never write to the Keychain.
    pub fn keychain_status(&self) -> KeychainStatus {
        keychain::query_claude_credential()
    }

    /// Emit `ScopeDenied` AND an inline `comment` artifact anchored to the
    /// offending code-change artifact. Per Phase 13.G deliverable §4: the
    /// user sees a clear, non-blocking surface explaining what was denied
    /// and why.
    pub async fn record_scope_denial(
        &self,
        workspace_id: WorkspaceId,
        path: impl AsRef<Path>,
        reason: impl Into<String>,
        anchor_artifact_id: Option<ArtifactId>,
        tool: impl Into<String>,
    ) -> designer_core::Result<()> {
        let path = path.as_ref().to_path_buf();
        let reason = reason.into();
        let tool = tool.into();
        // 1. Domain event for the audit trail.
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::system(),
                EventPayload::ScopeDenied {
                    workspace_id,
                    path: path.clone(),
                    reason: reason.clone(),
                },
            )
            .await?;
        self.projector.apply(&env);

        // 2. Inline `comment` artifact so the user sees it in the thread,
        // anchored to the offending change when one exists.
        let comment_id = ArtifactId::new();
        let title = format!("Scope denied: {tool}");
        let summary = format!("{} — {reason}", path.display());
        let payload_body = serde_json::json!({
            "tool": tool,
            "path": path.display().to_string(),
            "reason": reason,
            "anchor_artifact_id": anchor_artifact_id,
        })
        .to_string();
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::system(),
                EventPayload::ArtifactCreated {
                    artifact_id: comment_id,
                    workspace_id,
                    artifact_kind: ArtifactKind::Comment,
                    title,
                    summary,
                    payload: PayloadRef::inline(payload_body),
                    author_role: Some(author_roles::SAFETY.into()),
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Replay-safety: at boot, scan the event log for `ApprovalRequested`
    /// events that never received a `Granted` or `Denied` and auto-deny
    /// each with reason `"process_restart"`. Without this, every cold
    /// boot would surface phantom approvals whose original requesting
    /// subprocess is gone (the staff-engineer review's replay concern).
    ///
    /// **Race safety.** Two concurrent callers of `sweep_orphan_approvals`
    /// would otherwise read the same orphan set and both write a denial
    /// for each; a sweep racing a real `resolve` call could write a
    /// `process_restart` denial *after* the user's grant landed. Both are
    /// closed by the `sweep_lock` (serializes sweeps) plus the
    /// per-iteration recheck against the live event log (serializes
    /// against any other writer). The recheck plus serialization plus
    /// inbox-handler atomic-removal in `resolve` give us a single-writer
    /// guarantee per approval id.
    pub async fn sweep_orphan_approvals(&self) -> designer_core::Result<u32> {
        let _guard = sweep_lock().lock().await;

        let mut count = 0u32;
        loop {
            let events = self.store.read_all(StreamOptions::default()).await?;
            let next_orphan = find_first_orphan(&events);
            let Some(id) = next_orphan else { break };
            // Append, then loop. Re-reading after each append is cheap
            // (the event log is local SQLite) and rebuilds the resolved
            // set so any write that snuck in between iterations is
            // honored — we never write a duplicate terminal event.
            self.store
                .append(
                    StreamId::System,
                    None,
                    Actor::system(),
                    EventPayload::ApprovalDenied {
                        approval_id: id,
                        reason: Some(PROCESS_RESTART_REASON.into()),
                    },
                )
                .await?;
            count += 1;
        }
        Ok(count)
    }
}

/// Walk an event log slice once and return the first `ApprovalRequested`
/// id that has no matching `ApprovalGranted`/`ApprovalDenied`. Returns
/// `None` when every request has a terminal event.
fn find_first_orphan(events: &[designer_core::EventEnvelope]) -> Option<ApprovalId> {
    use std::collections::HashSet;
    let mut resolved: HashSet<ApprovalId> = HashSet::new();
    for env in events {
        match &env.payload {
            EventPayload::ApprovalGranted { approval_id }
            | EventPayload::ApprovalDenied { approval_id, .. } => {
                resolved.insert(*approval_id);
            }
            _ => {}
        }
    }
    for env in events {
        if let EventPayload::ApprovalRequested { approval_id, .. } = &env.payload {
            if !resolved.contains(approval_id) {
                return Some(*approval_id);
            }
        }
    }
    None
}

fn approval_id_from_payload(body: &str) -> Option<ApprovalId> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let raw = v.get("approval_id")?.as_str()?;
    raw.parse().ok()
}

#[cfg(target_os = "macos")]
mod keychain {
    use super::KeychainStatus;
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
    use std::sync::OnceLock;

    /// Service name Claude Code uses for its OAuth credential. Verified by
    /// inspection of `~/Library/Keychains` on the dev machine
    /// (Claude Code 2.1.117). Treated as a best-guess default; can be
    /// overridden at runtime by the `DESIGNER_CLAUDE_KEYCHAIN_SERVICE`
    /// environment variable so a future Claude release that changes the
    /// service name (or a non-default install) doesn't require a code
    /// patch.
    const DEFAULT_SERVICE: &str = "Claude Code-credentials";

    fn service_name() -> String {
        std::env::var("DESIGNER_CLAUDE_KEYCHAIN_SERVICE")
            .unwrap_or_else(|_| DEFAULT_SERVICE.to_string())
    }

    pub fn query_claude_credential() -> KeychainStatus {
        // Cache the last-verified timestamp so successive Settings opens
        // don't redundantly hit the Keychain. The first call hits.
        static LAST_VERIFIED: OnceLock<parking_lot::Mutex<Option<String>>> = OnceLock::new();
        let cell = LAST_VERIFIED.get_or_init(|| parking_lot::Mutex::new(None));

        // Search by service alone — Claude Code stores its credential under
        // the macOS account name (e.g. `acct=$USER`), so the previous
        // empty-string-account lookup never matched on real installs and
        // returned a false-negative "Not connected". We never request the
        // password data (`load_data` stays default-false), so the gate that
        // would prompt the user for Keychain access is not triggered — we
        // only check for *presence* of an item with the expected service.
        let service = service_name();
        let result = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(&service)
            .limit(Limit::Max(1))
            .search();

        match result {
            Ok(items) if !items.is_empty() => {
                let now = super::format_now();
                *cell.lock() = Some(now.clone());
                KeychainStatus {
                    state: "connected".into(),
                    last_verified: Some(now),
                    message: "Connected via macOS Keychain — Designer never reads your token."
                        .into(),
                }
            }
            _ => {
                let last = cell.lock().clone();
                KeychainStatus {
                    state: "disconnected".into(),
                    last_verified: last,
                    message: "Not connected — sign in with `claude login` in Terminal.".into(),
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod keychain {
    use super::KeychainStatus;
    pub fn query_claude_credential() -> KeychainStatus {
        KeychainStatus {
            state: "unsupported_os".into(),
            last_verified: None,
            message: "Keychain integration is macOS-only.".into(),
        }
    }
}

fn format_now() -> String {
    designer_core::rfc3339(time::OffsetDateTime::now_utc())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, AppCoreBoot};
    use designer_core::ProjectId;
    use designer_safety::CostCap;
    use tempfile::tempdir;

    async fn boot_test_core() -> Arc<AppCore> {
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: Some(1_000),
                max_tokens: Some(100_000),
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        AppCore::boot(config).await.unwrap()
    }

    #[tokio::test]
    async fn cost_status_returns_zero_when_no_usage() {
        let core = boot_test_core().await;
        let _project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let p2 = core
            .create_project("P2".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(p2.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let s = core.cost_status(ws.id);
        assert_eq!(s.spent_dollars_cents, 0);
        assert_eq!(s.cap_dollars_cents, Some(1_000));
        assert_eq!(s.ratio, Some(0.0));
    }

    #[tokio::test]
    async fn cost_status_reflects_recorded_usage() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(p.id, "ws".into(), "main".into())
            .await
            .unwrap();

        // Halfway: spend 500c against a 1000c cap → ratio 0.5.
        core.cost
            .check_and_record(
                ws.id,
                CostUsage {
                    tokens_input: 100,
                    tokens_output: 200,
                    dollars_cents: 500,
                },
                Actor::user(),
            )
            .await
            .unwrap();

        let s = core.cost_status(ws.id);
        assert_eq!(s.spent_dollars_cents, 500);
        assert_eq!(s.spent_tokens, 300);
        assert!((s.ratio.unwrap() - 0.5).abs() < f32::EPSILON);
    }

    #[tokio::test]
    async fn scope_denial_emits_event_and_comment_artifact() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(p.id, "ws".into(), "main".into())
            .await
            .unwrap();

        core.record_scope_denial(ws.id, "/etc/forbidden", "outside worktree", None, "Write")
            .await
            .unwrap();

        let events = core.store.read_all(StreamOptions::default()).await.unwrap();
        let kinds: Vec<String> = events
            .iter()
            .map(|e| {
                serde_json::to_value(e.kind())
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert!(kinds.contains(&"scope_denied".to_string()));

        // Artifact landed and is a `comment`.
        let artifacts = core.list_artifacts(ws.id).await;
        let comment = artifacts
            .iter()
            .find(|a| matches!(a.kind, ArtifactKind::Comment))
            .expect("comment artifact present");
        assert!(comment.title.starts_with("Scope denied"));
        assert!(comment.summary.contains("outside worktree"));
    }

    #[tokio::test]
    async fn sweep_orphan_approvals_denies_unresolved() {
        let core = boot_test_core().await;
        let _p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(ProjectId::new(), "ws".into(), "main".into())
            .await
            .unwrap();

        // Manually inject an ApprovalRequested without any grant/deny —
        // simulates the prior process going away mid-flight.
        let approval_id = ApprovalId::new();
        core.store
            .append(
                StreamId::Workspace(ws.id),
                None,
                Actor::system(),
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id: ws.id,
                    gate: "tool:Write".into(),
                    summary: "orphan".into(),
                },
            )
            .await
            .unwrap();

        let cleaned = core.sweep_orphan_approvals().await.unwrap();
        assert_eq!(cleaned, 1);

        // The denial carries the well-known reason so audit queries can
        // distinguish process-restart cleanup from real user denials.
        let events = core.store.read_all(StreamOptions::default()).await.unwrap();
        let denied = events.iter().any(|e| {
            matches!(
                &e.payload,
                EventPayload::ApprovalDenied { reason, .. }
                    if reason.as_deref() == Some(PROCESS_RESTART_REASON)
            )
        });
        assert!(denied);

        // Idempotent: a second sweep finds nothing.
        let cleaned_again = core.sweep_orphan_approvals().await.unwrap();
        assert_eq!(cleaned_again, 0);
    }

    #[tokio::test]
    async fn keychain_status_returns_a_known_state() {
        let core = boot_test_core().await;
        let s = core.keychain_status();
        // We can't assert connected/disconnected here — depends on the
        // host. But the message must be a non-empty stable string and the
        // state must be one of the documented tokens.
        assert!(["connected", "disconnected", "unsupported_os"].contains(&s.state.as_str()));
        assert!(!s.message.is_empty());
    }

    /// Phase-13.G regression: sweep racing a parallel grant must not
    /// emit a second terminal event for the same approval id. The mutex
    /// + per-iteration recheck make this a no-op.
    #[tokio::test]
    async fn sweep_does_not_double_resolve_after_grant_lands() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(p.id, "ws".into(), "main".into())
            .await
            .unwrap();

        // Inject ApprovalRequested + a manual ApprovalGranted (the race
        // we're simulating: a real user grant that landed before sweep
        // had a chance to write its process-restart denial).
        let approval_id = ApprovalId::new();
        core.store
            .append(
                StreamId::Workspace(ws.id),
                None,
                Actor::system(),
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id: ws.id,
                    gate: "tool:Write".into(),
                    summary: "raced".into(),
                },
            )
            .await
            .unwrap();
        core.store
            .append(
                StreamId::Workspace(ws.id),
                None,
                Actor::user(),
                EventPayload::ApprovalGranted { approval_id },
            )
            .await
            .unwrap();

        let cleaned = core.sweep_orphan_approvals().await.unwrap();
        assert_eq!(
            cleaned, 0,
            "sweep must skip approvals that already have a terminal event"
        );

        let events = core.store.read_all(StreamOptions::default()).await.unwrap();
        let granted_count = events
            .iter()
            .filter(|e| matches!(&e.payload, EventPayload::ApprovalGranted { approval_id: id } if *id == approval_id))
            .count();
        let denied_count = events
            .iter()
            .filter(|e| matches!(&e.payload, EventPayload::ApprovalDenied { approval_id: id, .. } if *id == approval_id))
            .count();
        assert_eq!(
            granted_count, 1,
            "the user's grant stays the only terminal event"
        );
        assert_eq!(denied_count, 0, "no process_restart denial sneaks in");
    }

    /// Phase-13.G regression: AppCore::cost_status should reflect
    /// historical CostRecorded events after a process restart. The boot
    /// path calls `cost.replay_from_store` so this works end-to-end at
    /// the IPC surface, not just on the bare tracker.
    #[tokio::test]
    async fn cost_status_reflects_historical_spend_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let dir_path = dir.path().to_path_buf();
        let p_id;
        let ws_id;

        // Boot 1: spend half the cap, then drop the AppCore.
        {
            let config = AppConfig {
                data_dir: dir_path.clone(),
                use_mock_orchestrator: true,
                claude_options: Default::default(),
                default_cost_cap: CostCap {
                    max_dollars_cents: Some(1_000),
                    max_tokens: None,
                },
                helper_binary_path: None,
            };
            let core = AppCore::boot(config).await.unwrap();
            let p = core
                .create_project("P".into(), "/tmp".into())
                .await
                .unwrap();
            let ws = core
                .create_workspace(p.id, "ws".into(), "main".into())
                .await
                .unwrap();
            p_id = p.id;
            ws_id = ws.id;
            core.cost
                .check_and_record(
                    ws.id,
                    CostUsage {
                        dollars_cents: 500,
                        ..Default::default()
                    },
                    Actor::user(),
                )
                .await
                .unwrap();
        }

        // Boot 2: same data dir, fresh AppCore. Cost status must surface
        // the prior spend.
        let config = AppConfig {
            data_dir: dir_path.clone(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: Some(1_000),
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        let core = AppCore::boot(config).await.unwrap();
        let _ = (p_id, ws_id); // silence unused-binding when ProjectId unused below
        let s = core.cost_status(ws_id);
        assert_eq!(
            s.spent_dollars_cents, 500,
            "cost_status must reflect spend recorded in a prior session"
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn keychain_status_disconnected_without_credential() {
        // Force a cache miss by pointing at a service name that won't
        // exist on any test host. Confirms the missing-credential path
        // returns `disconnected` instead of panicking.
        std::env::set_var(
            "DESIGNER_CLAUDE_KEYCHAIN_SERVICE",
            "designer-test-nonexistent-service-zzz",
        );
        let core = boot_test_core().await;
        let s = core.keychain_status();
        assert_eq!(s.state, "disconnected");
        assert!(s.message.contains("Not connected"));
        std::env::remove_var("DESIGNER_CLAUDE_KEYCHAIN_SERVICE");
    }
}
