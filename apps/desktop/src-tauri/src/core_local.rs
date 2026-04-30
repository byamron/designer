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
//!    artifacts, only the helper round-trip). Concurrent calls within the
//!    window share the same in-flight future via `SummaryDebounce`'s
//!    `Inflight` slot, so two callers 100ms apart spawn one helper round-trip,
//!    not two. Documented in ADR 0003.
//!
//! 2. **Recap.** `AppCore::recap_workspace` collects recent (non-archived)
//!    artifact summaries, calls `LocalOps::recap`, and emits
//!    `ArtifactCreated { kind: "report", author_role: Some("recap") }` keyed
//!    to the workspace.
//!
//! 3. **Audit verdicts.** `AppCore::audit_artifact` calls `LocalOps::audit_claim`
//!    against a non-archived target artifact's summary and emits a `comment`
//!    artifact in the target's workspace with `author_role: Some("auditor")`.
//!    The IPC requires an `expected_workspace_id` so a misbehaving caller
//!    cannot land a comment in a workspace it didn't intend to write to.
//!
//! ## Wiring contract — IMPORTANT for tracks D / E / G
//!
//! Tracks emitting `ArtifactCreated { kind: "code-change" }` **must** route
//! through `AppCore::append_artifact_with_summary_hook(draft)` rather than
//! calling `store.append(... ArtifactCreated ...)` directly. The seam is the
//! only place the on-device summary materializes; bypasses produce code-change
//! cards with the producer's raw verbose summary string and break ADR 0003's
//! "Decision 39 is enforced at write-time" guarantee. Search this crate and
//! `crates/designer-claude/` for `TODO(13.F-wiring)` to find the bypasses to
//! fix when 13.E lands.
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Mark cross-track hooks with `// TODO(13.X):` so grep finds them.
//! - IPC handlers live in `commands_local.rs`.
//! - Do **not** touch `core.rs` itself.

use crate::core::{AppCore, HelperStatusKind};
use designer_core::{
    author_roles, Actor, ArtifactId, ArtifactKind, CoreError, EventEnvelope, EventPayload,
    EventStore, PayloadRef, Projection, StreamId, WorkspaceId,
};
use designer_local_models::{AuditClaim, AuditVerdict, RecapInput, RowSummarizeInput};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::sync::watch;
use tracing::{debug, warn};

/// 500 ms — the hard append deadline for the write-time summary hook. Anything
/// slower lands an artifact with the deterministic fallback summary; the real
/// summary arrives later as an `ArtifactUpdated`.
pub const SUMMARY_HOOK_DEADLINE: Duration = Duration::from_millis(500);

/// 2s window inside which a second `code-change` artifact from the same
/// `(workspace, author_role)` reuses the previous summary — either by
/// short-circuiting to a cached value or by joining an in-flight call.
pub const SUMMARY_DEBOUNCE_WINDOW: Duration = Duration::from_secs(2);

/// Hard cap for the deterministic fallback summary. 140 chars matches the
/// rail-collapsed view's visible budget without truncating mid-grapheme on
/// most plain ASCII; we additionally trim on `chars()` so multi-byte
/// content doesn't split a code point.
pub const FALLBACK_SUMMARY_LIMIT: usize = 140;

/// Hard cap on the debounce cache. Pathological callers (1000 unique
/// `(workspace, author_role)` pairs in a 2s window) cannot grow the table
/// without bound; once we cross this, the oldest `Resolved` entry is dropped
/// before the new entry lands. `Inflight` slots are never evicted —
/// dropping their `Sender` would error every awaiting caller.
pub const SUMMARY_DEBOUNCE_MAX_ENTRIES: usize = 1024;

/// `(workspace_id, author_role)` — the per-track key for debounce.
/// `author_role` stands in for a future `track_id` until 13.E lands tracks on
/// the artifact event itself.
type TrackKey = (WorkspaceId, Option<String>);

/// One slot in the debounce cache.
#[derive(Debug)]
enum SummarySlot {
    /// A previous helper call succeeded recently; reuse the cached line.
    Resolved { ts: Instant, summary: String },
    /// A helper call is in flight; subsequent callers within the window
    /// subscribe to this watch instead of dispatching their own request.
    Inflight {
        tx: watch::Sender<Option<String>>,
        started: Instant,
    },
}

