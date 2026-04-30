//! Fixture tests for the `repeated_correction` detector.
//!
//! ## Layout
//!
//! - `tests/fixtures/repeated_correction/input.jsonl` — canonical event
//!   stream that should trigger one finding (3 user corrections of the
//!   same phrasing across 2 workspaces).
//! - `tests/fixtures/repeated_correction/expected.json` — the finding(s)
//!   the detector emits, captured via `serde_json::to_value(&findings)`.
//! - `tests/fixtures/repeated_correction_negative/input.jsonl` — same
//!   shape but below threshold (only 2 occurrences, single workspace).
//!   Expected output: `findings: []`.
//!
//! ## Regenerating fixtures
//!
//! The `regenerate_*` tests are `#[ignore]`-marked. Run them explicitly
//! to refresh the on-disk JSON when the detector's output shape moves:
//!
//! ```sh
//! cargo test -p designer-learn --test repeated_correction \
//!     -- --ignored --include-ignored regenerate
//! ```
//!
//! Detector-stable fields are asserted; volatile ones (`id`, `timestamp`)
//! are not — see the per-test assertions for the contract.

use designer_core::{
    Actor, EventEnvelope, EventId, EventPayload, Finding, ProjectId, StreamId, Timestamp,
    WorkspaceId,
};
use designer_learn::{
    defaults::RULE_DEFAULTS, Detector, RepeatedCorrectionDetector, SessionAnalysisInput,
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

fn user_msg(seq: u64, ws: WorkspaceId, body: &str) -> EventEnvelope {
    EventEnvelope {
        id: EventId::new(),
        stream: StreamId::Workspace(ws),
        sequence: seq,
        timestamp: Timestamp::UNIX_EPOCH,
        actor: Actor::user(),
        version: 1,
        causation_id: None,
        correlation_id: None,
        payload: EventPayload::MessagePosted {
            workspace_id: ws,
            author: Actor::user(),
            body: body.into(),
        },
    }
}

/// Canonical positive trigger: three "don't use moment.js" corrections
/// across two workspaces. Same phrasing, three occurrences, two
/// sessions — both threshold gates clear.
fn build_positive_events() -> Vec<EventEnvelope> {
    let ws_a = WorkspaceId::new();
    let ws_b = WorkspaceId::new();
    vec![
        user_msg(1, ws_a, "Don't use moment.js — pick date-fns instead."),
        user_msg(
            2,
            ws_a,
            "Again: don't use moment.js, that bundles 70KB into the client.",
        ),
        user_msg(3, ws_b, "don't use moment.js anywhere in this repo."),
    ]
}

/// Negative variant: only two occurrences, both in one workspace. Should
/// emit no findings — fails on `min_occurrences` AND `min_sessions`.
fn build_negative_events() -> Vec<EventEnvelope> {
    let ws = WorkspaceId::new();
    vec![
        user_msg(1, ws, "Don't use moment.js — pick date-fns instead."),
        user_msg(
            2,
            ws,
            "Again: don't use moment.js, that bundles 70KB into the client.",
        ),
    ]
}

async fn run_detector(events: Vec<EventEnvelope>) -> Vec<Finding> {
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .events(events)
        .build();
    let cfg = RULE_DEFAULTS;
    let detector = RepeatedCorrectionDetector;

    #[cfg(feature = "local-ops")]
    let findings = detector.analyze(&input, &cfg, None).await.unwrap();
    #[cfg(not(feature = "local-ops"))]
    let findings = detector.analyze(&input, &cfg).await.unwrap();
    findings
}

fn write_fixture(name: &str, events: &[EventEnvelope], findings: &[Finding]) {
    let dir = fixture_dir(name);
    fs::create_dir_all(&dir).expect("mkdir fixture");

    let mut input = String::new();
    for env in events {
        input.push_str(&serde_json::to_string(env).expect("encode envelope"));
        input.push('\n');
    }
    fs::write(dir.join("input.jsonl"), input).expect("write input.jsonl");

    let expected = serde_json::json!({
        "findings": serde_json::to_value(findings).expect("encode findings"),
    });
    fs::write(
        dir.join("expected.json"),
        serde_json::to_string_pretty(&expected).expect("encode expected"),
    )
    .expect("write expected.json");
}

#[tokio::test]
async fn repeated_correction_fixture_emits_one_finding() {
    let events = load_input("repeated_correction");
    let expected = load_expected("repeated_correction");

    let findings = run_detector(events).await;

    assert_eq!(
        findings.len(),
        expected.len(),
        "detector should emit the same count as the fixture"
    );
    assert_eq!(findings.len(), 1);
    let f = &findings[0];
    assert_eq!(f.detector_name, RepeatedCorrectionDetector::NAME);
    assert_eq!(f.detector_version, RepeatedCorrectionDetector::VERSION);
    assert_eq!(
        f.severity,
        designer_core::Severity::Notice,
        "default A2 severity is Notice"
    );
    assert!(f.summary.starts_with("Same correction phrasing"));
    assert!(
        (0.5..=0.95).contains(&f.confidence),
        "confidence outside [0.5, 0.95]: {}",
        f.confidence
    );
    assert_eq!(f.evidence.len(), 3, "every occurrence is anchored");
    assert!(
        f.suggested_action.is_none(),
        "Phase A leaves suggested_action None"
    );

    // Sanity check the fixture's expected payload — the detector_name on
    // the persisted JSON must match what the live detector emits.
    let exp = &expected[0];
    assert_eq!(
        exp.get("detector_name").and_then(|v| v.as_str()),
        Some(RepeatedCorrectionDetector::NAME)
    );
    assert_eq!(exp.get("severity").and_then(|v| v.as_str()), Some("notice"));
}

#[tokio::test]
async fn repeated_correction_negative_fixture_emits_nothing() {
    let events = load_input("repeated_correction_negative");
    let expected = load_expected("repeated_correction_negative");

    let findings = run_detector(events).await;

    assert!(
        expected.is_empty(),
        "negative fixture should declare zero findings"
    );
    assert!(
        findings.is_empty(),
        "below-threshold input must not trigger the detector"
    );
}

/// Regeneration helpers. `#[ignore]`-marked so `cargo test` is a pure
/// read of the on-disk fixtures by default; pass
/// `-- --ignored --include-ignored regenerate` to refresh after a
/// detector output-shape change.
#[tokio::test]
#[ignore = "fixture regenerator — run explicitly via --ignored"]
async fn regenerate_positive_fixture() {
    let events = build_positive_events();
    let findings = run_detector(events.clone()).await;
    assert_eq!(findings.len(), 1, "regenerator expects one finding");
    write_fixture("repeated_correction", &events, &findings);
}

#[tokio::test]
#[ignore = "fixture regenerator — run explicitly via --ignored"]
async fn regenerate_negative_fixture() {
    let events = build_negative_events();
    let findings = run_detector(events.clone()).await;
    assert!(findings.is_empty(), "regenerator expects no findings");
    write_fixture("repeated_correction_negative", &events, &findings);
}
