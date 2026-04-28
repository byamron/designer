//! Fixture test harness — proof-of-life that the
//! `tests/fixtures/<detector>/` pattern works end-to-end.
//!
//! Phase 21.A2 detector authors copy this file as
//! `tests/<detector>.rs`, replace the detector type, and update the
//! fixture path. The harness is deliberately tiny: the *behavior* of a
//! fixture test is the canonical reference for "what does this
//! detector actually do" — keeping it readable matters more than
//! abstracting a shared driver.
//!
//! ## Fixture format
//!
//! `tests/fixtures/<name>/input.jsonl` — one JSON-encoded
//! `EventEnvelope` per line. The events go through `serde_json` round-trip,
//! so any format change to a core type that's emitted on the line breaks
//! the fixture — by design. Update fixtures by capturing the same
//! envelope from a real test boot via
//! `serde_json::to_string(&envelope)`.
//!
//! `tests/fixtures/<name>/expected.json` — `{"findings": [<Finding>, …]}`.
//! Findings round-trip through `serde_json::to_value(&findings)`. Tests
//! compare *length* and detector-stable fields (`detector_name`,
//! `severity`, `summary`); volatile fields (`id`, `timestamp`) are not
//! asserted unless the detector pins them.

use designer_core::{EventEnvelope, Finding, ProjectId};
use designer_learn::{
    example_detector::NoopDetector, Detector, DetectorConfig, SessionAnalysisInput,
};
use std::fs;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
struct ExpectedFile {
    findings: Vec<serde_json::Value>,
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

fn load_expected(name: &str) -> Vec<serde_json::Value> {
    let path = fixture_dir(name).join("expected.json");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    let parsed: ExpectedFile =
        serde_json::from_str(&raw).unwrap_or_else(|err| panic!("parse {}: {err}", path.display()));
    parsed.findings
}

#[tokio::test]
async fn example_fixture_drives_noop_detector() {
    let events = load_input("example");
    let expected = load_expected("example");

    let input = SessionAnalysisInput::builder(ProjectId::new())
        .events(events)
        .build();
    let cfg = DetectorConfig::default();
    let detector = NoopDetector;

    #[cfg(feature = "local-ops")]
    let findings: Vec<Finding> = detector
        .analyze(&input, &cfg, None)
        .await
        .expect("detector ran");
    #[cfg(not(feature = "local-ops"))]
    let findings: Vec<Finding> = detector.analyze(&input, &cfg).await.expect("detector ran");

    assert_eq!(
        findings.len(),
        expected.len(),
        "noop should emit exactly the expected count of findings"
    );
}