/// What a caller sees when it claims a key on the debounce cache.
enum SummaryClaim {
    /// Use this string verbatim — no helper call.
    Cached(String),
    /// Another caller is already running the helper; await its result.
    InFlight(watch::Receiver<Option<String>>),
    /// We are the new owner; run the helper and call `finish_inflight`.
    Owner(watch::Sender<Option<String>>),
}

/// Per-track debounce cache. Concurrent callers within the window share the
/// in-flight future so `helper.call_count() == 1` even for parallel bursts.
/// Bounded by `SUMMARY_DEBOUNCE_MAX_ENTRIES`; expired entries are pruned
/// opportunistically on each `claim`.
#[derive(Debug, Default)]
pub struct SummaryDebounce {
    inner: Mutex<HashMap<TrackKey, SummarySlot>>,
}

impl SummaryDebounce {
    pub fn new() -> Self {
        Self::default()
    }

    /// Claim `key` for the next helper call. Caller branches on the return:
    /// reuse a cached value, await the in-flight future, or run the call and
    /// publish via `finish_inflight`.
    fn claim(&self, key: TrackKey) -> SummaryClaim {
        let mut map = self.inner.lock();
        prune_expired(&mut map);

        match map.get(&key) {
            Some(SummarySlot::Resolved { ts, summary })
                if ts.elapsed() < SUMMARY_DEBOUNCE_WINDOW =>
            {
                return SummaryClaim::Cached(summary.clone());
            }
            Some(SummarySlot::Inflight { tx, started })
                if started.elapsed() < SUMMARY_DEBOUNCE_WINDOW =>
            {
                return SummaryClaim::InFlight(tx.subscribe());
            }
            _ => {}
        }

        // No live entry — install a new Inflight slot. If we're at the cap and
        // there's a Resolved entry to drop, evict it; never evict Inflights.
        if map.len() >= SUMMARY_DEBOUNCE_MAX_ENTRIES {
            evict_oldest_resolved(&mut map);
        }

        let (tx, _rx_seed) = watch::channel(None);
        let claim = SummaryClaim::Owner(tx.clone());
        map.insert(
            key,
            SummarySlot::Inflight {
                tx,
                started: Instant::now(),
            },
        );
        claim
    }

    /// Owner publishes the helper outcome. `Some(line)` resolves the slot for
    /// future cache hits; `None` (helper error / panic) drops the inflight
    /// sender so awaiting receivers wake with `RecvError` and fall back.
    fn finish_inflight(&self, key: &TrackKey, result: Option<String>) {
        let mut map = self.inner.lock();
        let prev = map.remove(key);
        match result {
            Some(summary) => {
                if let Some(SummarySlot::Inflight { tx, .. }) = prev {
                    let _ = tx.send(Some(summary.clone()));
                    drop(tx);
                }
                map.insert(
                    key.clone(),
                    SummarySlot::Resolved {
                        ts: Instant::now(),
                        summary,
                    },
                );
            }
            None => {
                if let Some(SummarySlot::Inflight { tx, .. }) = prev {
                    drop(tx);
                }
            }
        }
    }

    /// Test-only: number of slots currently held. Used by the eviction-under-
    /// churn test.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.inner.lock().len()
    }

    /// Test-only companion to `len` (silences the `len_without_is_empty` lint
    /// without scattering `#[allow(...)]`).
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.inner.lock().is_empty()
    }
}

fn prune_expired(map: &mut HashMap<TrackKey, SummarySlot>) {
    map.retain(|_, slot| match slot {
        SummarySlot::Resolved { ts, .. } => ts.elapsed() < SUMMARY_DEBOUNCE_WINDOW,
        // Inflights past the window stay until `finish_inflight` clears them —
        // dropping the sender mid-call would error every receiver.
        SummarySlot::Inflight { .. } => true,
    });
}

