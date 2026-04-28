//! `noop_detector` — the worked example that Phase 21.A2 detector authors
//! copy-rename as a starting point.
//!
//! Why a no-op? The integration is the hard part; the algorithm is the
//! easy part. By shipping a detector that does *nothing* but passes the
//! fixture-test pipeline (input.jsonl → expected.json), the next ten
//! authors land their real detector by:
//!
//! 1. `cp src/example_detector.rs src/detectors/<name>.rs`
//! 2. Rename `NoopDetector` → `<Name>Detector`, `name()` → `"<name>"`.
//! 3. Replace the empty `analyze` body with the detection logic.
//! 4. `cp -r tests/fixtures/example tests/fixtures/<name>`, populate
//!    `input.jsonl` with the events that should trigger the finding,
//!    populate `expected.json` with the finding(s) the detector should
//!    emit.
//! 5. Add the detector to the registry in `lib.rs::Detector::all()`.
//!
//! Nothing in this file should grow detector-specific. If a future
//! detector needs more scaffolding than this file provides, lift it into
//! `lib.rs` so every detector benefits.

use crate::{Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::Finding;

/// A detector that returns an empty `Vec<Finding>` for any input. The
/// proof-of-life that the harness is wired correctly end-to-end.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopDetector;

impl NoopDetector {
    pub const NAME: &'static str = "noop";
    pub const VERSION: u32 = 1;
}

#[async_trait]
impl Detector for NoopDetector {
    fn name(&self) -> &'static str {
        Self::NAME
    }

    fn version(&self) -> u32 {
        Self::VERSION
    }

    #[cfg(feature = "local-ops")]
    async fn analyze(
        &self,
        _input: &SessionAnalysisInput,
        _config: &DetectorConfig,
        _ops: Option<&dyn designer_local_models::LocalOps>,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(Vec::new())
    }

    #[cfg(not(feature = "local-ops"))]
    async fn analyze(
        &self,
        _input: &SessionAnalysisInput,
        _config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::ProjectId;

    #[tokio::test]
    async fn noop_returns_no_findings_on_empty_input() {
        let detector = NoopDetector;
        let input = SessionAnalysisInput::builder(ProjectId::new()).build();
        let cfg = DetectorConfig::default();
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert!(findings.is_empty());
        assert_eq!(detector.name(), "noop");
        assert_eq!(detector.version(), 1);
    }
}
