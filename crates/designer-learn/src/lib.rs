//! Designer learning layer — Phase 21.
//!
//! This crate houses the **deterministic detectors** (Phase A) and, in
//! Phase B, the local-model synthesis pipeline that turns findings into
//! editable proposals. Phase 21.A1 (this landing) ships the foundation:
//! the [`Detector`] trait, [`SessionAnalysisInput`] bundle, threshold
//! defaults, and a no-op example detector that next-up agents
//! copy-rename to add the ten Phase A detectors in parallel.
//!
//! ## Crate split rationale
//!
//! Per `core-docs/roadmap.md` §"Phase 21.A — Locked contracts": the
//! learning layer is its own top-level crate. Three options were
//! considered:
//!
//! - **Inside `designer-core`.** Rejected — events are core; learning is
//!   a *consumer* of events. Putting analysis logic in core would couple
//!   every other crate that depends on core to the learning surface.
//! - **Inside `designer-local-models`.** Rejected — Phase A has zero
//!   LocalOps cost (pure Rust over the event store), so this crate
//!   would inherit a synchronous Foundation-helper dep tree it doesn't
//!   need. The Phase B helper integration arrives via the optional
//!   `local-ops` feature flag instead.
//! - **Standalone `designer-learn`** *(this design)*. Phase A consumers
//!   pull this with no `local-ops` feature; Phase B turns it on and
//!   adds `designer-local-models` to the dep tree. Phase A's IPC + UI
//!   work in `apps/desktop` and `packages/app` ships against the
//!   non-feature path.
//!
//! ## Adding a new detector
//!
//! See `CONTRIBUTING.md`. TL;DR: copy [`example_detector::NoopDetector`],
//! rename, replace the body of `analyze`, add a fixture under
//! `tests/fixtures/<name>/`, register the detector in [`Detector`]'s
//! consumers (the registry helper in `Detector::all()` is intentionally
//! a *list*, not a global, so detectors can be unit-tested in isolation).

pub mod defaults;
pub mod detectors;
pub mod example_detector;
pub mod session_input;

pub use detectors::compaction_pressure::CompactionPressureDetector;
pub use detectors::cost_hot_streak::CostHotStreakDetector;
pub use detectors::multi_step_tool_sequence::MultiStepToolSequenceDetector;
pub use detectors::repeated_correction::RepeatedCorrectionDetector;
pub use detectors::repeated_prompt_opening::RepeatedPromptOpeningDetector;
pub use detectors::scope_false_positive::ScopeFalsePositiveDetector;

pub use designer_core::{Anchor, Finding, FindingId, Severity, ThumbSignal};
pub use session_input::{
    count_by_kind, GateHistory, MemoryNote, SessionAnalysisInput, SessionAnalysisInputBuilder,
    ToolCallInventory,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Per-detector tuning knobs. Defaults migrate verbatim from Forge in
/// `defaults.rs`; users can override per-project via settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectorConfig {
    /// Master switch. Set to `false` either by user toggle or by the
    /// Forge co-installation rule (see [`forge_overlap`] below).
    pub enabled: bool,
    /// Minimum number of pattern occurrences before the detector emits
    /// a finding. Mirrors Forge's `min_occurrences`.
    pub min_occurrences: u32,
    /// Minimum number of distinct sessions across which the pattern
    /// must appear. Mirrors Forge's `min_sessions`.
    pub min_sessions: u32,
    /// User override of the default severity. `None` keeps the
    /// detector's built-in pick.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact_override: Option<Severity>,
    /// Maximum number of findings this detector may emit during a
    /// single Designer process lifetime. Enforced by
    /// `core_learn::report_finding`; once the cap is hit the call
    /// returns `Err(LearnError::SessionCapReached)`. Default is
    /// [`DEFAULT_MAX_FINDINGS_PER_SESSION`] (5) — generous enough that
    /// a healthy detector seldom hits it, tight enough that a runaway
    /// detector can't flood the live feed before the user notices.
    #[serde(default = "default_max_findings_per_session")]
    pub max_findings_per_session: u32,
}

/// Default cap for `DetectorConfig::max_findings_per_session`. Picked
/// to match the workspace-home top-N width: a single detector cannot
/// monopolize the surface in one session.
pub const DEFAULT_MAX_FINDINGS_PER_SESSION: u32 = 5;

fn default_max_findings_per_session() -> u32 {
    DEFAULT_MAX_FINDINGS_PER_SESSION
}

impl Default for DetectorConfig {
    /// Sensible defaults for tests. Real detectors pick a constant from
    /// `defaults.rs` instead of taking this — the calibration data is
    /// per-detector, not per-trait.
    fn default() -> Self {
        Self {
            enabled: true,
            min_occurrences: 3,
            min_sessions: 2,
            impact_override: None,
            max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
        }
    }
}

