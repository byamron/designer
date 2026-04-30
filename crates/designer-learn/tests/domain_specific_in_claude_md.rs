//! Fixture-driven tests for the `domain_specific_in_claude_md` detector.
//!
//! The detector reads `<project_root>/CLAUDE.md` directly, so the
//! fixtures are real on-disk project trees under
//! `tests/fixtures/domain_specific_in_claude_md/<case>/`. This mirrors
//! the `config_gap` test layout and intentionally diverges from the
//! `input.jsonl` envelope-capture format used by event-stream detectors.
//!
//! Cases:
//!
//! - `positive/` — `CLAUDE.md` contains six lines that each substring-
//!   match a corpus keyword (extension, framework, or directory).
//!   Expects six findings.
//! - `negative_generic/` — `CLAUDE.md` is principles / axioms only, no
//!   extension or framework token. Expects zero findings.

use designer_core::{Anchor, Finding, ProjectId, Severity};
use designer_learn::{
    detectors::domain_specific_in_claude_md::DomainSpecificInClaudeMdDetector, Detector,
    DetectorConfig, SessionAnalysisInput,
};
use std::path::{Path, PathBuf};

fn fixture_dir(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests");
    p.push("fixtures");
    p.push("domain_specific_in_claude_md");
    p.push(name);
    p
}

async fn run_fixture(name: &str) -> Vec<Finding> {
    let root = fixture_dir(name);
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .project_root(&root)
        .build();
    let cfg = DetectorConfig::default();
    let detector = DomainSpecificInClaudeMdDetector;
    #[cfg(feature = "local-ops")]
    let findings = detector
        .analyze(&input, &cfg, None)
        .await
        .expect("detector ran");
    #[cfg(not(feature = "local-ops"))]
    let findings = detector.analyze(&input, &cfg).await.expect("detector ran");
    findings
}

fn assert_fixture_dir(p: &Path) {
    assert!(
        p.is_dir(),
        "fixture directory missing: {} — run from the repo root",
        p.display(),
    );
}

#[tokio::test]
async fn positive_fires_on_each_domain_line() {
    let dir = fixture_dir("positive");
    assert_fixture_dir(&dir);
    let findings = run_fixture("positive").await;
    assert_eq!(findings.len(), 6, "expected six findings, got {findings:?}");

    for f in &findings {
        assert_eq!(f.detector_name, "domain_specific_in_claude_md");
        assert_eq!(f.detector_version, 1);
        assert_eq!(f.severity, Severity::Notice);
        assert!(
            (f.confidence - 0.6).abs() < f32::EPSILON,
            "confidence {} not 0.6",
            f.confidence,
        );
        assert!(
            f.summary.starts_with("CLAUDE.md L"),
            "summary shape: {}",
            f.summary,
        );
        assert!(f.summary.chars().count() <= 80);
        assert!(
            !f.summary.to_lowercase().contains(" you "),
            "no second-person",
        );
        assert_eq!(f.evidence.len(), 1);
        match &f.evidence[0] {
            Anchor::FilePath { path, line_range } => {
                assert_eq!(path, "CLAUDE.md");
                let (start, end) = line_range.expect("single-line range");
                assert_eq!(start, end, "single-line range");
            }
            other => panic!("expected FilePath anchor, got {other:?}"),
        }
    }

    // Window digests must be unique across findings — keyed on
    // (line, keyword), so two distinct lines never collide.
    let mut digests: Vec<&str> = findings.iter().map(|f| f.window_digest.as_str()).collect();
    digests.sort_unstable();
    let before = digests.len();
    digests.dedup();
    assert_eq!(before, digests.len(), "window_digest collision");
}

#[tokio::test]
async fn negative_generic_quiet() {
    let dir = fixture_dir("negative_generic");
    assert_fixture_dir(&dir);
    let findings = run_fixture("negative_generic").await;
    assert!(
        findings.is_empty(),
        "principles-only CLAUDE.md should not fire, got {findings:?}",
    );
}
