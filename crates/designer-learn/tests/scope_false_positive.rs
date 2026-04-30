//! Fixture-driven test for the `scope_false_positive` detector.
//!
//! Loads the trigger fixture (3 denials + 3 user-approved overrides on the
//! same canonical path) and the negative fixture (same denial pattern,
//! no overrides) and asserts the detector emits the right number of
//! `Finding`s with the expected stable fields. Volatile fields
//! (`id`, `timestamp`, `evidence` event ids, `window_digest`) aren't
//! asserted; the harness mirrors the example detector's pattern.

use designer_core::{EventEnvelope, ProjectId, Severity};
use designer_learn::{
    defaults::SCOPE_FALSE_POSITIVE_DEFAULTS, detectors::ScopeFalsePositiveDetector, Detector,
    Finding, SessionAnalysisInput,
};
use std::fs;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
struct ExpectedFile {
    findings: Vec<ExpectedFinding>,
}

#[derive(serde::Deserialize, Debug)]
struct ExpectedFinding {
    detector_name: String,
    detector_version: u32,
    severity: Severity,
    summary: String,
}

fn fixture_dir(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests");
    p.push("fixtures");
    p.push(name);
    p
}

fn load_input(name: &str) -> Vec<EventEnvelope> {
    let path = fixture_dir(name).join("input.jsonl");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<EventEnvelope>(line)
                .unwrap_or_else(|err| panic!("parse line `{line}`: {err}"))
        })
        .collect()
}

fn load_expected(name: &str) -> Vec<ExpectedFinding> {
    let path = fixture_dir(name).join("expected.json");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    let parsed: ExpectedFile =
        serde_json::from_str(&raw).unwrap_or_else(|err| panic!("parse {}: {err}", path.display()));
    parsed.findings
}

async fn run_detector(events: Vec<EventEnvelope>) -> Vec<Finding> {
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .events(events)
        .build();
    let cfg = SCOPE_FALSE_POSITIVE_DEFAULTS;
    let detector = ScopeFalsePositiveDetector;
    #[cfg(feature = "local-ops")]
    let findings = detector
        .analyze(&input, &cfg, None)
        .await
        .expect("detector ran");
    #[cfg(not(feature = "local-ops"))]
    let findings = detector.analyze(&input, &cfg).await.expect("detector ran");
    findings
}

#[tokio::test]
async fn fires_on_three_denials_followed_by_overrides() {
    let events = load_input("scope_false_positive");
    let expected = load_expected("scope_false_positive");

    let findings = run_detector(events).await;

    assert_eq!(
        findings.len(),
        expected.len(),
        "detector should emit exactly the expected count"
    );

    for (got, want) in findings.iter().zip(expected.iter()) {
        assert_eq!(got.detector_name, want.detector_name);
        assert_eq!(got.detector_version, want.detector_version);
        assert_eq!(got.severity, want.severity);
        assert_eq!(got.summary, want.summary);
        // Pin the "Summary copy" convention from CONTRIBUTING §"Summary copy".
        assert!(
            got.summary.chars().count() <= 100,
            "summary >100 chars: {}",
            got.summary
        );
        let lower = got.summary.to_lowercase();
        assert!(
            !lower.starts_with("you ") && !lower.contains(" you "),
            "summary uses second-person: {}",
            got.summary
        );
    }
}

#[tokio::test]
async fn quiet_when_no_user_override_follows() {
    let events = load_input("scope_false_positive_negative");
    let expected = load_expected("scope_false_positive_negative");

    let findings = run_detector(events).await;

    assert_eq!(
        findings.len(),
        expected.len(),
        "negative fixture should emit no findings"
    );
    assert!(findings.is_empty());
}