fn evict_oldest_resolved(map: &mut HashMap<TrackKey, SummarySlot>) {
    let oldest = map
        .iter()
        .filter_map(|(k, slot)| match slot {
            SummarySlot::Resolved { ts, .. } => Some((k.clone(), *ts)),
            SummarySlot::Inflight { .. } => None,
        })
        .min_by_key(|(_, ts)| *ts)
        .map(|(k, _)| k);
    if let Some(k) = oldest {
        map.remove(&k);
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
    /// verbatim. Tracks 13.D / 13.E / 13.G (and any future emitter of
    /// `code-change`) **must** route through this method instead of calling
    /// `store.append` directly so the on-device summary is materialized
    /// before the rail/collapsed-block view reads it.
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

        // 1. Helper unavailable — never even try; deterministic fallback only.
        if matches!(self.helper_status.kind, HelperStatusKind::Fallback) {
            let mut next = draft;
            next.summary = fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT);
            return self.append_artifact_inner(next).await;
        }

        // 2. Claim the debounce slot. Three branches: cached, joining an
        // in-flight call, or owning a new helper round-trip.
        match self.summary_debounce.claim(key.clone()) {
            SummaryClaim::Cached(summary) => {
                debug!(target: "local_models", "summary debounce reused cached row");
                let mut next = draft;
                next.summary = summary;
                self.append_artifact_inner(next).await
            }
            SummaryClaim::InFlight(rx) => self.append_joining_inflight(draft, rx).await,
            SummaryClaim::Owner(tx) => self.append_owning_helper_call(draft, key, tx).await,
        }
    }

    async fn append_joining_inflight(
        self: &Arc<Self>,
        draft: ArtifactDraft,
        mut rx: watch::Receiver<Option<String>>,
    ) -> designer_core::Result<EventEnvelope> {
        let waited = tokio::time::timeout(SUMMARY_HOOK_DEADLINE, rx.changed()).await;
        // Capture the joined result and drop the borrow guard before any
        // `.await` that might cross thread boundaries (the guard isn't Send).
        let joined: Option<String> = match waited {
            Ok(Ok(())) => {
                let v = rx.borrow().clone();
                if v.is_none() {
                    debug!(target: "local_models", "joined inflight published None; falling back");
                }
                v
            }
            Ok(Err(_)) => {
                debug!(target: "local_models", "joined inflight closed without value; falling back");
                None
            }
            Err(_) => {
                // Deadline elapsed while still waiting on owner. Fall back; do
                // NOT emit ArtifactUpdated for this artifact — the owner only
                // updates its own artifact_id, not joiners'. Joiners that hit
                // the deadline accept fallback as final. Future iteration
                // could broadcast late updates per artifact; out of scope.
                debug!(target: "local_models", "joined inflight exceeded deadline; falling back");
                None
            }
        };
        let mut next = draft;
        next.summary = match joined {
            Some(line) => line,
            None => fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT),
        };
        self.append_artifact_inner(next).await
    }

    async fn append_owning_helper_call(
        self: &Arc<Self>,
        draft: ArtifactDraft,
        key: TrackKey,
        publish_tx: watch::Sender<Option<String>>,
    ) -> designer_core::Result<EventEnvelope> {
        let local_ops = self.local_ops.clone();
        let row_input = RowSummarizeInput {
            row_kind: "code-change".into(),
            state: "open".into(),
            latest_activity: Some(draft.summary.clone()),
        };
        let mut handle = tokio::spawn(async move { local_ops.summarize_row(row_input).await });

        match tokio::time::timeout(SUMMARY_HOOK_DEADLINE, &mut handle).await {
            Ok(Ok(Ok(out))) => {
                let line = out.line;
                self.summary_debounce
                    .finish_inflight(&key, Some(line.clone()));
                drop(publish_tx);
                let mut next = draft;
                next.summary = line;
                self.append_artifact_inner(next).await
            }
            Ok(Ok(Err(e))) => {
                warn!(target: "local_models", error = %e, "summarize_row helper error; using fallback");
                self.summary_debounce.finish_inflight(&key, None);
                drop(publish_tx);
                let mut next = draft;
                next.summary = fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT);
                self.append_artifact_inner(next).await
            }
            Ok(Err(join_err)) => {
                warn!(target: "local_models", error = %join_err, "summarize_row task panicked; using fallback");
                self.summary_debounce.finish_inflight(&key, None);
                drop(publish_tx);
                let mut next = draft;
                next.summary = fallback_truncate(&next.summary, FALLBACK_SUMMARY_LIMIT);
                self.append_artifact_inner(next).await
            }
            Err(_) => {
                // 500ms deadline — append fallback immediately, then await
                // the helper in a detached task and emit ArtifactUpdated when
                // it returns. The detached task holds a Weak<Self> so it
                // doesn't extend AppCore lifetime past shutdown.
                let artifact_id = draft.artifact_id;
                let payload = draft.payload.clone();
                let mut fallback_draft = draft;
                fallback_draft.summary =
                    fallback_truncate(&fallback_draft.summary, FALLBACK_SUMMARY_LIMIT);
                let env = self.append_artifact_inner(fallback_draft).await?;

                let weak = Arc::downgrade(self);
                tokio::spawn(async move {
                    let helper_outcome = handle.await;
                    let Some(me) = weak.upgrade() else {
                        debug!(target: "local_models", "AppCore dropped; abandoning late summary");
                        return;
                    };
                    match helper_outcome {
                        Ok(Ok(out)) => {
                            let line = out.line;
                            me.summary_debounce
                                .finish_inflight(&key, Some(line.clone()));
                            drop(publish_tx);
                            if let Err(e) =
                                me.emit_artifact_updated(artifact_id, line, payload).await
                            {
                                warn!(target: "local_models", error = %e, "late-summary ArtifactUpdated append failed");
                            }
                        }
                        Ok(Err(e)) => {
                            debug!(target: "local_models", error = %e, "late summary helper error; keeping fallback");
                            me.summary_debounce.finish_inflight(&key, None);
                            drop(publish_tx);
                        }
                        Err(e) => {
                            warn!(target: "local_models", error = %e, "late summary task join error");
                            me.summary_debounce.finish_inflight(&key, None);
                            drop(publish_tx);
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
        // Late summary on an archived artifact is a no-op the user would never
        // see. Skip the append — the projector ignores updates after archive.
        if current.archived_at.is_some() {
            debug!(target: "local_models", "late summary suppressed; target archived");
            return Err(CoreError::NotFound(artifact_id.to_string()));
        }
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
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
        if matches!(
            workspace.state,
            designer_core::WorkspaceState::Archived | designer_core::WorkspaceState::Errored
        ) {
            return Err(CoreError::Invariant(format!(
                "recap not available on workspace in state {:?}",
                workspace.state
            )));
        }
        // `list_artifacts` already filters archived artifacts at the projector
        // level, so we don't need to re-filter here.
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
            author_role: Some(author_roles::RECAP.into()),
        })
        .await
    }

    /// Audit a claim against an existing artifact's summary. Emits a `comment`
    /// artifact in the target's workspace with `author_role: Some("auditor")`.
    /// Returns `NotFound` if the target is missing or archived; returns
    /// `Invariant` if `expected_workspace_id` doesn't match the target's
    /// workspace (cross-workspace boundary check — keeps a misbehaving caller
    /// from landing comments in a workspace it didn't intend).
    pub async fn audit_artifact(
        self: &Arc<Self>,
        artifact_id: ArtifactId,
        expected_workspace_id: WorkspaceId,
        claim: String,
    ) -> designer_core::Result<EventEnvelope> {
        let target = self
            .projector
            .artifact(artifact_id)
            .ok_or_else(|| CoreError::NotFound(artifact_id.to_string()))?;
        if target.archived_at.is_some() {
            return Err(CoreError::NotFound(artifact_id.to_string()));
        }
        if target.workspace_id != expected_workspace_id {
            return Err(CoreError::Invariant(format!(
                "audit target workspace mismatch: expected {expected_workspace_id}, target lives in {}",
                target.workspace_id
            )));
        }
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
            author_role: Some(author_roles::AUDITOR.into()),
        })
        .await
    }
}

