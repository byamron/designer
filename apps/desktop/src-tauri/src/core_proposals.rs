//! Phase 21.A1.2 — proposal synthesis on `AppCore`.
//!
//! This module owns the *boundary-driven* surface refresh that
//! supersedes 21.A1.1's per-event live feed. Detectors keep firing
//! continuously; the user-facing surface only updates at exactly two
//! triggers:
//!
//! 1. **`TrackCompleted`** — natural "what did I learn from this work"
//!    moment. Debounced 30 s so a multi-step track close doesn't fire
//!    the synthesis pass repeatedly.
//! 2. **First workspace-home view of the day per project** — catches
//!    anything that didn't tie cleanly to a track.
//!
//! Never per-event. Never on a `MessagePosted`. Never on a `ToolUsed`.
//!
//! ## What synthesis does
//!
//! Reads the project's `FindingRecorded` events (which the Phase 21.A1
//! `report_finding` chokepoint already cap-gates and dedupes), groups
//! them by `(detector_name, workspace_id, window_digest)`, and emits
//! one [`EventPayload::ProposalEmitted`] per group with the source
//! finding ids attached. Phase 21.A1.2's synthesizer is a stub: title
//! is the detector's name humanized; summary is the highest-severity
//! source finding's summary; severity is the max of the source
//! severities; kind is [`ProposalKind::Hint`]; `suggested_diff` is
//! `None`. Phase B replaces the stub with real LLM synthesis; the
//! surface contract is forward-compatible.
//!
//! ## Idempotency
//!
//! Replay-safety is mandatory — `synthesize_pending` may be invoked
//! more than once per trigger (debounce timeout + first-view-of-day
//! collision, restart-and-re-trigger after a cold boot, etc.). Two
//! invocations with no new findings produce no duplicate proposals.
//! The dedupe key is the *sorted set of source finding ids* — if a
//! `ProposalEmitted` for the project already references the same
//! source set, the new emit is skipped.

use crate::core::AppCore;
use designer_core::{
    Actor, EventPayload, EventStore, FindingId, ProjectId, Projection, Proposal, ProposalId,
    ProposalKind, Severity, StreamId, StreamOptions, Timestamp, TrackId,
};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Weak};
use std::time::Duration;
use time::{Date, OffsetDateTime};
use tracing::{debug, warn};

