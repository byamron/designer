//! AppCore methods for Phase 13.F — local-model surfaces.
//!
//! Three jobs:
//!
//! 1. **Write-time summary hook.** A seam tracks call when emitting
//!    `ArtifactCreated { kind: "code-change" }`. The hook calls
//!    `LocalOps::summarize_row` with a 500ms deadline; on success the helper's
//!    one-line output replaces the supplied `summary` before the event hits the
//!    store. On timeout/error/fallback we append immediately with a deterministic
//!    140-char truncation, then (only when the helper later returns) emit
//!    `ArtifactUpdated` with the real summary. Per-track debounce coalesces
//!    bursts of edits within a 2-second window onto a single helper call —
//!    Option B (each artifact gets the same batch summary; we never suppress
//!    artifacts, only the helper round-trip). Documented in ADR 0003.
//!
//! 2. **Recap.** `AppCore::recap_workspace` collects recent artifact summaries,
//!    calls `LocalOps::recap`, and emits `ArtifactCreated { kind: "report" }`
//!    keyed to the workspace.
//!
//! 3. **Audit verdicts.** `AppCore::audit_artifact` calls `LocalOps::audit_claim`
//!    against a target artifact's summary and emits a `comment` artifact in the
//!    target's workspace with `author_role: Some("auditor")`.
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Mark cross-track hooks with `// TODO(13.X):` so grep finds them.
//! - IPC handlers live in `commands_local.rs`.
//! - Do **not** touch `core.rs` itself.

use crate::core::{AppCore, HelperStatusKind};
use designer_core::{
    Actor, ArtifactId, ArtifactKind, CoreError, EventEnvelope, EventPayload, EventStore,
    PayloadRef, Projection, StreamId, WorkspaceId,
};
use designer_local_models::{AuditClaim, AuditVerdict, RecapInput, RowSummarizeInput};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// 500 ms — the hard append deadline for the write-time summary hook. Anything
/// slower lands an artifact with the deterministic fallback summary; the real
/// summary arrives later as an `ArtifactUpdated`.
pub const SUMMARY_HOOK_DEADLINE: Duration = Duration::from_millis(500);

/// 2s window inside which a second `code-change` artifact from the same
/// `(workspace, author_role)` reuses the previous summary instead of burning
/// another helper call.
pub const SUMMARY_DEBOUNCE_WINDOW: Duration = Duration::from_secs(2);

/// Hard cap for the deterministic fallback summary. 140 chars matches the
/// rail-collapsed view's visible budget without truncating mid-grapheme on
/// most plain ASCII; we additionally trim on `char_indices` so multi-byte
/// content doesn't split a code point.
pub const FALLBACK_SUMMARY_LIMIT: usize = 140;

/// `(workspace_id, author_role)` — the per-track key for debounce.
/// `author_role` stands in for a future `track_id` until 13.E lands tracks on
/// the artifact event itself.
type TrackKey = (WorkspaceId, Option<String>);

/// Per-track debounce cache. Key is `(workspace_id, author_role)`; value is the
/// most recent successful summary plus its produced-at instant. If a request
/// arrives within `SUMMARY_DEBOUNCE_WINDOW` of the cached value, we reuse the
/// cached summary verbatim instead of calling the helper again.
#[derive(Debug, Default)]
pub struct SummaryDebounce {
    inner: Mutex<HashMap<TrackKey, (Instant, String)>>,
}

impl SummaryDebounce {
    pub fn new() -> Self {
        Self::default()
    }

    fn cached(&self, key: &TrackKey) -> Option<String> {
        let map = self.inner.lock();
        map.get(key)
            .filter(|(t, _)| t.elapsed() < SUMMARY_DEBOUNCE_WINDOW)
            .map(|(_, s)| s.clone())
    }

    fn store(&self, key: TrackKey, summary: String) {
        let mut map = self.inner.lock();
        map.insert(key, (Instant::now(), summary));
    }
}

/// Truncate to a char-boundary-safe prefix for fallback summaries. Adds an
/// ellipsis only when truncation actually happened so callers can tell the
/// difference visually.
pub fn fallback_truncate(input: &str, max: usize) -> String {
    if input.chars().count() <= max {
        return input.to_string();
    }
    let cut: String = input.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}…")
}

