//! Phase 21.A — finding primitives.
//!
//! A `Finding` is what a [`crate::EventPayload::FindingRecorded`] event
//! carries: a single observation produced by a deterministic detector
//! (Phase A) or a local-model synthesis pass (Phase B). Findings are
//! immutable once recorded; user feedback flows through a separate
//! [`crate::EventPayload::FindingSignaled`] event.
//!
//! The shape is **frozen** by Phase 21.A1 — Phase 21.A2 detectors must not
//! redesign it. Detector-specific configuration lives in
//! `designer_learn::DetectorConfig` (the consumer crate); this module owns
//! only what's embedded in the event log.

use crate::anchor::Anchor;
use crate::ids::{FindingId, ProjectId, WorkspaceId};
use crate::time::Timestamp;
use serde::{Deserialize, Serialize};

/// Finding severity. Detectors choose one based on the kind of pattern;
/// a config override can rewrite it (`DetectorConfig::impact_override`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Worth knowing about; no urgency.
    Info,
    /// User likely benefits from acting on this.
    Notice,
    /// User likely *needs* to act on this; behavior is drifting.
    Warn,
}

/// User calibration signal on a finding. Emitted by
/// [`crate::EventPayload::FindingSignaled`]. Phase A only records these;
/// Phase B's calibration loop reads them to adjust thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbSignal {
    /// "This was useful / accurate."
    Up,
    /// "This was noise / wrong."
    Down,
}

/// A single observation from a detector. See module docs for invariants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub id: FindingId,
    /// Stable name of the detector that produced this finding (e.g.
    /// `"repeated_correction"`). Match what the detector returns from
    /// `Detector::name`.
    pub detector_name: String,
    /// Producer version. Bump when the detector's output shape or
    /// thresholds change in a way that invalidates the finding cache.
    pub detector_version: u32,
    pub project_id: ProjectId,
    /// `None` for project-wide findings (e.g., CLAUDE.md size pressure).
    #[serde(default)]
    pub workspace_id: Option<WorkspaceId>,
    pub timestamp: Timestamp,
    pub severity: Severity,
    /// Confidence score in `[0.0, 1.0]`. Out-of-range values are detector
    /// bugs; consumers may clamp but should log.
    pub confidence: f32,
    /// Human-readable headline. Renderers use this verbatim in the
    /// "Designer noticed" list. Keep it short (<120 chars).
    pub summary: String,
    /// Evidence anchors the user can navigate back to. Empty is allowed
    /// but discouraged — without evidence, the user can't verify the
    /// claim.
    #[serde(default)]
    pub evidence: Vec<Anchor>,
    /// Phase B will populate this with a `ProposalRef`. Phase A leaves it
    /// `None`. Stored as opaque JSON so adding fields in Phase B doesn't
    /// require a core-crate edit per detector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_action: Option<serde_json::Value>,
    /// Cache key per detector_version. Two findings from the same
    /// detector with the same `window_digest` are considered the same
    /// observation; Phase A's incremental analysis dedupes on this.
    pub window_digest: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::Timestamp;

    #[test]
    fn finding_serde_round_trip() {
        let f = Finding {
            id: FindingId::new(),
            detector_name: "noop".into(),
            detector_version: 1,
            project_id: ProjectId::new(),
            workspace_id: None,
            timestamp: Timestamp::UNIX_EPOCH,
            severity: Severity::Info,
            confidence: 0.5,
            summary: "headline".into(),
            evidence: vec![],
            suggested_action: None,
            window_digest: "abc123".into(),
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: Finding = serde_json::from_str(&json).unwrap();
        assert_eq!(f, back);
    }

    #[test]
    fn severity_serde_is_snake_case() {
        let json = serde_json::to_string(&Severity::Warn).unwrap();
        assert_eq!(json, "\"warn\"");
        let back: Severity = serde_json::from_str("\"notice\"").unwrap();
        assert_eq!(back, Severity::Notice);
    }

    #[test]
    fn thumb_signal_serde_is_snake_case() {
        let json = serde_json::to_string(&ThumbSignal::Up).unwrap();
        assert_eq!(json, "\"up\"");
    }
}