impl DetectorConfig {
    /// Disabled-by-default config used when Forge is co-installed and
    /// Designer's overlapping detector should defer.
    pub const DISABLED: Self = Self {
        enabled: false,
        min_occurrences: u32::MAX,
        min_sessions: u32::MAX,
        impact_override: None,
        max_findings_per_session: 0,
    };
}

/// Error returned by a detector run. Reserved for genuine failure;
/// finding-vs-no-finding is signaled by the `Vec<Finding>` length.
#[derive(Debug, Error)]
pub enum DetectorError {
    /// The detector tried to read a project file that didn't exist or
    /// was unreadable.
    #[error("io error: {0}")]
    Io(String),
    /// Catch-all for unexpected errors. Detectors should prefer the
    /// specific variants where possible.
    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for DetectorError {
    fn from(value: std::io::Error) -> Self {
        DetectorError::Io(value.to_string())
    }
}

/// The frozen detector trait. Phase 21.A1 locks the shape; Phase 21.A2
/// detectors implement it; Phase B detectors flip the optional `ops`
/// argument from `None` to `Some(&dyn LocalOps)` for synthesis.
///
/// `async_trait` is used instead of native async-fn-in-traits so the
/// trait is dyn-safe. Detectors are stored as `Box<dyn Detector>` in
/// the runtime registry.
#[async_trait]
#[cfg(feature = "local-ops")]
pub trait Detector: Send + Sync {
    fn name(&self) -> &'static str;
    fn version(&self) -> u32;
    /// Phase A: ignore `ops`. Phase B: take `Some(&dyn LocalOps)` for
    /// the quality-gate / synthesis pass.
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
        ops: Option<&dyn designer_local_models::LocalOps>,
    ) -> Result<Vec<Finding>, DetectorError>;
}

#[async_trait]
#[cfg(not(feature = "local-ops"))]
pub trait Detector: Send + Sync {
    fn name(&self) -> &'static str;
    fn version(&self) -> u32;
    /// Phase A surface — no `ops` argument when the `local-ops`
    /// feature is disabled. Phase B turns the feature on, which
    /// adds the optional `ops: Option<&dyn LocalOps>` parameter.
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError>;
}

/// Names that Forge ships with the same intent as a Designer detector.
/// When `~/.claude/plugins/forge/` is present, these detectors default
/// to disabled to avoid double-surfacing the same finding. Designer's
/// unique detectors (`approval_always_granted`, `scope_false_positive`,
/// `cost_hot_streak`, `compaction_pressure`, plus the other
/// `*Designer-unique*` items in the roadmap) always run.
///
/// Source: `core-docs/roadmap.md` §"Phase 21.A1 — Foundation /
/// Forge co-installation rule".
pub const FORGE_OVERLAP_DETECTORS: &[&str] = &[
    "repeated_correction",
    "repeated_prompt_opening",
    "multi_step_tool_sequence",
    "config_gap",
    "domain_specific_in_claude_md",
    "memory_promotion",
];

/// Returns `true` when `name` is one of the detectors that Forge also
/// ships, so the user co-installing both shouldn't get duplicate
/// findings unless they explicitly opt back in.
pub fn forge_overlap(name: &str) -> bool {
    FORGE_OVERLAP_DETECTORS.contains(&name)
}

/// Helper that builds a [`Finding`] window-digest. Phase A uses
/// `sha256(detector_name || ":" || joined-evidence-keys)` so two
/// findings produced from the same evidence dedupe across runs.
/// Detector authors should call this from `analyze` rather than
/// rolling their own hashing.
pub fn window_digest(detector_name: &str, evidence_keys: &[&str]) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(detector_name.as_bytes());
    hasher.update(b":");
    for k in evidence_keys {
        hasher.update(k.as_bytes());
        hasher.update(b"\x1f"); // ASCII unit separator
    }
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forge_overlap_recognizes_overlap_detectors() {
        assert!(forge_overlap("repeated_correction"));
        assert!(forge_overlap("memory_promotion"));
        // Designer-unique detectors are not in the overlap set.
        assert!(!forge_overlap("approval_always_granted"));
        assert!(!forge_overlap("scope_false_positive"));
        assert!(!forge_overlap("cost_hot_streak"));
        assert!(!forge_overlap("compaction_pressure"));
    }

    #[test]
    fn window_digest_is_stable_for_same_inputs() {
        let a = window_digest("noop", &["evt_1", "evt_2"]);
        let b = window_digest("noop", &["evt_1", "evt_2"]);
        assert_eq!(a, b);
        let c = window_digest("noop", &["evt_2", "evt_1"]);
        assert_ne!(a, c, "order is part of the key");
    }

    #[test]
    fn detector_config_disabled_constant_is_disabled() {
        let cfg = DetectorConfig::DISABLED;
        assert!(!cfg.enabled);
    }
}
