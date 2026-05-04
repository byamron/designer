//! Fixture-driven tests for the `cost_hot_streak` detector.
//!
//! Three fixtures cover the trigger and the two negative edges:
//!
//! - `cost_hot_streak/` — 10 baseline `CostRecorded` events on class
//!   `long:low` at 100¢ each, then a 250¢ spike on the same class.
//!   Expects exactly one Finding.
//! - `cost_hot_streak_one_off/` — same baseline, but the spike fires on
//!   a class that has never appeared in the window. Expects zero
//!   Findings (could just be a hard problem; not a hot streak).
//! - `cost_hot_streak_even_spend/` — 12 events varying across classes,
//!   all ~100¢, no spike. Expects zero Findings.
//!
//! The on-disk JSONL files are canonical. The `fixture_data` module
//! below holds the same events programmatically, and the loader test
//! cross-checks parity so the disk fixtures can't silently drift from
//! the test inputs. Regenerate with:
//!
//! ```sh
//! cargo test -p designer-learn --test cost_hot_streak -- \
//!     --ignored regenerate_fixtures
//! ```

use designer_core::{
    Actor, EventEnvelope, EventId, EventPayload, ProjectId, Severity, StreamId, Timestamp,
    WorkspaceId,
};
use designer_learn::{
    detectors::cost_hot_streak::CostHotStreakDetector, Detector, DetectorConfig,
    SessionAnalysisInput,
};
use std::fs;
use std::path::PathBuf;
use time::Duration;
use uuid::Uuid;

mod fixture_data {
    use super::*;

    pub const PROJECT_UUID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_0001);
    pub const WORKSPACE_UUID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_0002);

    pub fn project_id() -> ProjectId {
        ProjectId::from_uuid(PROJECT_UUID)
    }

    pub fn workspace_id() -> WorkspaceId {
        WorkspaceId::from_uuid(WORKSPACE_UUID)
    }

    fn event_id(seq: u64) -> EventId {
        EventId::from_uuid(Uuid::from_u128(
            0x1000_0000_0000_0000_0000_0000_0000_0000 | seq as u128,
        ))
    }

    fn timestamp(seq: u64) -> Timestamp {
        Timestamp::UNIX_EPOCH + Duration::seconds(seq as i64)
    }

    fn envelope(seq: u64, payload: EventPayload) -> EventEnvelope {
        EventEnvelope {
            id: event_id(seq),
            stream: StreamId::Workspace(workspace_id()),
            sequence: seq,
            timestamp: timestamp(seq),
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    pub fn message(seq: u64, body_len: usize) -> EventEnvelope {
        envelope(
            seq,
            EventPayload::MessagePosted {
                workspace_id: workspace_id(),
                author: Actor::user(),
                body: "x".repeat(body_len),
                tab_id: None,
            },
        )
    }

    pub fn cost(seq: u64, cents: u64) -> EventEnvelope {
        envelope(
            seq,
            EventPayload::CostRecorded {
                workspace_id: workspace_id(),
                tokens_input: 1_000,
                tokens_output: 500,
                dollars_cents: cents,
                tab_id: None,
                turn_id: None,
            },
        )
    }

    /// 10 baseline `(message, cost)` pairs at 100¢ on class `long:low`,
    /// then a single 250¢ spike on the same class. The spike trips
    /// the 1.5× rolling-p90 threshold (ratio = 2.5×).
    pub fn trigger_events() -> Vec<EventEnvelope> {
        let mut v = Vec::new();
        let mut seq = 0u64;
        for _ in 0..10 {
            seq += 1;
            v.push(message(seq, 1_500));
            seq += 1;
            v.push(cost(seq, 100));
        }
        seq += 1;
        v.push(message(seq, 1_500));
        seq += 1;
        v.push(cost(seq, 250));
        v
    }

    /// Same baseline as `trigger_events`, then a 250¢ spike on a class
    /// that has never appeared in the window (`short:low`). Class-
    /// occurrence floor (3) gates the emission — no Finding.
    pub fn one_off_events() -> Vec<EventEnvelope> {
        let mut v = Vec::new();
        let mut seq = 0u64;
        for _ in 0..10 {
            seq += 1;
            v.push(message(seq, 1_500));
            seq += 1;
            v.push(cost(seq, 100));
        }
        seq += 1;
        v.push(message(seq, 50)); // short body — first time we see this class
        seq += 1;
        v.push(cost(seq, 250));
        v
    }

    /// 12 `(message, cost)` pairs cycling through three body-length
    /// tiers, all costs at 100¢. No outlier — the rolling p90 equals
    /// the new cost on every step.
    pub fn even_spend_events() -> Vec<EventEnvelope> {
        let mut v = Vec::new();
        let mut seq = 0u64;
        for i in 0..12 {
            let body_len = match i % 3 {
                0 => 100,   // short
                1 => 500,   // medium
                _ => 1_500, // long
            };
            seq += 1;
            v.push(message(seq, body_len));
            seq += 1;
            v.push(cost(seq, 100));
        }
        v
    }
}

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
    let raw = fs::read_to_string(&path).expect("read input.jsonl");
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| serde_json::from_str::<EventEnvelope>(line).expect("parse envelope line"))
        .collect()
}