/// One artifact's worth of `ArtifactCreated` content, packed so the seam can
/// take a single struct instead of seven positional args.
#[derive(Debug, Clone)]
pub struct ArtifactDraft {
    pub workspace_id: WorkspaceId,
    pub artifact_id: ArtifactId,
    pub kind: ArtifactKind,
    pub title: String,
    pub summary: String,
    pub payload: PayloadRef,
    pub author_role: Option<String>,
}

#[allow(dead_code, reason = "13.F surface — not all entry points wired yet")]
impl AppCore {
    /// Append an artifact, running the write-time summary hook for
    /// `code-change` kinds. All other kinds bypass the hook and are appended
    /// verbatim. Tracks 13.E (and any future emitter of `code-change`) **must**
    /// route through this method instead of calling `store.append` directly so
    /// the on-device summary is materialized before the rail/collapsed-block
    /// view reads it.
    pub async fn append_artifact_with_summary_hook(
        self: &Arc<Self>,
        draft: ArtifactDraft,
    ) -> designer_core::Result<EventEnvelope> {
        match draft.kind {
            ArtifactKind::CodeChange => self.append_code_change_with_hook(draft).await,
            _ => self.append_artifact_inner(draft).await,
        }
    }

    async fn append_code_change_with_hook(
        self: &Arc<Self>,
        draft: ArtifactDraft,
    ) -> designer_core::Result<EventEnvelope> {
        let key: TrackKey = (draft.workspace_id, draft.author_role.clone());

        // 1. Cache hit inside the debounce window — short-circuit, no helper call.
        if let Some(cached) = self.summary_debounce.cached(&key) {
            debug!(target: "local_models", "summary debounce reused cached row");
            let mut next = draft;
            next.summary = cached;
            return self.append_artifact_inner(next).await;
        }

        // 2. Helper unavailable — never even try; deterministic fallback only.
        if matches!(self.helper_status.kind, HelperStatusKind::Fallback) {
            let mut next = draft;
            next.summary = fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT);
            return self.append_artifact_inner(next).await;
        }

        // 3. Live helper — race a 500ms deadline. Spawn the helper call so we
        // can keep awaiting it past the deadline if the append already landed
        // with a fallback summary.
        let local_ops = self.local_ops.clone();
        let row_input = RowSummarizeInput {
            row_kind: "code-change".into(),
            state: "open".into(),
            latest_activity: Some(draft.summary.clone()),
        };
        let mut handle = tokio::spawn(async move { local_ops.summarize_row(row_input).await });