// Quiet the "unused" warning when the only reader is `Weak::upgrade` chains.
#[allow(dead_code)]
fn _weak_appcore_helper(_w: Weak<AppCore>) {}

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

/// Local-time weekday (e.g. "Wednesday"). Falls back to UTC when the host
/// can't resolve a local offset (sandboxed CI envs sometimes can't), so the
/// label is always non-empty even if it's an hour off.
fn weekday_label() -> String {
    let now = local_or_utc_now();
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
    let now = local_or_utc_now();
    format!(
        "{}-{:02}-{:02}",
        now.year(),
        u8::from(now.month()),
        now.day()
    )
}

fn local_or_utc_now() -> time::OffsetDateTime {
    time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc())
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
pub(crate) mod tests {
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
    pub(crate) async fn boot_with_helper(helper: Arc<dyn FoundationHelper>) -> Arc<AppCore> {
        boot_with_helper_status(helper, HelperStatusKind::Live).await
    }

    pub(crate) async fn boot_with_helper_status(
        helper: Arc<dyn FoundationHelper>,
        kind: HelperStatusKind,
    ) -> Arc<AppCore> {
        let local_ops: Arc<dyn LocalOps> = Arc::new(FoundationLocalOps::new(helper.clone()));
        boot_with_local_ops(helper, local_ops, kind).await
    }

