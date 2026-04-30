//! Fixture tests for the `repeated_prompt_opening` detector.
//!
//! ## Layout
//!
//! - `tests/fixtures/repeated_prompt_opening/input.jsonl` — canonical
//!   positive: 4 sessions, each opening with a paraphrase of the same
//!   intent (>0.5 Jaccard).
//! - `tests/fixtures/repeated_prompt_opening/expected.json` — the
//!   finding(s) the detector emits, captured via
//!   `serde_json::to_value(&findings)`.
//! - `tests/fixtures/repeated_prompt_opening_negative_similarity/` —
//!   4 sessions with distinct openers (<0.5 Jaccard). Expected: no
//!   findings.
//! - `tests/fixtures/repeated_prompt_opening_negative_count/` — 3
//!   sessions whose openers do match by Jaccard, but the count is below
//!   `min_occurrences`. Expected: no findings.
//!
//! ## Regenerating fixtures
//!
//! The `regenerate_*` tests are `#[ignore]`-marked. Run them explicitly
//! to refresh the on-disk JSON when the detector's output shape moves:
//!
//! ```sh
//! cargo test -p designer-learn --test repeated_prompt_opening \
//!     -- --ignored --include-ignored regenerate
//! ```

use designer_core::{
    Actor, EventEnvelope, EventId, EventPayload, Finding, ProjectId, StreamId, Timestamp,
    WorkspaceId,
};
use designer_learn::{
    defaults::SKILL_DEFAULTS, Detector, RepeatedPromptOpeningDetector, SessionAnalysisInput,
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

/// Canonical positive trigger: four sessions, each opening with a
/// paraphrase of "review the recent pull request diff." Token-set
/// Jaccard between any two openers is ≥0.5.
fn build_positive_events() -> Vec<EventEnvelope> {
    let workspaces: Vec<WorkspaceId> = (0..4).map(|_| WorkspaceId::new()).collect();
    let openers = [
        "review the diff for the recent pull request",
        "please review the diff for this pull request",
        "review the recent pull request diff",
        "look at the pull request diff and review it",
    ];
    workspaces
        .into_iter()
        .zip(openers.iter())
        .enumerate()
        .map(|(i, (ws, body))| user_msg(i as u64 + 1, ws, body))
        .collect()
}

/// Negative variant — under-threshold Jaccard. Four sessions, four
/// distinct openers; no pair clusters above 0.5.
fn build_negative_similarity_events() -> Vec<EventEnvelope> {
    let workspaces: Vec<WorkspaceId> = (0..4).map(|_| WorkspaceId::new()).collect();
    let openers = [
        "review the diff for the recent pull request",
        "explain how event sourcing handles compaction",
        "draft a plan for migrating away from moment.js",
        "build a Tauri command that exposes detector findings",
    ];
    workspaces
        .into_iter()
        .zip(openers.iter())
        .enumerate()
        .map(|(i, (ws, body))| user_msg(i as u64 + 1, ws, body))
        .collect()
}

/// Negative variant — under-threshold count. Three matching openers
/// (>0.5 Jaccard) is one short of `min_occurrences=4`.
fn build_negative_count_events() -> Vec<EventEnvelope> {
    let workspaces: Vec<WorkspaceId> = (0..3).map(|_| WorkspaceId::new()).collect();
    let openers = [
        "review the diff for the recent pull request",
        "please review the diff for this pull request",
        "review the recent pull request diff",
    ];
    workspaces
        .into_iter()
        .zip(openers.iter())
        .enumerate()
        .map(|(i, (ws, body))| user_msg(i as u64 + 1, ws, body))
        .collect()
}

async fn run_detector(events: Vec<EventEnvelope>) -> Vec<Finding> {
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .events(events)
        .build();
    let cfg = SKILL_DEFAULTS;
    let detector = RepeatedPromptOpeningDetector;

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
async fn repeated_prompt_opening_fixture_emits_one_finding() {
    let events = load_input("repeated_prompt_opening");
    let expected = load_expected("repeated_prompt_opening");

    let findings = run_detector(events).await;

    assert_eq!(
        findings.len(),
        expected.len(),
        "detector should emit the same count as the fixture"
    );
    assert_eq!(findings.len(), 1);
    let f = &findings[0];
    assert_eq!(f.detector_name, RepeatedPromptOpeningDetector::NAME);
    assert_eq!(f.detector_version, RepeatedPromptOpeningDetector::VERSION);
    assert_eq!(
        f.severity,
        designer_core::Severity::Notice,
        "default A2 severity is Notice"
    );
    assert!(f.summary.starts_with("Similar opening prompt"));
    assert!(
        (0.5..=0.95).contains(&f.confidence),
        "confidence outside [0.5, 0.95]: {}",
        f.confidence
    );
    assert_eq!(f.evidence.len(), 4, "every opener is anchored");
    assert!(
        f.suggested_action.is_none(),
        "Phase A leaves suggested_action None"
    );

    let exp = &expected[0];
    assert_eq!(
        exp.get("detector_name").and_then(|v| v.as_str()),
        Some(RepeatedPromptOpeningDetector::NAME)
    );
    assert_eq!(exp.get("severity").and_then(|v| v.as_str()), Some("notice"));
}

#[tokio::test]
async fn repeated_prompt_opening_negative_similarity_emits_nothing() {
    let events = load_input("repeated_prompt_opening_negative_similarity");
    let expected = load_expected("repeated_prompt_opening_negative_similarity");

    let findings = run_detector(events).await;

    assert!(
        expected.is_empty(),
        "negative-similarity fixture should declare zero findings"
    );
    assert!(
        findings.is_empty(),
        "openers below the Jaccard floor must not trigger"
    );
}

#[tokio::test]
async fn repeated_prompt_opening_negative_count_emits_nothing() {
    let events = load_input("repeated_prompt_opening_negative_count");
    let expected = load_expected("repeated_prompt_opening_negative_count");

    let findings = run_detector(events).await;

    assert!(
        expected.is_empty(),
        "negative-count fixture should declare zero findings"
    );
    assert!(
        findings.is_empty(),
        "three matching openers (< min_occurrences=4) must not trigger"
    );
}

/// Regeneration helpers. `#[ignore]`-marked so `cargo test` is a pure
/// read of the on-disk fixtures by default.
#[tokio::test]
#[ignore = "fixture regenerator — run explicitly via --ignored"]
async fn regenerate_positive_fixture() {
    let events = build_positive_events();
    let findings = run_detector(events.clone()).await;
    assert_eq!(findings.len(), 1, "regenerator expects one finding");
    write_fixture("repeated_prompt_opening", &events, &findings);
}

#[tokio::test]
#[ignore = "fixture regenerator — run explicitly via --ignored"]
async fn regenerate_negative_similarity_fixture() {
    let events = build_negative_similarity_events();
    let findings = run_detector(events.clone()).await;
    assert!(findings.is_empty(), "regenerator expects no findings");
    write_fixture(
        "repeated_prompt_opening_negative_similarity",
        &events,
        &findings,
    );
}

#[tokio::test]
#[ignore = "fixture regenerator — run explicitly via --ignored"]
async fn regenerate_negative_count_fixture() {
    let events = build_negative_count_events();
    let findings = run_detector(events.clone()).await;
    assert!(findings.is_empty(), "regenerator expects no findings");
    write_fixture("repeated_prompt_opening_negative_count", &events, &findings);
}