        match tokio::time::timeout(SUMMARY_HOOK_DEADLINE, &mut handle).await {
            Ok(Ok(Ok(out))) => {
                self.summary_debounce.store(key, out.line.clone());
                let mut next = draft;
                next.summary = out.line;
                self.append_artifact_inner(next).await
            }
            Ok(Ok(Err(e))) => {
                warn!(target: "local_models", error = %e, "summarize_row helper error; using fallback");
                let mut next = draft;
                next.summary = fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT);
                self.append_artifact_inner(next).await
            }
            Ok(Err(join_err)) => {
                warn!(target: "local_models", error = %join_err, "summarize_row task panicked; using fallback");
                let mut next = draft;
                next.summary = fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT);
                self.append_artifact_inner(next).await
            }
            Err(_) => {
                // 500ms deadline — append fallback summary immediately, then
                // wait for the helper in the background and emit
                // ArtifactUpdated with the real summary if it eventually
                // returns successfully.
                let artifact_id = draft.artifact_id;
                let payload = draft.payload.clone();
                let mut fallback_draft = draft;
                fallback_draft.summary =
                    fallback_truncate(&fallback_draft.summary, FALLBACK_SUMMARY_LIMIT);
                let env = self.append_artifact_inner(fallback_draft).await?;

                let me = self.clone();
                let key_for_update = key;
                tokio::spawn(async move {
                    match handle.await {
                        Ok(Ok(out)) => {
                            me.summary_debounce.store(key_for_update, out.line.clone());
                            if let Err(e) = me
                                .emit_artifact_updated(artifact_id, out.line, payload)
                                .await
                            {
                                warn!(target: "local_models", error = %e, "late-summary ArtifactUpdated append failed");
                            }
                        }
                        Ok(Err(e)) => {
                            debug!(target: "local_models", error = %e, "late summary helper error; keeping fallback");
                        }
                        Err(e) => {
                            warn!(target: "local_models", error = %e, "late summary task join error");
                        }
                    }
                });
                Ok(env)
            }
        }
    }

    /// Direct append + project. Helper for kinds that bypass the summary hook.
    async fn append_artifact_inner(
        &self,
        draft: ArtifactDraft,
    ) -> designer_core::Result<EventEnvelope> {
        let env = self
            .store
            .append(
                StreamId::Workspace(draft.workspace_id),
                None,
                Actor::system(),
                EventPayload::ArtifactCreated {
                    artifact_id: draft.artifact_id,
                    workspace_id: draft.workspace_id,
                    artifact_kind: draft.kind,
                    title: draft.title,
                    summary: draft.summary,
                    payload: draft.payload,
                    author_role: draft.author_role,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(env)
    }

    async fn emit_artifact_updated(
        &self,
        artifact_id: ArtifactId,
        summary: String,
        payload: PayloadRef,
    ) -> designer_core::Result<EventEnvelope> {
        let current = self
            .projector
            .artifact(artifact_id)
            .ok_or_else(|| CoreError::NotFound(artifact_id.to_string()))?;
        let env = self
            .store
            .append(
                StreamId::Workspace(current.workspace_id),
                None,
                Actor::system(),
                EventPayload::ArtifactUpdated {
                    artifact_id,
                    summary,
                    payload,
                    parent_version: current.version,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(env)
    }

    /// Generate a workspace recap via `LocalOps::recap` and emit a `report`
    /// artifact. Out-of-scope for 13.F: Home-tab framing — emitter only.
    pub async fn recap_workspace(
        self: &Arc<Self>,
        workspace_id: WorkspaceId,
    ) -> designer_core::Result<EventEnvelope> {
        let _ = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
        let artifacts = self.list_artifacts(workspace_id).await;
        let entries: Vec<String> = artifacts
            .iter()
            .filter(|a| !matches!(a.kind, ArtifactKind::Report))
            .map(|a| {
                let kind: &'static str = artifact_kind_label(a.kind);
                format!("[{kind}] {} — {}", a.title, a.summary)
            })
            .collect();

        let recap = if matches!(self.helper_status.kind, HelperStatusKind::Fallback) {
            None
        } else {
            match self
                .local_ops
                .recap(RecapInput {
                    since: today_label(),
                    entries: entries.clone(),
                })
                .await
            {
                Ok(out) => Some(out),
                Err(e) => {
                    warn!(target: "local_models", error = %e, "recap helper error; emitting placeholder");
                    None
                }
            }
        };

        let (headline, bullets) = match recap {
            Some(out) => (out.headline, out.bullets),
            None => (
                "Recap unavailable on-device".to_string(),
                Vec::<String>::new(),
            ),
        };
        let body = format_recap_markdown(&headline, &bullets, &entries);
        let title = format!("{} recap", weekday_label());
        let summary = fallback_truncate(&headline, FALLBACK_SUMMARY_LIMIT);
        self.append_artifact_inner(ArtifactDraft {
            workspace_id,
            artifact_id: ArtifactId::new(),
            kind: ArtifactKind::Report,
            title,
            summary,
            payload: PayloadRef::inline(body),
            author_role: Some("recap".into()),
        })
        .await
    }

    /// Audit a claim against an existing artifact's summary. Emits a `comment`
    /// artifact in the target's workspace with `author_role: Some("auditor")`.
    pub async fn audit_artifact(
        self: &Arc<Self>,
        artifact_id: ArtifactId,
        claim: String,
    ) -> designer_core::Result<EventEnvelope> {
        let target = self
            .projector
            .artifact(artifact_id)
            .ok_or_else(|| CoreError::NotFound(artifact_id.to_string()))?;
        let evidence = vec![target.summary.clone()];

        let verdict = if matches!(self.helper_status.kind, HelperStatusKind::Fallback) {
            AuditVerdict::Inconclusive
        } else {
            match self
                .local_ops
                .audit_claim(AuditClaim {
                    claim: claim.clone(),
                    evidence: evidence.clone(),
                })
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    warn!(target: "local_models", error = %e, "audit_claim helper error");
                    AuditVerdict::Inconclusive
                }
            }
        };

        let verdict_label = audit_verdict_label(verdict);
        let title = format!("Audit: {claim}");
        let summary = verdict_label.to_string();
        let rationale = format_audit_rationale(verdict, &claim, &target.title, &target.id);
        self.append_artifact_inner(ArtifactDraft {
            workspace_id: target.workspace_id,
            artifact_id: ArtifactId::new(),
            kind: ArtifactKind::Comment,
            title,
            summary,
            payload: PayloadRef::inline(rationale),
            author_role: Some("auditor".into()),
        })
        .await
    }
}

fn audit_verdict_label(v: AuditVerdict) -> &'static str {
    match v {
        AuditVerdict::Supported => "supported",
        AuditVerdict::Contradicted => "contradicted",
        AuditVerdict::Inconclusive => "inconclusive",
    }
}

