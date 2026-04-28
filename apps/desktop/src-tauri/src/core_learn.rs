//! Phase 21.A1 — learning-layer wiring on `AppCore`.
//!
//! This module owns:
//!
//! - `report_finding` — append a [`EventPayload::FindingRecorded`] event
//!   from a detector or test harness.
//! - `list_findings` — project the event log into the read shape the
//!   Settings → Activity → "Designer noticed" page renders.
//! - `signal_finding` — record the user's thumbs-up/down calibration.
//! - `forge_present` — boot-time probe of `~/.claude/plugins/forge/`,
//!   used by the detector registry to default-disable overlapping
//!   detectors per the roadmap's Forge co-installation rule.
//!
//! Phase 21.A2 detectors don't touch this module — they implement
//! `Detector` and the harness in `core_learn` calls them. Phase A
//! ships before the harness; this module is the *floor* the harness
//! is built on.

use crate::core::AppCore;
use designer_core::{
    Actor, EventPayload, EventStore, Finding, FindingId, ProjectId, Projection, StreamId,
    StreamOptions, ThumbSignal, Timestamp,
};
use designer_learn::DetectorConfig;
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;
use tracing::debug;

/// Errors `core_learn::report_finding` can return that aren't a plain
/// pass-through of [`designer_core::CoreError`].
///
/// Phase 21.A1.1 introduces the cap-and-dedup write path; the new
/// shape is needed so the (eventual) Phase 21.A2 harness can branch on
/// "we hit the cap, stop calling" vs. "the underlying store failed,
/// surface it." Dedup is *not* an error variant — duplicates no-op
/// silently and return `Ok(())`.
#[derive(Debug, Error)]
pub enum LearnError {
    /// The detector has already emitted
    /// `DetectorConfig::max_findings_per_session` findings during this
    /// Designer process lifetime. Detector authors should treat this as
    /// "stop emitting; the user has enough signal already" and let the
    /// next process-restart reset the count.
    #[error("session cap reached for detector {detector}")]
    SessionCapReached {
        /// The detector name whose cap was hit; matches
        /// [`Finding::detector_name`].
        detector: String,
    },

    /// Pass-through for the underlying event-store / projection error.
    #[error(transparent)]
    Core(#[from] designer_core::CoreError),
}

impl From<LearnError> for designer_ipc::IpcError {
    fn from(value: LearnError) -> Self {
        match value {
            LearnError::SessionCapReached { detector } => designer_ipc::IpcError::invalid_request(
                format!("detector `{detector}` reached its per-session finding cap"),
            ),
            LearnError::Core(err) => err.into(),
        }
    }
}

/// Outcome of the inner `write_finding_unchecked` path. Distinct from
/// `Result<(), LearnError>` because the dedup no-op needs to be
/// distinguished from a successful write so the caller knows whether
/// to keep or refund the cap reservation.
enum WriteOutcome {
    /// Event was appended; the cap reservation stands.
    Written,
    /// `window_digest` matched an existing finding; refund the slot.
    DuplicateDigest,
    /// The underlying store / projection failed; refund the slot.
    Failed(LearnError),
}

impl AppCore {
    /// Append a [`EventPayload::FindingRecorded`] for `finding`, gated
    /// by per-detector caps and write-time dedup.
    ///
    /// **Routing.** The finding flows on the workspace stream when
    /// `workspace_id` is `Some`, otherwise on the project stream. This
    /// mirrors how `MessagePosted` and `ApprovalRequested` route —
    /// workspace state stays workspace-scoped; project-wide signals
    /// (e.g., `claude_md_demotion`) live on the project stream.
    ///
    /// **Cap (Phase 21.A1.1).** Each detector may emit at most
    /// `config.max_findings_per_session` findings during a single
    /// Designer process lifetime. The counter is in-memory and resets
    /// on restart — sessions are deliberately scoped to the process so
    /// a runaway detector can't flood the workspace-home live feed in
    /// one sitting, but the user gets a clean slate when they reopen
    /// the app.
    ///
    /// **Dedup (Phase 21.A1.1).** Before writing, the existing
    /// findings projection for the current project is scanned for the
    /// same `window_digest`. If one is already on file, the call
    /// silently no-ops and logs a debug-level message. This catches
    /// the harmless-but-noisy case of a detector re-emitting the same
    /// finding across replays or restarts.
    pub async fn report_finding(
        &self,
        finding: Finding,
        config: &DetectorConfig,
    ) -> Result<(), LearnError> {
        // Atomic check-and-reserve under a single lock acquisition.
        // Two concurrent callers can otherwise both pass a "count <
        // cap" check before either bumps, slipping past the cap by
        // one. Reserving up front and refunding on no-op / failure
        // keeps the cap exact even under contention.
        let detector = finding.detector_name.clone();
        {
            let mut counts = self.finding_session_counts.lock();
            let slot = counts.entry(detector.clone()).or_insert(0);
            if *slot >= config.max_findings_per_session {
                return Err(LearnError::SessionCapReached { detector });
            }
            *slot = slot.saturating_add(1);
        }

        // From here on, every early return must release the
        // reservation we just made — only a successful append earns it.
        match self.write_finding_unchecked(finding).await {
            WriteOutcome::Written => Ok(()),
            WriteOutcome::DuplicateDigest => {
                self.refund_session_slot(&detector);
                Ok(())
            }
            WriteOutcome::Failed(err) => {
                self.refund_session_slot(&detector);
                Err(err)
            }
        }
    }

