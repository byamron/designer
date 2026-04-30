//! Fixture-driven tests for the `compaction_pressure` detector.
//!
//! Two fixtures cover the trigger and the most important negative edge:
//!
//! - `compaction_pressure/` — three Designer sessions in the trailing
//!   week, each containing one `/compact` message. Expects exactly one
//!   `Finding`.
//! - `compaction_pressure_under_threshold/` — only two sessions with
//!   `/compact`. Expects zero findings.
//!
//! The on-disk JSONL files are canonical. The `fixture_data` module
//! holds the same events programmatically and the loader test
//! cross-checks parity so the disk fixtures can't silently drift from
//! the test inputs. Regenerate with:
//!
//! ```sh
//! cargo test -p designer-learn --test compaction_pressure -- \
//!     --ignored regenerate_fixtures
//! ```
//!
//! The roadmap line driving this detector is
//! `core-docs/roadmap.md` L1476: *`/compact` invoked ≥1×/session
//! consistently. Threshold: 3+ sessions in a week.*

use designer_core::{
    Actor, EventEnvelope, EventId, EventPayload, ProjectId, Severity, StreamId, Timestamp,
    WorkspaceId,
};
use designer_learn::{
    defaults::COMPACTION_PRESSURE_DEFAULTS, detectors::CompactionPressureDetector, Detector,
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
            0x2000_0000_0000_0000_0000_0000_0000_0000 | seq as u128,
        ))
    }

    /// Anchor every fixture timestamp on a stable date well inside
    /// `time` crate's supported range. Days-from-base spread the events
    /// so the 60-minute idle gap forces session boundaries.
    pub fn base_ts() -> Timestamp {
        Timestamp::UNIX_EPOCH + Duration::days(30)
    }

    fn envelope(seq: u64, ts: Timestamp, payload: EventPayload) -> EventEnvelope {
        EventEnvelope {
            id: event_id(seq),
            stream: StreamId::Workspace(workspace_id()),
            sequence: seq,
            timestamp: ts,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    pub fn message(seq: u64, ts: Timestamp, body: &str) -> EventEnvelope {
        envelope(
            seq,
            ts,
            EventPayload::MessagePosted {
                workspace_id: workspace_id(),
                author: Actor::user(),
                body: body.to_string(),
            },
        )
    }

    /// Three sessions, one day apart, each with a single `/compact`
    /// message. The 24-hour gap between sessions trips the 60-minute
    /// idle-window heuristic; all three fall inside the trailing-7-day
    /// window anchored on the most-recent event.
    pub fn trigger_events() -> Vec<EventEnvelope> {
        let day = Duration::days(1);
        let base = base_ts();
        vec![
            message(1, base, "/compact"),
            message(2, base + day, "/compact please"),
            message(3, base + day * 2, "/compact"),
        ]
    }

    /// Two sessions with `/compact`, below the 3-session threshold.
    pub fn under_threshold_events() -> Vec<EventEnvelope> {
        let day = Duration::days(1);
        let base = base_ts();
        vec![
            message(1, base, "/compact"),
            message(2, base + day, "/compact please"),
        ]
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

fn build_input(events: Vec<EventEnvelope>) -> SessionAnalysisInput {
    SessionAnalysisInput::builder(fixture_data::project_id())
        .workspace(fixture_data::workspace_id())
        .events(events)
        .build()
}

async fn run_detector(input: &SessionAnalysisInput) -> Vec<designer_core::Finding> {
    let detector = CompactionPressureDetector;
    let cfg = COMPACTION_PRESSURE_DEFAULTS;
    #[cfg(feature = "local-ops")]
    let findings = detector.analyze(input, &cfg, None).await.expect("detector");
    #[cfg(not(feature = "local-ops"))]
    let findings = detector.analyze(input, &cfg).await.expect("detector");
    findings
}

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
    let (findings, _) = run_fixture("compaction_pressure", fixture_data::trigger_events()).await;
    assert_eq!(findings.len(), 1);
    let f = &findings[0];
    assert_eq!(f.detector_name, "compaction_pressure");
    assert_eq!(f.detector_version, 1);
    assert_eq!(f.severity, Severity::Notice);
    assert!(
        f.summary.starts_with("/compact invoked across 3 sessions"),
        "evidence summary should be clinical/passive: {}",
        f.summary,
    );
    assert!(
        f.summary.chars().count() <= 100,
        "summary {} chars > 100",
        f.summary.chars().count()
    );
    let lower = f.summary.to_lowercase();
    assert!(
        !lower.starts_with("you ") && !lower.contains(" you "),
        "summary uses second-person: {}",
        f.summary
    );
    assert_eq!(f.evidence.len(), 3);
    for anchor in &f.evidence {
        match anchor {
            designer_core::Anchor::MessageSpan { quote, .. } => {
                assert!(
                    quote.starts_with("/compact"),
                    "anchor quote should pin the slash command: {quote}"
                );
            }
            other => panic!("expected MessageSpan, got {other:?}"),
        }
    }
    assert!((0.55..=0.85).contains(&f.confidence));
}

#[tokio::test]
async fn under_threshold_fixture_does_not_fire() {
    let (findings, expected) = run_fixture(
        "compaction_pressure_under_threshold",
        fixture_data::under_threshold_events(),
    )
    .await;
    assert_eq!(expected, 0);
    assert!(findings.is_empty());
}

/// Writes the canonical JSONL + expected.json files for the two
/// fixtures from `fixture_data`. Run with
/// `cargo test -p designer-learn --test compaction_pressure -- \
///   --ignored regenerate_fixtures` whenever the envelope shape changes.
#[tokio::test]
#[ignore = "writes fixture files; regenerate manually and commit"]
async fn regenerate_fixtures() {
    write_fixture("compaction_pressure", fixture_data::trigger_events()).await;
    write_fixture(
        "compaction_pressure_under_threshold",
        fixture_data::under_threshold_events(),
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