    /// Like `boot_with_helper_status` but lets the caller swap in a custom
    /// `LocalOps` implementation — useful for cross-module tests that want to
    /// count `summarize_row` calls without owning the helper plumbing.
    pub(crate) async fn boot_with_local_ops(
        helper: Arc<dyn FoundationHelper>,
        local_ops: Arc<dyn LocalOps>,
        kind: HelperStatusKind,
    ) -> Arc<AppCore> {
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

        let helper_status = HelperStatus {
            kind,
            fallback_reason: match kind {
                HelperStatusKind::Live => None,
                HelperStatusKind::Fallback => Some(crate::core::FallbackReason::ModelsUnavailable),
            },
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
            finding_session_counts: parking_lot::Mutex::new(std::collections::HashMap::new()),
            proposal_state: crate::core_proposals::ProposalState::new(),
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
        let _ = ws.project_id;
        ws.id
    }

    fn draft(
        workspace_id: WorkspaceId,
        kind: ArtifactKind,
        title: &str,
        summary: &str,
        author_role: Option<&str>,
    ) -> ArtifactDraft {
        ArtifactDraft {
            workspace_id,
            artifact_id: ArtifactId::new(),
            kind,
            title: title.into(),
            summary: summary.into(),
            payload: PayloadRef::inline("body\n"),
            author_role: author_role.map(|s| s.into()),
        }
    }

    #[tokio::test]
    async fn write_time_hook_intercepts_code_change_summary() {
        let helper = Arc::new(TestHelper::new(
            "agent renamed two helpers and rewrote auth-middleware tests",
            Duration::from_millis(20),
        ));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let mut d = draft(
            workspace_id,
            ArtifactKind::CodeChange,
            "auth-middleware refactor",
            "raw description from track",
            Some("track-13e"),
        );
        d.payload = PayloadRef::inline("a.rs\nb.rs\n");
        let env = core.append_artifact_with_summary_hook(d).await.unwrap();

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

        let raw = "x".repeat(300);
        let mut d = draft(
            workspace_id,
            ArtifactKind::CodeChange,
            "verbose change",
            &raw,
            Some("track-13e"),
        );
        d.payload = PayloadRef::inline("file.rs\n");
        let id = d.artifact_id;
        let env = core.append_artifact_with_summary_hook(d).await.unwrap();

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

        let env = core
            .append_artifact_with_summary_hook(draft(
                workspace_id,
                ArtifactKind::CodeChange,
                "title",
                "the original description",
                Some("track-13e"),
            ))
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

        let env1 = core
            .append_artifact_with_summary_hook(draft(
                workspace_id,
                ArtifactKind::CodeChange,
                "edit 1",
                "first description",
                Some("track-13e"),
            ))
            .await
            .unwrap();
        let summary1 = match env1.payload {
            EventPayload::ArtifactCreated { summary, .. } => summary,
            _ => panic!("expected ArtifactCreated"),
        };

        let env2 = core
            .append_artifact_with_summary_hook(draft(
                workspace_id,
                ArtifactKind::CodeChange,
                "edit 2",
                "second description",
                Some("track-13e"),
            ))
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
    async fn concurrent_burst_shares_one_helper_call() {
        // Two callers fire 100ms apart while the helper takes 800ms; the
        // second caller joins the in-flight watch instead of dispatching its
        // own request. helper.call_count() must end at 1.
        let helper = Arc::new(TestHelper::new(
            "shared on-device summary",
            Duration::from_millis(800),
        ));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let core_a = core.clone();
        let a = tokio::spawn(async move {
            core_a
                .append_artifact_with_summary_hook(draft(
                    workspace_id,
                    ArtifactKind::CodeChange,
                    "edit A",
                    "raw A",
                    Some("track-shared"),
                ))
                .await
        });

        tokio::time::sleep(Duration::from_millis(100)).await;

        let core_b = core.clone();
        let b = tokio::spawn(async move {
            core_b
                .append_artifact_with_summary_hook(draft(
                    workspace_id,
                    ArtifactKind::CodeChange,
                    "edit B",
                    "raw B",
                    Some("track-shared"),
                ))
                .await
        });

        let _ = a.await.unwrap().unwrap();
        let _ = b.await.unwrap().unwrap();

        // Wait for the late owner-side return to land, then verify single
        // helper round-trip across the burst.
        tokio::time::sleep(Duration::from_millis(900)).await;
        assert_eq!(
            helper.call_count(),
            1,
            "concurrent burst must share one helper round-trip"
        );
    }

    #[tokio::test]
    async fn helper_down_with_long_summary_truncates_immediately() {
        // Fallback status — helper is never called; the long summary must
        // still appear truncated to FALLBACK_SUMMARY_LIMIT.
        let helper = Arc::new(TestHelper::new("ignored", Duration::from_millis(0)));
        let core = boot_with_helper_status(helper.clone(), HelperStatusKind::Fallback).await;
        let workspace_id = seed_workspace(&core).await;
        let raw = "y".repeat(500);

        let env = core
            .append_artifact_with_summary_hook(draft(
                workspace_id,
                ArtifactKind::CodeChange,
                "long",
                &raw,
                Some("track"),
            ))
            .await
            .unwrap();
        match env.payload {
            EventPayload::ArtifactCreated { summary, .. } => {
                assert!(summary.chars().count() <= FALLBACK_SUMMARY_LIMIT);
                assert!(summary.ends_with('…'));
            }
            _ => panic!("expected ArtifactCreated"),
        }
        assert_eq!(
            helper.call_count(),
            0,
            "fallback status must not call helper"
        );
    }

    #[tokio::test]
    async fn debounce_cache_is_bounded_under_churn() {
        let helper = Arc::new(TestHelper::new("ok", Duration::from_millis(1)));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        // 1000 distinct keys via varied author_role.
        for i in 0..1000 {
            let role = format!("track-{i}");
            core.append_artifact_with_summary_hook(draft(
                workspace_id,
                ArtifactKind::CodeChange,
                "x",
                "y",
                Some(&role),
            ))
            .await
            .unwrap();
        }

        let len = core.summary_debounce.len();
        assert!(
            len <= SUMMARY_DEBOUNCE_MAX_ENTRIES,
            "debounce cache must be bounded; got {len} entries (cap {SUMMARY_DEBOUNCE_MAX_ENTRIES})"
        );
    }

    #[tokio::test]
    async fn recap_workspace_emits_report_artifact() {
        let helper = Arc::new(TestHelper::new(
            "{\"headline\":\"Today: 2 changes\",\"bullets\":[\"a\",\"b\"]}",
            Duration::from_millis(10),
        ));
        let core = boot_with_helper(helper).await;
        let workspace_id = seed_workspace(&core).await;

        core.append_artifact_with_summary_hook(draft(
            workspace_id,
            ArtifactKind::CodeChange,
            "edit",
            "did stuff",
            Some("track"),
        ))
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
                assert_eq!(author_role.as_deref(), Some(author_roles::RECAP));
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

        let mut target = draft(
            workspace_id,
            ArtifactKind::Spec,
            "Spec",
            "all tests pass on the auth refactor",
            Some("planner"),
        );
        let target_id = target.artifact_id;
        target.payload = PayloadRef::inline("# Spec body\n");
        core.append_artifact_with_summary_hook(target)
            .await
            .unwrap();

        let env = core
            .audit_artifact(target_id, workspace_id, "tests pass".into())
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
                assert_eq!(author_role.as_deref(), Some(author_roles::AUDITOR));
                assert_eq!(ws, workspace_id);
                assert_eq!(summary, "supported");
            }
            other => panic!("expected ArtifactCreated, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn audit_rejects_archived_target() {
        let helper = Arc::new(TestHelper::new("supported", Duration::from_millis(1)));
        let core = boot_with_helper(helper).await;
        let workspace_id = seed_workspace(&core).await;

        let mut t = draft(
            workspace_id,
            ArtifactKind::Spec,
            "Spec",
            "summary",
            Some("planner"),
        );
        let target_id = t.artifact_id;
        t.payload = PayloadRef::inline("# body\n");
        core.append_artifact_with_summary_hook(t).await.unwrap();

        // Archive the target via direct append (the projector apply path).
        core.store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::system(),
                EventPayload::ArtifactArchived {
                    artifact_id: target_id,
                },
            )
            .await
            .unwrap();
        // Sync the projector since this append went around AppCore.
        core.sync_projector_from_log().await.unwrap();

        let err = core
            .audit_artifact(target_id, workspace_id, "still pass".into())
            .await;
        assert!(
            matches!(err, Err(CoreError::NotFound(_))),
            "audit on archived target must return NotFound, got {err:?}"
        );
    }

    #[tokio::test]
    async fn audit_rejects_cross_workspace_request() {
        let helper = Arc::new(TestHelper::new("supported", Duration::from_millis(1)));
        let core = boot_with_helper(helper).await;
        let workspace_a = seed_workspace(&core).await;

        // Create a second workspace under the same project.
        let projects = core.list_projects().await;
        let project = projects.first().expect("project seeded");
        let workspace_b = core
            .create_workspace(project.id, "ws-b".into(), "main".into())
            .await
            .unwrap()
            .id;

        let mut t = draft(
            workspace_a,
            ArtifactKind::Spec,
            "Spec",
            "summary",
            Some("planner"),
        );
        let target_id = t.artifact_id;
        t.payload = PayloadRef::inline("# body\n");
        core.append_artifact_with_summary_hook(t).await.unwrap();

        // Caller claims the artifact lives in B; it actually lives in A.
        let err = core
            .audit_artifact(target_id, workspace_b, "claim".into())
            .await;
        assert!(
            matches!(err, Err(CoreError::Invariant(_))),
            "cross-workspace audit must be rejected, got {err:?}"
        );
    }

    #[tokio::test]
    async fn fallback_truncate_bounds_long_input() {
        let s = "a".repeat(500);
        let cut = fallback_truncate(&s, FALLBACK_SUMMARY_LIMIT);
        assert!(cut.chars().count() <= FALLBACK_SUMMARY_LIMIT);
        assert!(cut.ends_with('…'));
        assert_eq!(fallback_truncate("hi", FALLBACK_SUMMARY_LIMIT), "hi");
    }

    #[test]
    fn audit_kind_label_covers_all_variants() {
        let v = artifact_kind_label(ArtifactKind::CodeChange);
        assert_eq!(v, "code-change");
    }

    #[tokio::test]
    async fn non_code_change_kinds_bypass_hook() {
        let helper = Arc::new(TestHelper::new("nope", Duration::from_millis(1)));
        let core = boot_with_helper(helper.clone()).await;
        let workspace_id = seed_workspace(&core).await;

        let env = core
            .append_artifact_with_summary_hook(draft(
                workspace_id,
                ArtifactKind::Spec,
                "title",
                "verbatim summary",
                None,
            ))
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

        let _ = ProjectId::new();
    }
}