    /// Inner write path used by [`Self::report_finding`] after the
    /// session cap has been reserved. Performs the dedup scan + event
    /// append; the caller refunds the reservation on the non-success
    /// outcomes.
    async fn write_finding_unchecked(&self, finding: Finding) -> WriteOutcome {
        let existing = match self.list_findings(finding.project_id).await {
            Ok(e) => e,
            Err(err) => return WriteOutcome::Failed(err.into()),
        };
        if existing
            .iter()
            .any(|f| f.window_digest == finding.window_digest)
        {
            debug!(
                detector = %finding.detector_name,
                window_digest = %finding.window_digest,
                "report_finding: duplicate window_digest in current project; no-op"
            );
            return WriteOutcome::DuplicateDigest;
        }

        let stream = match finding.workspace_id {
            Some(ws) => StreamId::Workspace(ws),
            None => StreamId::Project(finding.project_id),
        };
        let payload = EventPayload::FindingRecorded { finding };
        let env = match self
            .store
            .append(stream, None, Actor::system(), payload)
            .await
        {
            Ok(env) => env,
            Err(err) => return WriteOutcome::Failed(err.into()),
        };
        self.projector.apply(&env);
        WriteOutcome::Written
    }

    fn refund_session_slot(&self, detector: &str) {
        let mut counts = self.finding_session_counts.lock();
        if let Some(slot) = counts.get_mut(detector) {
            *slot = slot.saturating_sub(1);
        }
    }

    /// Append a [`EventPayload::FindingSignaled`] for `finding_id`.
    ///
    /// Phase 21.A1 records calibration signals only; Phase B's
    /// calibration loop reads them to retune thresholds. The event is
    /// streamed on the System log because the projection that backs
    /// "Designer noticed" walks a global read; routing to a specific
    /// workspace stream would require an extra lookup against the
    /// finding to recover its `workspace_id`.
    pub async fn signal_finding(
        &self,
        finding_id: FindingId,
        signal: ThumbSignal,
    ) -> designer_core::Result<()> {
        let payload = EventPayload::FindingSignaled { finding_id, signal };
        let env = self
            .store
            .append(StreamId::System, None, Actor::user(), payload)
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Read all findings recorded for a project (across its workspaces),
    /// in insertion order.
    ///
    /// Phase 21.A1 uses a linear walk over the project + workspace
    /// streams. With realistic Phase A volumes — at most a handful of
    /// findings per session — this is bounded and cheap. Phase B will
    /// move this to a dedicated projection when the cross-project
    /// aggregator (Phase 21.A3) lands.
    pub async fn list_findings(
        &self,
        project_id: ProjectId,
    ) -> designer_core::Result<Vec<Finding>> {
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
                if let EventPayload::FindingRecorded { finding } = env.payload {
                    out.push(finding);
                }
            }
        }
        Ok(out)
    }

    /// Project the System stream into the per-finding calibration
    /// snapshot. Last-write-wins on `FindingId` — if the user thumbed
    /// up then down, the badge will read `calibrated 👎`. Used by the
    /// IPC layer to attach `FindingCalibration` to each `FindingDto`.
    ///
    /// Phase 21.A1 stores every thumb as a fresh event; this projection
    /// is what the workspace-home and archive surfaces read against.
    pub async fn list_signals(
        &self,
    ) -> designer_core::Result<HashMap<FindingId, (ThumbSignal, Timestamp)>> {
        // `read_stream` returns events in sequence order, which is
        // monotonic per stream — a plain `insert` is therefore already
        // last-write-wins.
        let events = self
            .store
            .read_stream(StreamId::System, StreamOptions::default())
            .await?;
        Ok(events
            .into_iter()
            .filter_map(|env| match env.payload {
                EventPayload::FindingSignaled { finding_id, signal } => {
                    Some((finding_id, (signal, env.timestamp)))
                }
                _ => None,
            })
            .collect())
    }

