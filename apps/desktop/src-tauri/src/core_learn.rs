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
    StreamOptions, ThumbSignal,
};
use std::path::Path;

impl AppCore {
    /// Append a [`EventPayload::FindingRecorded`] for `finding`.
    ///
    /// The finding flows on the workspace stream when `workspace_id` is
    /// `Some`, otherwise on the project stream. This mirrors how
    /// `MessagePosted` and `ApprovalRequested` route — workspace state
    /// stays workspace-scoped; project-wide signals (e.g.,
    /// `claude_md_demotion`) live on the project stream.
    pub async fn report_finding(&self, finding: Finding) -> designer_core::Result<()> {
        let stream = match finding.workspace_id {
            Some(ws) => StreamId::Workspace(ws),
            None => StreamId::Project(finding.project_id),
        };
        let payload = EventPayload::FindingRecorded { finding };
        let env = self
            .store
            .append(stream, None, Actor::system(), payload)
            .await?;
        self.projector.apply(&env);
        Ok(())
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
        Finding {
            id: FindingId::new(),
            detector_name: "noop".into(),
            detector_version: 1,
            project_id,
            workspace_id: None,
            timestamp: Timestamp::UNIX_EPOCH,
            severity: Severity::Info,
            confidence: 0.9,
            summary: summary.into(),
            evidence: vec![],
            suggested_action: None,
            window_digest: "abc".into(),
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
        core.report_finding(finding).await.unwrap();
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
        core.report_finding(finding).await.unwrap();
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
}