fn artifact_kind_label(k: ArtifactKind) -> &'static str {
    match k {
        ArtifactKind::Message => "message",
        ArtifactKind::Spec => "spec",
        ArtifactKind::CodeChange => "code-change",
        ArtifactKind::Pr => "pr",
        ArtifactKind::Approval => "approval",
        ArtifactKind::Report => "report",
        ArtifactKind::Prototype => "prototype",
        ArtifactKind::Comment => "comment",
        ArtifactKind::TaskList => "task-list",
        ArtifactKind::Diagram => "diagram",
        ArtifactKind::Variant => "variant",
        ArtifactKind::TrackRollup => "track-rollup",
    }
}

fn weekday_label() -> String {
    let now = time::OffsetDateTime::now_utc();
    match now.weekday() {
        time::Weekday::Monday => "Monday",
        time::Weekday::Tuesday => "Tuesday",
        time::Weekday::Wednesday => "Wednesday",
        time::Weekday::Thursday => "Thursday",
        time::Weekday::Friday => "Friday",
        time::Weekday::Saturday => "Saturday",
        time::Weekday::Sunday => "Sunday",
    }
    .to_string()
}

fn today_label() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{}-{:02}-{:02}",
        now.year(),
        u8::from(now.month()),
        now.day()
    )
}

fn format_recap_markdown(headline: &str, bullets: &[String], entries: &[String]) -> String {
    let mut out = String::new();
    out.push_str("# ");
    out.push_str(headline);
    out.push('\n');
    if !bullets.is_empty() {
        out.push('\n');
        for b in bullets {
            out.push_str("- ");
            out.push_str(b);
            out.push('\n');
        }
    }
    if !entries.is_empty() {
        out.push_str("\n## Inputs\n");
        for e in entries {
            out.push_str("- ");
            out.push_str(e);
            out.push('\n');
        }
    }
    out
}