fn load_expected(name: &str) -> Vec<serde_json::Value> {
    let path = fixture_dir(name).join("expected.json");
    let raw = fs::read_to_string(&path).expect("read expected.json");
    let parsed: ExpectedFile = serde_json::from_str(&raw).expect("parse expected.json");
    parsed.findings
}

fn build_input(events: Vec<EventEnvelope>) -> SessionAnalysisInput {
    SessionAnalysisInput::builder(fixture_data::project_id())
        .workspace(fixture_data::workspace_id())
        .events(events)
        .build()
}

async fn run_detector(input: &SessionAnalysisInput) -> Vec<designer_core::Finding> {
    let detector = CostHotStreakDetector;
    let cfg = DetectorConfig::default();
    #[cfg(feature = "local-ops")]
    let findings = detector.analyze(input, &cfg, None).await.expect("detector");
    #[cfg(not(feature = "local-ops"))]
    let findings = detector.analyze(input, &cfg).await.expect("detector");
    findings
}

/// Loads the on-disk fixture, asserts parity with the programmatic
/// builder, runs the detector, and returns the findings + the expected
/// count from `expected.json`. Each fixture test then asserts whatever
/// detector-stable fields it cares about.
async fn run_fixture(
    name: &str,
    expected_events: Vec<EventEnvelope>,
) -> (Vec<designer_core::Finding>, usize) {
    let on_disk = load_input(name);
    assert_eq!(
        on_disk, expected_events,
        "{name} fixture out of date — run with `--ignored regenerate_fixtures`"
    );
    let expected_count = load_expected(name).len();
    let input = build_input(on_disk);
    let findings = run_detector(&input).await;
    assert_eq!(
        findings.len(),
        expected_count,
        "{name}: detector emitted {} findings, expected.json has {}",
        findings.len(),
        expected_count,
    );
    (findings, expected_count)
}

#[tokio::test]
async fn trigger_fixture_emits_one_finding() {
    let (findings, _) = run_fixture("cost_hot_streak", fixture_data::trigger_events()).await;
    assert_eq!(findings.len(), 1);

    let f = &findings[0];
    assert_eq!(f.detector_name, "cost_hot_streak");
    assert_eq!(f.detector_version, 1);
    assert_eq!(f.severity, Severity::Info);
    assert!(
        f.summary
            .starts_with("Task class 'long:low' cost $2.50, 2.5"),
        "evidence summary should be clinical/passive: {}",
        f.summary,
    );
    assert!(
        f.summary.len() <= 100,
        "summary {} chars > 100",
        f.summary.len()
    );
    assert!((0.4..=0.8).contains(&f.confidence));
}

#[tokio::test]
async fn one_off_fixture_does_not_fire() {
    let (findings, expected) =
        run_fixture("cost_hot_streak_one_off", fixture_data::one_off_events()).await;
    assert_eq!(expected, 0);
    assert!(findings.is_empty());
}

#[tokio::test]
async fn even_spend_fixture_does_not_fire() {
    let (findings, expected) = run_fixture(
        "cost_hot_streak_even_spend",
        fixture_data::even_spend_events(),
    )
    .await;
    assert_eq!(expected, 0);
    assert!(findings.is_empty());
}

/// Writes the canonical JSONL + expected.json files for the three
/// fixtures from `fixture_data`. Run with
/// `cargo test -p designer-learn --test cost_hot_streak -- \
///   --ignored regenerate_fixtures` whenever the envelope shape changes.
#[tokio::test]
#[ignore = "writes fixture files; regenerate manually and commit"]
async fn regenerate_fixtures() {
    write_fixture("cost_hot_streak", fixture_data::trigger_events()).await;
    write_fixture("cost_hot_streak_one_off", fixture_data::one_off_events()).await;
    write_fixture(
        "cost_hot_streak_even_spend",
        fixture_data::even_spend_events(),
    )
    .await;
}

async fn write_fixture(name: &str, events: Vec<EventEnvelope>) {
    let dir = fixture_dir(name);
    fs::create_dir_all(&dir).expect("mkdir fixture dir");

    let mut jsonl = String::new();
    for env in &events {
        jsonl.push_str(&serde_json::to_string(env).expect("serialize envelope"));
        jsonl.push('\n');
    }
    fs::write(dir.join("input.jsonl"), jsonl).expect("write input.jsonl");

    let input = build_input(events);
    let findings = run_detector(&input).await;
    let stable: Vec<serde_json::Value> = findings.iter().map(stable_finding_view).collect();
    let body = serde_json::json!({ "findings": stable });
    fs::write(
        dir.join("expected.json"),
        serde_json::to_string_pretty(&body).expect("serialize expected"),
    )
    .expect("write expected.json");
}

/// Strips volatile fields (`id`, `timestamp`, `window_digest`) from a
/// Finding's serde-value form. Volatile fields rot between regenerations
/// — the disk fixture stays useful as documentation only when it pins
/// the stable detector-output surface.
fn stable_finding_view(f: &designer_core::Finding) -> serde_json::Value {
    let mut v = serde_json::to_value(f).expect("serialize finding");
    if let Some(obj) = v.as_object_mut() {
        for k in ["id", "timestamp", "window_digest"] {
            obj.remove(k);
        }
    }
    v
}
