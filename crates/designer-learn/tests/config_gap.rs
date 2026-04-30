//! Fixture-driven tests for the `config_gap` detector.
//!
//! Unlike the event-stream detectors (`cost_hot_streak`, `scope_false_positive`),
//! this detector reads from `SessionAnalysisInput::project_root` on disk.
//! The fixtures are therefore real project trees under
//! `tests/fixtures/config_gap/<case>/`, not `input.jsonl` envelope captures.
//!
//! Three cases:
//!
//! - `positive/` — `.prettierrc` is present but `.claude/settings.json`
//!   has no prettier hook. Expects one Finding.
//! - `negative_hook_present/` — same `.prettierrc`, but settings.json
//!   wires a `pnpm exec prettier --write` hook. Expects zero findings.
//! - `negative_no_configs/` — empty project root. Expects zero findings.

use designer_core::{Anchor, Finding, ProjectId, Severity};
use designer_learn::{
    defaults::HOOK_DEFAULTS, detectors::config_gap::ConfigGapDetector, Detector,
    SessionAnalysisInput,
};
use std::path::{Path, PathBuf};

fn fixture_dir(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests");
    p.push("fixtures");
    p.push("config_gap");
    p.push(name);
    p
}

async fn run_fixture(name: &str) -> Vec<Finding> {
    let root = fixture_dir(name);
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .project_root(&root)
        .build();
    let detector = ConfigGapDetector;
    #[cfg(feature = "local-ops")]
    let findings = detector
        .analyze(&input, &HOOK_DEFAULTS, None)
        .await
        .expect("detector ran");
    #[cfg(not(feature = "local-ops"))]
    let findings = detector
        .analyze(&input, &HOOK_DEFAULTS)
        .await
        .expect("detector ran");
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
async fn positive_fires_on_missing_prettier_hook() {
    let dir = fixture_dir("positive");
    assert_fixture_dir(&dir);
    let findings = run_fixture("positive").await;
    assert_eq!(findings.len(), 1, "expected one gap, got {findings:?}");
    let f = &findings[0];
    assert_eq!(f.detector_name, "config_gap");
    assert_eq!(f.detector_version, 1);
    assert_eq!(f.severity, Severity::Notice);
    assert!(
        f.summary.contains("prettier"),
        "summary missing tool label: {}",
        f.summary,
    );
    assert!(
        f.summary.contains("PostToolUse"),
        "summary missing event: {}",
        f.summary,
    );
    assert!(
        !f.summary.to_lowercase().contains(" you "),
        "no second-person",
    );
    assert!(f.summary.chars().count() <= 80);
    assert_eq!(f.evidence.len(), 1);
    match &f.evidence[0] {
        Anchor::FilePath { path, line_range } => {
            assert_eq!(path, ".prettierrc");
            assert!(line_range.is_none());
        }
        other => panic!("expected FilePath anchor, got {other:?}"),
    }
}

#[tokio::test]
async fn negative_hook_present_quiet() {
    let dir = fixture_dir("negative_hook_present");
    assert_fixture_dir(&dir);
    let findings = run_fixture("negative_hook_present").await;
    assert!(
        findings.is_empty(),
        "matching hook should suppress, got {findings:?}",
    );
}

#[tokio::test]
async fn negative_no_configs_quiet() {
    let dir = fixture_dir("negative_no_configs");
    assert_fixture_dir(&dir);
    let findings = run_fixture("negative_no_configs").await;
    assert!(findings.is_empty());
}