fn format_audit_rationale(
    verdict: AuditVerdict,
    claim: &str,
    target_title: &str,
    target_id: &ArtifactId,
) -> String {
    format!(
        "**Verdict:** {}\n**Claim:** {}\n**Anchored to:** {} (`{}`)\n",
        audit_verdict_label(verdict),
        claim,
        target_title,
        target_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, HelperStatus, HelperStatusKind};
    use async_trait::async_trait;
    use designer_audit::SqliteAuditLog;
    use designer_claude::MockOrchestrator;
    use designer_core::{
        EventStore, ProjectId, Projector, SqliteEventStore, StreamOptions, WorkspaceId,
    };
    use designer_local_models::{
        FoundationHelper, FoundationLocalOps, HelperError, HelperResult, JobKind, LocalOps,
    };
    use designer_safety::{CostCap, CostTracker, InMemoryApprovalGate};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;

    /// Test helper: returns canned text after an optional delay so we can
    /// exercise both the in-deadline path and the late-return path.
    struct TestHelper {
        text: String,
        delay: Duration,
        calls: AtomicUsize,
    }

    impl TestHelper {
        fn new(text: impl Into<String>, delay: Duration) -> Self {
            Self {
                text: text.into(),
                delay,
                calls: AtomicUsize::new(0),
            }
        }

        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl FoundationHelper for TestHelper {
        async fn ping(&self) -> HelperResult<String> {
            Ok("test".into())
        }
        async fn generate(&self, _job: JobKind, _prompt: &str) -> HelperResult<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(self.delay).await;
            Ok(self.text.clone())
        }
    }

    /// Test helper that always errors. Used to confirm fallback path.
    struct ErrHelper;

    #[async_trait]
    impl FoundationHelper for ErrHelper {
        async fn ping(&self) -> HelperResult<String> {
            Ok("err-helper".into())
        }
        async fn generate(&self, _job: JobKind, _prompt: &str) -> HelperResult<String> {
            Err(HelperError::Reported("test-failure".into()))
        }
    }

    /// Build an `AppCore` with a custom helper and a `Live` helper status so the
    /// summary hook actually invokes the helper. (Fallback status would short-
    /// circuit to the deterministic truncation path before we ever reach
    /// `LocalOps::summarize_row`.)
    async fn boot_with_helper(helper: Arc<dyn FoundationHelper>) -> Arc<AppCore> {
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);

        let store = Arc::new(SqliteEventStore::open(config.data_dir.join("events.db")).unwrap());
        let projector = Projector::new();
        let history = store.read_all(StreamOptions::default()).await.unwrap();
        projector.replay(&history);

        let orchestrator = Arc::new(MockOrchestrator::new(store.clone()));
        let audit = Arc::new(SqliteAuditLog::new(store.clone()));
        let gate = Arc::new(InMemoryApprovalGate::new(store.clone()));
        let cost = CostTracker::new(store.clone(), config.default_cost_cap);

        let local_ops: Arc<dyn LocalOps> = Arc::new(FoundationLocalOps::new(helper.clone()));
        let helper_status = HelperStatus {
            kind: HelperStatusKind::Live,
            fallback_reason: None,
            binary_path: None,
            version: Some("test".into()),
            model: Some("test-model".into()),
        };

        Arc::new(AppCore {
            config,
            store,
            projector,
            orchestrator,
            audit,
            gate,
            cost,
            helper,
            local_ops,
            helper_status,
            helper_events: None,
            summary_debounce: Arc::new(SummaryDebounce::new()),
        })
    }

    async fn seed_workspace(core: &Arc<AppCore>) -> WorkspaceId {
        let project = core
            .create_project("P".into(), std::path::PathBuf::from("/tmp/p"))
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let _ = ws.project_id; // touch field; quiet potential warnings
        ws.id
    }

    #[tokio::test]
    async fn write_time_hook_intercepts_code_change_summary() {
        let helper = Arc::new(TestHelper::new(
            "agent renamed two helpers and rewrote auth-middleware tests",
            Duration::from_millis(20),
        ));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let id = ArtifactId::new();
        let env = core
            .append_artifact_with_summary_hook(ArtifactDraft {
                workspace_id,
                artifact_id: id,
                kind: ArtifactKind::CodeChange,
                title: "auth-middleware refactor".into(),
                summary: "raw description from track".into(),
                payload: PayloadRef::inline("a.rs\nb.rs\n"),
                author_role: Some("track-13e".into()),
            })
            .await
            .unwrap();

        match env.payload {
            EventPayload::ArtifactCreated { summary, .. } => {
                assert!(
                    summary.starts_with("agent renamed two helpers"),
                    "expected helper output, got {summary:?}"
                );
            }
            other => panic!("expected ArtifactCreated, got {other:?}"),
        }
        assert_eq!(helper.call_count(), 1, "helper hit exactly once");
    }

    #[tokio::test]
    async fn write_time_hook_falls_back_on_timeout_then_emits_update() {
        // Helper is slower than the 500ms hook deadline, so the append uses a
        // truncated fallback summary and the late return arrives as
        // ArtifactUpdated.
        let helper = Arc::new(TestHelper::new(
            "late summary from on-device model",
            Duration::from_millis(800),
        ));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let mut sub = core.store.subscribe();

        let id = ArtifactId::new();
        let raw = "x".repeat(300); // long enough to exercise truncation path
        let env = core
            .append_artifact_with_summary_hook(ArtifactDraft {
                workspace_id,
                artifact_id: id,
                kind: ArtifactKind::CodeChange,
                title: "verbose change".into(),
                summary: raw.clone(),
                payload: PayloadRef::inline("file.rs\n"),
                author_role: Some("track-13e".into()),
            })
            .await
            .unwrap();

        // First event: ArtifactCreated with truncated fallback summary.
        match env.payload {
            EventPayload::ArtifactCreated { ref summary, .. } => {
                assert!(
                    summary.chars().count() <= FALLBACK_SUMMARY_LIMIT,
                    "fallback summary must respect the 140-char limit, got {} chars",
                    summary.chars().count()
                );
                assert!(summary.ends_with('…'), "truncation must be ellipsis-marked");
            }
            ref other => panic!("expected ArtifactCreated, got {other:?}"),
        }

        // Drain the broadcaster, looking for the ArtifactUpdated that arrives
        // after the helper's late return. Bounded wait — anything past 2s is
        // a regression in the late-return spawn.
        let updated = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let ev = sub.recv().await.unwrap();
                if let EventPayload::ArtifactUpdated {
                    artifact_id,
                    summary,
                    ..
                } = ev.payload
                {
                    if artifact_id == id {
                        return summary;
                    }
                }
            }
        })
        .await
        .expect("ArtifactUpdated must arrive after late helper return");
        assert_eq!(updated, "late summary from on-device model");
    }

    #[tokio::test]
    async fn write_time_hook_uses_fallback_on_helper_error() {
        let helper = Arc::new(ErrHelper);
        let core = boot_with_helper(helper).await;
        let workspace_id = seed_workspace(&core).await;

        let id = ArtifactId::new();
        let env = core
            .append_artifact_with_summary_hook(ArtifactDraft {
                workspace_id,
                artifact_id: id,
                kind: ArtifactKind::CodeChange,
                title: "title".into(),
                summary: "the original description".into(),
                payload: PayloadRef::inline("a.rs\n"),
                author_role: Some("track-13e".into()),
            })
            .await
            .unwrap();
        match env.payload {
            EventPayload::ArtifactCreated { summary, .. } => {
                assert_eq!(summary, "the original description");
            }
            other => panic!("expected ArtifactCreated, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn write_time_hook_debounce_reuses_recent_summary() {
        let helper = Arc::new(TestHelper::new("first call", Duration::from_millis(20)));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let id1 = ArtifactId::new();
        let env1 = core
            .append_artifact_with_summary_hook(ArtifactDraft {
                workspace_id,
                artifact_id: id1,
                kind: ArtifactKind::CodeChange,
                title: "edit 1".into(),
                summary: "first description".into(),
                payload: PayloadRef::inline("a\n"),
                author_role: Some("track-13e".into()),
            })
            .await
            .unwrap();
        let summary1 = match env1.payload {
            EventPayload::ArtifactCreated { summary, .. } => summary,
            _ => panic!("expected ArtifactCreated"),
        };

        // Within the 2s window — a second emit on the same key reuses the
        // cached summary; the helper is not called again.
        let id2 = ArtifactId::new();
        let env2 = core
            .append_artifact_with_summary_hook(ArtifactDraft {
                workspace_id,
                artifact_id: id2,
                kind: ArtifactKind::CodeChange,
                title: "edit 2".into(),
                summary: "second description".into(),
                payload: PayloadRef::inline("b\n"),
                author_role: Some("track-13e".into()),
            })
            .await
            .unwrap();
        let summary2 = match env2.payload {
            EventPayload::ArtifactCreated { summary, .. } => summary,
            _ => panic!("expected ArtifactCreated"),
        };
        assert_eq!(summary1, summary2);
        assert_eq!(helper.call_count(), 1, "helper called exactly once");
    }

    #[tokio::test]
    async fn recap_workspace_emits_report_artifact() {
        let helper = Arc::new(TestHelper::new(
            "{\"headline\":\"Today: 2 changes\",\"bullets\":[\"a\",\"b\"]}",
            Duration::from_millis(10),
        ));
        let core = boot_with_helper(helper).await;
        let workspace_id = seed_workspace(&core).await;

        // Seed one prior artifact so `entries` is non-empty.
        core.append_artifact_with_summary_hook(ArtifactDraft {
            workspace_id,
            artifact_id: ArtifactId::new(),
            kind: ArtifactKind::CodeChange,
            title: "edit".into(),
            summary: "did stuff".into(),
            payload: PayloadRef::inline("x\n"),
            author_role: Some("track".into()),
        })
        .await
        .unwrap();

        let env = core.recap_workspace(workspace_id).await.unwrap();
        match env.payload {
            EventPayload::ArtifactCreated {
                artifact_kind,
                title,
                author_role,
                summary,
                ..
            } => {
                assert!(matches!(artifact_kind, ArtifactKind::Report));
                assert!(title.ends_with("recap"), "got title {title:?}");
                assert_eq!(author_role.as_deref(), Some("recap"));
                assert!(summary.contains("Today"), "got summary {summary:?}");
            }
            other => panic!("expected ArtifactCreated, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn recap_workspace_unknown_workspace_errors() {
        let helper = Arc::new(TestHelper::new("…", Duration::from_millis(1)));
        let core = boot_with_helper(helper).await;
        let err = core.recap_workspace(WorkspaceId::new()).await;
        assert!(matches!(err, Err(CoreError::NotFound(_))));
    }

    #[tokio::test]
    async fn audit_artifact_emits_anchored_comment() {
        let helper = Arc::new(TestHelper::new("supported", Duration::from_millis(5)));
        let core = boot_with_helper(helper).await;
        let workspace_id = seed_workspace(&core).await;

        let target_id = ArtifactId::new();
        core.append_artifact_with_summary_hook(ArtifactDraft {
            workspace_id,
            artifact_id: target_id,
            kind: ArtifactKind::Spec,
            title: "Spec".into(),
            summary: "all tests pass on the auth refactor".into(),
            payload: PayloadRef::inline("# Spec body\n"),
            author_role: Some("planner".into()),
        })
        .await
        .unwrap();

        let env = core
            .audit_artifact(target_id, "tests pass".into())
            .await
            .unwrap();
        match env.payload {
            EventPayload::ArtifactCreated {
                artifact_kind,
                author_role,
                summary,
                workspace_id: ws,
                ..
            } => {
                assert!(matches!(artifact_kind, ArtifactKind::Comment));
                assert_eq!(author_role.as_deref(), Some("auditor"));
                assert_eq!(ws, workspace_id);
                assert_eq!(summary, "supported");
            }
            other => panic!("expected ArtifactCreated, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fallback_truncate_bounds_long_input() {
        let s = "a".repeat(500);
        let cut = fallback_truncate(&s, FALLBACK_SUMMARY_LIMIT);
        assert!(cut.chars().count() <= FALLBACK_SUMMARY_LIMIT);
        assert!(cut.ends_with('…'));
        // Short input passes through unchanged.
        assert_eq!(fallback_truncate("hi", FALLBACK_SUMMARY_LIMIT), "hi");
    }

    #[test]
    fn audit_kind_label_covers_all_variants() {
        // Trivial, but guards against drift if a new ArtifactKind is added.
        let v = artifact_kind_label(ArtifactKind::CodeChange);
        assert_eq!(v, "code-change");
    }

    #[tokio::test]
    async fn non_code_change_kinds_bypass_hook() {
        let helper = Arc::new(TestHelper::new("nope", Duration::from_millis(1)));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let id = ArtifactId::new();
        let env = core
            .append_artifact_with_summary_hook(ArtifactDraft {
                workspace_id,
                artifact_id: id,
                kind: ArtifactKind::Spec,
                title: "title".into(),
                summary: "verbatim summary".into(),
                payload: PayloadRef::inline("body"),
                author_role: None,
            })
            .await
            .unwrap();
        match env.payload {
            EventPayload::ArtifactCreated { summary, .. } => {
                assert_eq!(summary, "verbatim summary");
            }
            _ => panic!("expected ArtifactCreated"),
        }
        assert_eq!(
            helper.call_count(),
            0,
            "non-code-change must not call helper"
        );

        // Also touch the unused ProjectId import so the compiler is happy.
        let _ = ProjectId::new();
    }
}
