//! Fixture-driven tests for the `approval_always_granted` detector.
//!
//! Three fixtures live under `tests/fixtures/approval_always_granted{,_under_threshold,_with_denial}`:
//!
//! - **Positive trigger.** 6 grants of the same `(Bash, prettier *)`
//!   class, no denials → exactly one finding with `detector_name =
//!   "approval_always_granted"`.
//! - **Under threshold.** 4 grants of the same `(Write, src/)` class →
//!   no finding (threshold is 5).
//! - **Mixed denial.** 5 grants of the same `(Write, src/)` class plus
//!   one denial of the same class → no finding (zero-denial is the
//!   detector's gating rule).
//!
//! Fixture inputs are real `serde_json::to_string(&envelope)` output
//! captured by `examples/build_approval_always_granted_fixtures.rs`; if
//! the `EventEnvelope` shape drifts, the fixtures fail to deserialize
//! and the example regenerates them with the new shape.
//!
//! `expected.json` carries detector-stable assertions (`detector_name`,
//! `severity`, evidence-count bounds, summary substrings) — not the
//! full Finding shape, since `id` and `timestamp` are volatile.

use std::fs;
use std::path::PathBuf;

use designer_core::{EventEnvelope, Finding, ProjectId};
use designer_learn::{
    defaults::APPROVAL_ALWAYS_GRANTED_DEFAULTS, detectors::ApprovalAlwaysGrantedDetector, Detector,
    SessionAnalysisInput,
};

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

fn load_expected(name: &str) -> serde_json::Value {
    let path = fixture_dir(name).join("expected.json");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|err| panic!("parse {}: {err}", path.display()))
}

async fn run_detector(events: Vec<EventEnvelope>) -> Vec<Finding> {
    let detector = ApprovalAlwaysGrantedDetector;
    let cfg = APPROVAL_ALWAYS_GRANTED_DEFAULTS;
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .events(events)
        .build();
    #[cfg(feature = "local-ops")]
    {
        detector
            .analyze(&input, &cfg, None)
            .await
            .expect("detector ran")
    }
    #[cfg(not(feature = "local-ops"))]
    {
        detector.analyze(&input, &cfg).await.expect("detector ran")
    }
}

fn assert_expected(findings: &[Finding], expected: &serde_json::Value) {
    let expected_findings = expected
        .get("findings")
        .and_then(|v| v.as_array())
        .expect("expected.findings array");

    assert_eq!(
        findings.len(),
        expected_findings.len(),
        "finding count mismatch: got {findings:?}",
    );

    for (got, want) in findings.iter().zip(expected_findings.iter()) {
        if let Some(name) = want.get("detector_name").and_then(|v| v.as_str()) {
            assert_eq!(got.detector_name, name);
        }
        if let Some(version) = want.get("detector_version").and_then(|v| v.as_u64()) {
            assert_eq!(got.detector_version as u64, version);
        }
        if let Some(severity) = want.get("severity").and_then(|v| v.as_str()) {
            let got_severity = serde_json::to_string(&got.severity).expect("severity serializes");
            // `to_string` wraps in quotes (`"notice"`); strip them.
            assert_eq!(got_severity.trim_matches('"'), severity);
        }
        if let Some(needles) = want.get("summary_contains").and_then(|v| v.as_array()) {
            for needle in needles {
                let needle = needle.as_str().expect("summary_contains entry is a string");
                assert!(
                    got.summary.contains(needle),
                    "summary `{}` missing `{}`",
                    got.summary,
                    needle,
                );
            }
        }
        if let Some(forbid) = want.get("summary_forbids").and_then(|v| v.as_array()) {
            for needle in forbid {
                let needle = needle.as_str().expect("summary_forbids entry is a string");
                assert!(
                    !got.summary.contains(needle),
                    "summary `{}` should not contain `{}`",
                    got.summary,
                    needle,
                );
            }
        }
        if let Some(count) = want.get("evidence_count").and_then(|v| v.as_u64()) {
            assert_eq!(got.evidence.len() as u64, count);
        }
        if let Some(min) = want.get("confidence_min").and_then(|v| v.as_f64()) {
            assert!(
                (got.confidence as f64) >= min - 1e-6,
                "confidence {} below min {}",
                got.confidence,
                min,
            );
        }
        if let Some(max) = want.get("confidence_max").and_then(|v| v.as_f64()) {
            assert!(
                (got.confidence as f64) <= max + 1e-6,
                "confidence {} above max {}",
                got.confidence,
                max,
            );
        }
        // Phase A leaves `suggested_action` empty — the detector contract
        // forbids encoding the proposal kind here.
        assert!(
            got.suggested_action.is_none(),
            "Phase A detectors must not populate suggested_action",
        );
    }
}

#[tokio::test]
async fn positive_fixture_emits_one_finding_with_clinical_summary() {
    let events = load_input("approval_always_granted");
    let expected = load_expected("approval_always_granted");
    let findings = run_detector(events).await;
    assert_expected(&findings, &expected);

    // The 21.A1.2 surface contract requires clinical/passive summaries.
    // Spot-check that no second-person address slipped through.
    for f in &findings {
        let lower = f.summary.to_ascii_lowercase();
        assert!(
            !lower.contains(" you ") && !lower.starts_with("you "),
            "summary uses second-person voice: {}",
            f.summary
        );
        assert!(
            f.summary.chars().count() <= 100,
            "summary exceeds 100 chars: {}",
            f.summary
        );
    }
}

#[tokio::test]
async fn under_threshold_fixture_emits_no_findings() {
    let events = load_input("approval_always_granted_under_threshold");
    let expected = load_expected("approval_always_granted_under_threshold");
    let findings = run_detector(events).await;
    assert_expected(&findings, &expected);
}

#[tokio::test]
async fn mixed_denial_fixture_emits_no_findings() {
    let events = load_input("approval_always_granted_with_denial");
    let expected = load_expected("approval_always_granted_with_denial");
    let findings = run_detector(events).await;
    assert_expected(&findings, &expected);
}