    /// `true` when `~/.claude/plugins/forge/` exists.
    ///
    /// Re-checks the filesystem on each call — one `metadata()` syscall.
    /// Cheap, but called per-detector-init at most so caching is
    /// unnecessary in Phase 21.A1. Phase 21.A2 detectors with names in
    /// [`designer_learn::FORGE_OVERLAP_DETECTORS`] read this to default
    /// their config to disabled when Forge is co-installed.
    pub fn forge_present(&self) -> bool {
        forge_plugin_dir_exists()
    }
}

/// Probe `~/.claude/plugins/forge/`. Pure filesystem read; no
/// interaction with Forge's own state. Re-run cheaply at boot — one
/// `metadata()` syscall.
pub fn forge_plugin_dir_exists() -> bool {
    let Ok(home) = std::env::var("HOME") else {
        return false;
    };
    forge_plugin_dir_under(home.as_ref()).is_dir()
}

/// Path the Forge plugin would live at given a `home` root. Split out
/// so tests can probe a tempdir without mutating the process-wide
/// `HOME` env var (which races with sibling tests in this binary that
/// do the same).
fn forge_plugin_dir_under(home: &Path) -> std::path::PathBuf {
    home.join(".claude").join("plugins").join("forge")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, AppCore, AppCoreBoot};
    use designer_core::{Finding, FindingId, ProjectId, Severity, ThumbSignal, Timestamp};
    use designer_safety::CostCap;
    use std::sync::Arc;
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

    fn make_finding(project_id: ProjectId, summary: &str) -> Finding {
        make_finding_with(project_id, "noop", summary, "abc")
    }

    fn make_finding_with(
        project_id: ProjectId,
        detector: &str,
        summary: &str,
        window_digest: &str,
    ) -> Finding {
        Finding {
            id: FindingId::new(),
            detector_name: detector.into(),
            detector_version: 1,
            project_id,
            workspace_id: None,
            timestamp: Timestamp::UNIX_EPOCH,
            severity: Severity::Info,
            confidence: 0.9,
            summary: summary.into(),
            evidence: vec![],
            suggested_action: None,
            window_digest: window_digest.into(),
        }
    }

    #[tokio::test]
    async fn list_findings_is_empty_on_fresh_boot() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let findings = core.list_findings(project.id).await.unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn report_finding_round_trips_into_list_findings() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let finding = make_finding(project.id, "hand-crafted finding");
        let id = finding.id;
        core.report_finding(finding, &DetectorConfig::default())
            .await
            .unwrap();
        let listed = core.list_findings(project.id).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].summary, "hand-crafted finding");
    }

    #[tokio::test]
    async fn signal_finding_appends_a_finding_signaled_event() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let finding = make_finding(project.id, "to be signaled");
        let id = finding.id;
        core.report_finding(finding, &DetectorConfig::default())
            .await
            .unwrap();
        core.signal_finding(id, ThumbSignal::Up).await.unwrap();

        let events = core
            .store
            .read_all(designer_core::StreamOptions::default())
            .await
            .unwrap();
        let signals = events
            .iter()
            .filter(|e| {
                matches!(
                    &e.payload,
                    EventPayload::FindingSignaled {
                        finding_id,
                        signal: ThumbSignal::Up
                    } if *finding_id == id
                )
            })
            .count();
        assert_eq!(signals, 1, "expected exactly one FindingSignaled");
    }

    #[test]
    fn forge_plugin_dir_check_is_a_pure_filesystem_read() {
        // Smoke test: probe runs without panicking regardless of
        // host state. Real co-installation behavior is verified by
        // creating a stub directory in an integration test.
        let _present = forge_plugin_dir_exists();
    }

    /// Verifies the spec deliverable: "Forge detection works (test by
    /// creating a stub `~/.claude/plugins/forge/` dir)." Probes via
    /// `forge_plugin_dir_under` so the test never mutates
    /// process-wide `HOME` (other tests in this binary do; racing on
    /// `env::set_var` corrupts both sides).
    #[test]
    fn forge_plugin_dir_under_flips_when_stub_dir_exists() {
        let dir = tempdir().unwrap();
        let probe = forge_plugin_dir_under(dir.path());
        assert!(!probe.is_dir(), "stub dir should not exist yet");

        std::fs::create_dir_all(&probe).unwrap();
        assert!(
            probe.is_dir(),
            "stub dir should be visible after create_dir_all"
        );
    }

    /// Phase 21.A1.1 — once the cap is reached, further `report_finding`
    /// calls for the same detector return `SessionCapReached` instead of
    /// growing the projection. Other detectors keep their own budget.
    #[tokio::test]
    async fn report_finding_returns_session_cap_reached_after_n_writes() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig {
            max_findings_per_session: 2,
            ..DetectorConfig::default()
        };

        // Two writes succeed (each with a fresh window_digest so dedup
        // doesn't intercept).
        core.report_finding(
            make_finding_with(project.id, "demo", "first", "digest-1"),
            &cfg,
        )
        .await
        .unwrap();
        core.report_finding(
            make_finding_with(project.id, "demo", "second", "digest-2"),
            &cfg,
        )
        .await
        .unwrap();

        // The third hits the cap.
        let err = core
            .report_finding(
                make_finding_with(project.id, "demo", "third", "digest-3"),
                &cfg,
            )
            .await
            .unwrap_err();
        assert!(
            matches!(err, LearnError::SessionCapReached { ref detector } if detector == "demo")
        );

        // Other detectors aren't affected — caps are per detector.
        core.report_finding(
            make_finding_with(project.id, "other", "ok", "digest-other"),
            &cfg,
        )
        .await
        .unwrap();

        let listed = core.list_findings(project.id).await.unwrap();
        assert_eq!(listed.len(), 3);
    }

    /// Phase 21.A1.1 — `list_signals` collapses repeated thumbs on the
    /// same finding to a single entry (last write wins) so the
    /// workspace-home calibrated badge doesn't double-render.
    #[tokio::test]
    async fn list_signals_last_write_wins_on_repeat_thumbs() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let finding = make_finding(project.id, "to be re-signaled");
        let id = finding.id;
        core.report_finding(finding, &DetectorConfig::default())
            .await
            .unwrap();

        // Up, then up again, then down — projection should land on
        // Down with the latest timestamp.
        core.signal_finding(id, ThumbSignal::Up).await.unwrap();
        core.signal_finding(id, ThumbSignal::Up).await.unwrap();
        core.signal_finding(id, ThumbSignal::Down).await.unwrap();

        let signals = core.list_signals().await.unwrap();
        assert_eq!(signals.len(), 1);
        let (signal, _ts) = signals.get(&id).copied().unwrap();
        assert_eq!(signal, ThumbSignal::Down);
    }

    /// Phase 21.A1.1 — concurrent callers cannot slip past the cap.
    /// Spawns N+1 `report_finding` tasks against a cap of N; exactly N
    /// must succeed and the (N+1)th must hit `SessionCapReached`. With
    /// the naive "check then bump" pattern, two callers reading
    /// count=N-1 simultaneously could both write.
    #[tokio::test]
    async fn report_finding_cap_holds_under_concurrency() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cap: u32 = 3;
        let cfg = DetectorConfig {
            max_findings_per_session: cap,
            ..DetectorConfig::default()
        };

        let mut handles = Vec::new();
        let total: u32 = cap + 2;
        for i in 0..total {
            let core = core.clone();
            let cfg = cfg.clone();
            let pid = project.id;
            handles.push(tokio::spawn(async move {
                let digest = format!("digest-{i}");
                core.report_finding(make_finding_with(pid, "demo", "concurrent", &digest), &cfg)
                    .await
            }));
        }

        let mut writes = 0u32;
        let mut caps = 0u32;
        for h in handles {
            match h.await.unwrap() {
                Ok(()) => writes += 1,
                Err(LearnError::SessionCapReached { .. }) => caps += 1,
                Err(e) => panic!("unexpected error: {e:?}"),
            }
        }
        assert_eq!(writes, cap, "exactly {cap} writes should succeed");
        assert_eq!(caps, total - cap, "the rest hit the session cap");
        assert_eq!(
            core.list_findings(project.id).await.unwrap().len() as u32,
            cap
        );
    }

    /// Phase 21.A1.1 — duplicate `window_digest` writes silently no-op
    /// without touching the cap counter or the event store.
    #[tokio::test]
    async fn report_finding_dedupes_on_duplicate_window_digest() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let cfg = DetectorConfig::default();
        let digest = "shared-digest";

        core.report_finding(make_finding_with(project.id, "demo", "first", digest), &cfg)
            .await
            .unwrap();

        // Second call with the same digest is a no-op — Ok(()) with no
        // event written and no counter bump.
        core.report_finding(
            make_finding_with(project.id, "demo", "second", digest),
            &cfg,
        )
        .await
        .unwrap();

        let listed = core.list_findings(project.id).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            core.finding_session_counts.lock().get("demo").copied(),
            Some(1),
            "duplicate write must not consume the per-session budget"
        );
    }
}