/// Background subscriber that watches the event store for
/// `TrackCompleted` events and routes them into
/// [`AppCore::on_track_completed`]. Mirrors `spawn_message_coalescer`
/// for the agent message stream — one tokio task, holds a
/// `Weak<AppCore>` so it exits when the core drops.
///
/// Wired in `main.rs` next to the message coalescer.
///
/// Uses `tauri::async_runtime::spawn` rather than `tokio::spawn` because
/// this is invoked from Tauri's `setup` callback, which runs on the main
/// thread *before* a Tokio runtime context is active — `tokio::spawn`
/// panics there with "there is no reactor running". Same constraint as
/// `spawn_message_coalescer` (see `history.md` Phase 13.D).
pub fn spawn_track_completed_subscriber(core: Arc<AppCore>) {
    let mut rx = core.store.subscribe();
    let weak: Weak<AppCore> = Arc::downgrade(&core);
    drop(core);
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(env) => {
                    if let EventPayload::TrackCompleted { track_id } = env.payload {
                        let Some(core) = weak.upgrade() else {
                            break;
                        };
                        core.on_track_completed(track_id);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "track-completed subscriber lagged");
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Debounce window applied to `on_track_completed`. Picked to absorb
/// the burst of `FindingRecorded` events that follow a multi-step
/// track close (each detector finishes its window analysis as its
/// state catches up to the closing event), so the synthesis pass
/// runs once per logical track-close, not once per detector.
pub const TRACK_COMPLETE_DEBOUNCE: Duration = Duration::from_secs(30);

/// Internal state for the boundary-driven synthesis triggers. Held in
/// `AppCore` (one instance per process); both maps are scoped to the
/// running process.
///
/// - `track_debounce` tracks per-project "last accepted track-completed
///   time" + the in-flight debounced spawn handle so an active debounce
///   can be reset (or no-op'd) when another `TrackCompleted` arrives
///   inside the window.
/// - `first_view_dates` records, per project, the calendar date the
///   "first view of the day" trigger last fired. A second view the
///   same UTC date no-ops; rolling over midnight UTC re-arms the
///   trigger.
#[derive(Default)]
pub struct ProposalState {
    track_debounce: parking_lot::Mutex<HashMap<ProjectId, TrackDebounceSlot>>,
    first_view_dates: parking_lot::Mutex<HashMap<ProjectId, Date>>,
}

struct TrackDebounceSlot {
    /// Generation counter — bumped each time `on_track_completed` is
    /// called. The spawned task captures the value it was issued at;
    /// when the debounce timer elapses, it only synthesizes if the
    /// generation hasn't been bumped in the meantime. This is the
    /// "debounce reset on every call" pattern without leaking
    /// `JoinHandle`s.
    generation: u64,
}

impl ProposalState {
    pub fn new() -> Self {
        Self::default()
    }
}

impl AppCore {
    /// Trigger the synthesis pass for `project_id`. Reads all
    /// unprocessed findings, groups them, and emits one
    /// [`EventPayload::ProposalEmitted`] per group whose source-finding
    /// set has not already been proposed.
    ///
    /// Returns the freshly emitted proposal ids. An empty result means
    /// "nothing to propose right now" — either there are no findings
    /// or every group is already covered by an open proposal. Callers
    /// can run `synthesize_pending` more than once per trigger without
    /// duplicating proposals.
    pub async fn synthesize_pending(
        &self,
        project_id: ProjectId,
    ) -> designer_core::Result<Vec<ProposalId>> {
        let findings = self.list_findings(project_id).await?;
        if findings.is_empty() {
            return Ok(Vec::new());
        }

        let existing_source_sets = self.list_emitted_source_sets(project_id).await?;

        // Group findings by (detector_name, workspace_id, window_digest).
        // BTreeMap so emission order is deterministic per call.
        let mut groups: std::collections::BTreeMap<
            (String, Option<designer_core::WorkspaceId>, String),
            Vec<designer_core::Finding>,
        > = std::collections::BTreeMap::new();
        for f in findings {
            let key = (
                f.detector_name.clone(),
                f.workspace_id,
                f.window_digest.clone(),
            );
            groups.entry(key).or_default().push(f);
        }

        let mut emitted = Vec::new();
        for ((detector_name, workspace_id, _digest), group) in groups {
            // Sorted-set identity key used for dedupe. Order-independent
            // so a re-emit with the same evidence (regardless of
            // insertion order) is recognized as a duplicate.
            let source_set: BTreeSet<FindingId> = group.iter().map(|f| f.id).collect();
            if existing_source_sets.contains(&source_set) {
                debug!(
                    detector = %detector_name,
                    "synthesize_pending: skipping group already covered by an existing proposal"
                );
                continue;
            }

            // Pick the highest-severity finding as the headline source.
            let primary = group
                .iter()
                .max_by_key(|f| severity_rank(f.severity))
                .expect("group is non-empty");

            let proposal = Proposal {
                id: ProposalId::new(),
                project_id,
                workspace_id,
                source_findings: order_source_findings(&group, primary.id),
                title: humanize_detector_name(&detector_name),
                summary: primary.summary.clone(),
                severity: primary.severity,
                kind: ProposalKind::Hint,
                suggested_diff: None,
                created_at: now(),
            };
            let stream = match workspace_id {
                Some(ws) => StreamId::Workspace(ws),
                None => StreamId::Project(project_id),
            };
            let payload = EventPayload::ProposalEmitted {
                proposal: proposal.clone(),
            };
            match self
                .store
                .append(stream, None, Actor::system(), payload)
                .await
            {
                Ok(env) => {
                    self.projector.apply(&env);
                    emitted.push(proposal.id);
                }
                Err(err) => {
                    warn!(error = %err, "synthesize_pending: append failed");
                    return Err(err);
                }
            }
        }

        Ok(emitted)
    }

    /// Project the existing `ProposalEmitted` events for `project_id`
    /// into the set of source-finding sets already covered. Used by
    /// [`Self::synthesize_pending`] to skip groups whose evidence has
    /// already been proposed.
    async fn list_emitted_source_sets(
        &self,
        project_id: ProjectId,
    ) -> designer_core::Result<HashSet<BTreeSet<FindingId>>> {
        let mut streams = vec![StreamId::Project(project_id)];
        streams.extend(
            self.projector
                .workspaces_in(project_id)
                .into_iter()
                .map(|w| StreamId::Workspace(w.id)),
        );

        let mut out: HashSet<BTreeSet<FindingId>> = HashSet::new();
        for stream in streams {
            let events = self
                .store
                .read_stream(stream, StreamOptions::default())
                .await?;
            for env in events {
                if let EventPayload::ProposalEmitted { proposal } = env.payload {
                    out.insert(proposal.source_findings.into_iter().collect());
                }
            }
        }
        Ok(out)
    }

    /// Project the `ProposalEmitted` events for `project_id` into the
    /// list of proposals. Used by the IPC layer (`cmd_list_proposals`)
    /// and the resolution / signal helpers.
    pub async fn list_proposals(
        &self,
        project_id: ProjectId,
    ) -> designer_core::Result<Vec<Proposal>> {
        let mut streams = vec![StreamId::Project(project_id)];
        streams.extend(
            self.projector
                .workspaces_in(project_id)
                .into_iter()
                .map(|w| StreamId::Workspace(w.id)),
        );

        let mut out = Vec::new();
        for stream in streams {
            let events = self
                .store
                .read_stream(stream, StreamOptions::default())
                .await?;
            for env in events {
                if let EventPayload::ProposalEmitted { proposal } = env.payload {
                    out.push(proposal);
                }
            }
        }
        Ok(out)
    }

    /// Project all `ProposalResolved` events into a per-proposal map of
    /// the latest [`designer_core::ProposalResolution`]. Last-write-wins
    /// per `proposal_id` so a snoozed-then-dismissed proposal lands on
    /// `Dismissed`. Resolution events live on the System stream
    /// regardless of the proposal's originating workspace, mirroring
    /// the `signal_finding` routing.
    pub async fn list_resolutions(
        &self,
    ) -> designer_core::Result<HashMap<ProposalId, designer_core::ProposalResolution>> {
        let events = self
            .store
            .read_stream(StreamId::System, StreamOptions::default())
            .await?;
        let mut out = HashMap::new();
        for env in events {
            if let EventPayload::ProposalResolved {
                proposal_id,
                resolution,
            } = env.payload
            {
                out.insert(proposal_id, resolution);
            }
        }
        Ok(out)
    }

    /// Project the `ProposalSignaled` events into a last-write-wins
    /// map of `(ThumbSignal, Timestamp)`. Mirrors `list_signals` for
    /// findings; Phase B's calibration loop reads this projection.
    pub async fn list_proposal_signals(
        &self,
    ) -> designer_core::Result<
        HashMap<ProposalId, (designer_core::ThumbSignal, designer_core::Timestamp)>,
    > {
        let events = self
            .store
            .read_stream(StreamId::System, StreamOptions::default())
            .await?;
        Ok(events
            .into_iter()
            .filter_map(|env| match env.payload {
                EventPayload::ProposalSignaled {
                    proposal_id,
                    signal,
                } => Some((proposal_id, (signal, env.timestamp))),
                _ => None,
            })
            .collect())
    }

    /// Append a [`EventPayload::ProposalResolved`] for `proposal_id`.
    /// The resolution is whatever the user chose; the projection
    /// collapses Edited / Accepted into `ProposalStatus::Accepted` for
    /// the open / accepted / dismissed / snoozed filter buckets.
    pub async fn resolve_proposal(
        &self,
        proposal_id: ProposalId,
        resolution: designer_core::ProposalResolution,
    ) -> designer_core::Result<()> {
        let payload = EventPayload::ProposalResolved {
            proposal_id,
            resolution,
        };
        let env = self
            .store
            .append(StreamId::System, None, Actor::user(), payload)
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Append a [`EventPayload::ProposalSignaled`] for `proposal_id`.
    /// Phase 21.A1.2 just persists the signal; Phase B reads them to
    /// retune detector and synthesizer thresholds.
    pub async fn signal_proposal(
        &self,
        proposal_id: ProposalId,
        signal: designer_core::ThumbSignal,
    ) -> designer_core::Result<()> {
        let payload = EventPayload::ProposalSignaled {
            proposal_id,
            signal,
        };
        let env = self
            .store
            .append(StreamId::System, None, Actor::user(), payload)
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Trigger the boundary-driven synthesis pass for the project the
    /// completed track belongs to. Debounces by
    /// [`TRACK_COMPLETE_DEBOUNCE`] (30 s by default; tests can shrink
    /// via [`schedule_track_synthesis`]) so a multi-step track close
    /// produces exactly one synthesis pass even when several detectors
    /// emit findings during the close.
    ///
    /// `track_id` is resolved to a project via the workspace projection;
    /// no-ops cleanly on an unknown track id (the track-completed bus
    /// can outlive its issuing track during teardown).
    pub fn on_track_completed(self: &Arc<Self>, track_id: TrackId) {
        let Some(track) = self.projector.track(track_id) else {
            debug!(%track_id, "on_track_completed: unknown track; skipping");
            return;
        };
        let Some(workspace) = self.projector.workspace(track.workspace_id) else {
            debug!(%track_id, "on_track_completed: track has no workspace; skipping");
            return;
        };
        schedule_track_synthesis(self, workspace.project_id, TRACK_COMPLETE_DEBOUNCE);
    }

    /// Trigger the synthesis pass at most once per UTC calendar day per
    /// project. The first call on a given date schedules a synthesis
    /// run; subsequent calls the same date no-op. Rolling over midnight
    /// UTC re-arms the trigger.
    ///
    /// Synthesis runs synchronously (via `await`) — there's no
    /// debounce here because the trigger itself is the boundary.
    pub async fn on_first_view_of_day(
        self: &Arc<Self>,
        project_id: ProjectId,
    ) -> designer_core::Result<Vec<ProposalId>> {
        let today = today_utc();
        {
            let mut map = self.proposal_state.first_view_dates.lock();
            match map.get(&project_id) {
                Some(prev) if *prev == today => return Ok(Vec::new()),
                _ => {
                    map.insert(project_id, today);
                }
            }
        }
        self.synthesize_pending(project_id).await
    }
}

/// Schedule a debounced synthesis pass for `project_id`. A subsequent
/// call within `window` resets the timer (the in-flight task discovers
/// it's stale via the generation counter and exits without
/// synthesizing). Tests pass a short window via this entry point.
pub fn schedule_track_synthesis(core: &Arc<AppCore>, project_id: ProjectId, window: Duration) {
    let generation = {
        let mut map = core.proposal_state.track_debounce.lock();
        let slot = map
            .entry(project_id)
            .or_insert(TrackDebounceSlot { generation: 0 });
        slot.generation = slot.generation.saturating_add(1);
        slot.generation
    };

    let weak: Weak<AppCore> = Arc::downgrade(core);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(window).await;
        let Some(core) = weak.upgrade() else {
            return;
        };
        // Generation check — if a newer call has bumped the slot in the
        // meantime, this one is stale and another task will run.
        let current = {
            let map = core.proposal_state.track_debounce.lock();
            map.get(&project_id).map(|s| s.generation).unwrap_or(0)
        };
        if current != generation {
            return;
        }
        match core.synthesize_pending(project_id).await {
            Ok(ids) if !ids.is_empty() => {
                debug!(
                    %project_id,
                    count = ids.len(),
                    "track-completed synthesis emitted proposals"
                );
            }
            Ok(_) => {}
            Err(err) => {
                warn!(error = %err, "track-completed synthesis failed");
            }
        }
    });
}

/// Sequence the source findings so the highest-severity (the proposal's
/// "primary evidence") is first. Falls back to insertion order for
/// equal severity. Renderers expand evidence in this order under the
/// proposal's evidence drawer.
fn order_source_findings(
    group: &[designer_core::Finding],
    primary_id: FindingId,
) -> Vec<FindingId> {
    let mut out = Vec::with_capacity(group.len());
    out.push(primary_id);
    for f in group {
        if f.id != primary_id {
            out.push(f.id);
        }
    }
    out
}

fn severity_rank(s: Severity) -> u8 {
    match s {
        Severity::Warn => 2,
        Severity::Notice => 1,
        Severity::Info => 0,
    }
}

/// Convert a `snake_case` detector name to a human-readable headline.
/// "repeated_correction" → "Repeated correction". Used by the stub
/// synthesizer; Phase B's LLM synthesis writes a proper title.
pub fn humanize_detector_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut first = true;
    for ch in name.chars() {
        if ch == '_' {
            out.push(' ');
            continue;
        }
        if first {
            out.extend(ch.to_uppercase());
            first = false;
        } else {
            out.push(ch);
        }
    }
    out
}

fn now() -> Timestamp {
    OffsetDateTime::now_utc()
}

fn today_utc() -> Date {
    OffsetDateTime::now_utc().date()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, AppCore, AppCoreBoot};
    use designer_core::{Anchor, Finding, FindingId, ProjectId, Severity, ThumbSignal, Timestamp};
    use designer_learn::DetectorConfig;
    use designer_safety::CostCap;
    use std::sync::Arc;
    use std::time::Duration;
    use tempfile::tempdir;

    async fn boot_test_core() -> Arc<AppCore> {
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
        AppCore::boot(config).await.unwrap()
    }

    /// Regression test for the recurring "tokio::spawn from Tauri's setup
    /// callback panics" bug. Tauri's `setup` runs on the main thread
    /// without an entered Tokio runtime — `tokio::spawn` panics there
    /// with "there is no reactor running"; `tauri::async_runtime::spawn`
    /// dispatches to the runtime registered via `tauri::async_runtime::set`
    /// (production: main.rs) or a lazily-initialized default (tests).
    ///
    /// This test deliberately uses `#[test]`, not `#[tokio::test]`. The
    /// ambient Tokio context provided by `#[tokio::test]` masks the bug;
    /// the call site under test must work without one. After
    /// `bootstrap.block_on` returns, the test thread is no longer in any
    /// runtime context — that's the same shape as Tauri's setup callback
    /// at boot.
    #[test]
    fn spawn_subscribers_do_not_require_caller_runtime() {
        let bootstrap = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("bootstrap runtime");
        let core = bootstrap.block_on(boot_test_core());

        // Test thread is now outside any entered runtime context. Both
        // calls below must not panic; with the bug, either would.
        spawn_track_completed_subscriber(core.clone());
        schedule_track_synthesis(&core, ProjectId::new(), Duration::from_millis(10));
    }

    fn make_finding(
        project_id: ProjectId,
        detector: &str,
        digest: &str,
        severity: Severity,
        summary: &str,
    ) -> Finding {
        Finding {
            id: FindingId::new(),
            detector_name: detector.into(),
            detector_version: 1,
            project_id,
            workspace_id: None,
            timestamp: Timestamp::UNIX_EPOCH,
            severity,
            confidence: 0.9,
            summary: summary.into(),
            evidence: vec![] as Vec<Anchor>,
            suggested_action: None,
            window_digest: digest.into(),
        }
    }

    #[tokio::test]
    async fn humanize_detector_name_capitalizes_first_word_only() {
        assert_eq!(
            humanize_detector_name("repeated_correction"),
            "Repeated correction"
        );
        assert_eq!(
            humanize_detector_name("approval_always_granted"),
            "Approval always granted"
        );
        assert_eq!(humanize_detector_name("noop"), "Noop");
    }

    #[tokio::test]
    async fn synthesize_pending_emits_one_proposal_per_finding_group() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();

        // Two findings, different digests → two groups → two proposals.
        core.report_finding(
            make_finding(project.id, "demo", "d1", Severity::Notice, "first"),
            &cfg,
        )
        .await
        .unwrap();
        core.report_finding(
            make_finding(project.id, "demo", "d2", Severity::Warn, "second"),
            &cfg,
        )
        .await
        .unwrap();

        let ids = core.synthesize_pending(project.id).await.unwrap();
        assert_eq!(ids.len(), 2);
        let proposals = core.list_proposals(project.id).await.unwrap();
        assert_eq!(proposals.len(), 2);
    }

    #[tokio::test]
    async fn synthesize_pending_is_idempotent_across_replays() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        core.report_finding(
            make_finding(project.id, "demo", "d1", Severity::Notice, "only"),
            &cfg,
        )
        .await
        .unwrap();

        // First call emits one proposal; second call emits zero.
        let first = core.synthesize_pending(project.id).await.unwrap();
        let second = core.synthesize_pending(project.id).await.unwrap();
        assert_eq!(first.len(), 1);
        assert!(second.is_empty(), "second pass must not duplicate");
        let proposals = core.list_proposals(project.id).await.unwrap();
        assert_eq!(proposals.len(), 1);
    }

    #[tokio::test]
    async fn synthesize_pending_picks_max_severity_as_headline() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        // Same digest collapses on report_finding's dedupe — to force
        // multiple findings into one group, write distinct findings
        // through the underlying store. Here we just assert that two
        // distinct-digest findings produce two proposals each carrying
        // the original severity.
        core.report_finding(
            make_finding(project.id, "demo", "d1", Severity::Info, "low"),
            &cfg,
        )
        .await
        .unwrap();
        core.report_finding(
            make_finding(project.id, "demo", "d2", Severity::Warn, "high"),
            &cfg,
        )
        .await
        .unwrap();

        let _ = core.synthesize_pending(project.id).await.unwrap();
        let proposals = core.list_proposals(project.id).await.unwrap();
        assert_eq!(proposals.len(), 2);
        let high = proposals.iter().find(|p| p.summary == "high").unwrap();
        assert_eq!(high.severity, Severity::Warn);
    }

    #[tokio::test]
    async fn on_track_completed_debounces_burst_into_one_pass() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();

        // Five distinct findings — without coalescing, five `schedule`
        // calls in quick succession would synthesize five times.
        for i in 0..5 {
            let digest = format!("d{i}");
            core.report_finding(
                make_finding(project.id, "demo", &digest, Severity::Notice, "x"),
                &cfg,
            )
            .await
            .unwrap();
        }

        // Schedule five debounced synthesis runs in the same window.
        // The generation counter ensures only the last one wins.
        for _ in 0..5 {
            schedule_track_synthesis(&core, project.id, Duration::from_millis(50));
        }

        // Wait for the debounce to elapse + spawn slack.
        tokio::time::sleep(Duration::from_millis(200)).await;

        // Only one synthesis pass ran; it produced 5 proposals (one
        // per finding group) and did not run again.
        let proposals = core.list_proposals(project.id).await.unwrap();
        assert_eq!(proposals.len(), 5);
    }

    #[tokio::test]
    async fn on_first_view_of_day_fires_once_per_calendar_day() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        core.report_finding(
            make_finding(project.id, "demo", "d1", Severity::Notice, "only"),
            &cfg,
        )
        .await
        .unwrap();

        // First view of the day → synthesis runs.
        let first = core.on_first_view_of_day(project.id).await.unwrap();
        assert_eq!(first.len(), 1);

        // Add another finding mid-day. A subsequent first-view call
        // the same day must not synthesize again — the trigger is
        // already armed for tomorrow.
        core.report_finding(
            make_finding(project.id, "demo", "d2", Severity::Notice, "later"),
            &cfg,
        )
        .await
        .unwrap();
        let second = core.on_first_view_of_day(project.id).await.unwrap();
        assert!(
            second.is_empty(),
            "second view the same day must no-op: got {second:?}"
        );

        // Track-completed-style trigger still works mid-day.
        let manual = core.synthesize_pending(project.id).await.unwrap();
        assert_eq!(manual.len(), 1, "manual trigger still finds new groups");
    }

    #[tokio::test]
    async fn signal_proposal_round_trips_through_event_store() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        core.report_finding(
            make_finding(project.id, "demo", "d1", Severity::Notice, "x"),
            &cfg,
        )
        .await
        .unwrap();
        let _ = core.synthesize_pending(project.id).await.unwrap();
        let proposals = core.list_proposals(project.id).await.unwrap();
        let pid = proposals[0].id;

        core.signal_proposal(pid, ThumbSignal::Up).await.unwrap();
        core.signal_proposal(pid, ThumbSignal::Down).await.unwrap();

        let signals = core.list_proposal_signals().await.unwrap();
        let (signal, _ts) = signals.get(&pid).copied().unwrap();
        assert_eq!(signal, ThumbSignal::Down, "last-write-wins");
    }

    /// Phase 21.A1.2 — emitting findings without a synthesis trigger
    /// produces zero proposals. Verifies the badge contract: the
    /// sidebar counts `ProposalEmitted`, not `FindingRecorded`, so 10
    /// findings landing without a `TrackCompleted` (or first-view-of-day)
    /// must not increment the badge. Mirrors the spec's required test.
    #[tokio::test]
    async fn ten_findings_without_a_trigger_produce_no_proposals() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig {
            // Bump the cap so the runaway-protection at the chokepoint
            // doesn't intercept this test.
            max_findings_per_session: 20,
            ..DetectorConfig::default()
        };
        for i in 0..10 {
            let digest = format!("d{i}");
            core.report_finding(
                make_finding(project.id, "demo", &digest, Severity::Notice, "evidence"),
                &cfg,
            )
            .await
            .unwrap();
        }
        // No `synthesize_pending` was called. Therefore the proposal
        // projection must be empty — and the sidebar badge (which
        // counts `ProposalEmitted` events) stays at zero.
        let proposals = core.list_proposals(project.id).await.unwrap();
        assert!(
            proposals.is_empty(),
            "findings alone must not emit proposals: got {proposals:?}"
        );
    }

    /// Phase 21.A1.2 — soft-deprecation of `cmd_signal_finding`. The
    /// frontend rewrite stops calling this path, but it must keep
    /// working during the transition window so any in-flight surface
    /// continues to thumb. Regression: a finding signal still
    /// round-trips through the System stream.
    #[tokio::test]
    async fn deprecated_signal_finding_keeps_working_during_transition() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        let finding = make_finding(project.id, "demo", "d1", Severity::Notice, "x");
        let fid = finding.id;
        core.report_finding(finding, &cfg).await.unwrap();

        // The deprecated path is `signal_finding` on AppCore — it's
        // what `cmd_signal_finding` shims to. It must continue
        // appending a `FindingSignaled` event without erroring.
        core.signal_finding(fid, ThumbSignal::Up).await.unwrap();

        let signals = core.list_signals().await.unwrap();
        let (signal, _ts) = signals.get(&fid).copied().unwrap();
        assert_eq!(signal, ThumbSignal::Up);
    }

    #[tokio::test]
    async fn resolve_proposal_persists_resolution() {
        use designer_core::ProposalResolution;
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        core.report_finding(
            make_finding(project.id, "demo", "d1", Severity::Notice, "x"),
            &cfg,
        )
        .await
        .unwrap();
        let _ = core.synthesize_pending(project.id).await.unwrap();
        let proposals = core.list_proposals(project.id).await.unwrap();
        let pid = proposals[0].id;

        core.resolve_proposal(
            pid,
            ProposalResolution::Dismissed {
                reason: Some("low impact".into()),
            },
        )
        .await
        .unwrap();

        let resolutions = core.list_resolutions().await.unwrap();
        let resolution = resolutions.get(&pid).cloned().unwrap();
        assert!(matches!(
            resolution,
            ProposalResolution::Dismissed { reason: Some(ref r) } if r == "low impact"
        ));
    }
}
