//! Fixture-driven tests for the `multi_step_tool_sequence` detector.
//!
//! Three fixtures cover the trigger and the two negative edges from the
//! roadmap spec ("3+ identical sequences across 3+ sessions"):
//!
//! - `multi_step_tool_sequence/` — 3 sessions, each containing the same
//!   `(Read, Edit, Bash)` tool-use sequence. Expects exactly one Finding.
//! - `multi_step_tool_sequence_distinct/` — 3 sessions, each with a
//!   different 3-tool sequence. No tuple repeats; no Finding.
//! - `multi_step_tool_sequence_under_threshold/` — 3 sessions; the same
//!   tuple appears in only 2 of them. Below the 3-session bar; no
//!   Finding.
//!
//! The fixture config (`fixture_config()`) pins `min_occurrences = 3` /
//! `min_sessions = 3` so the three fixtures land exactly on the
//! thresholds the roadmap describes. Production wiring uses
//! [`SKILL_DEFAULTS`](designer_learn::defaults::SKILL_DEFAULTS) (4/3),
//! so a regression that lowers the production floor will surface in the
//! detector's unit tests rather than here.
//!
//! The on-disk JSONL files are canonical. The `fixture_data` module
//! below holds the same events programmatically, and the loader test
//! cross-checks parity so the disk fixtures can't silently drift from
//! the test inputs. Regenerate with:
//!
//! ```sh
//! cargo test -p designer-learn --test multi_step_tool_sequence -- \
//!     --ignored regenerate_fixtures
//! ```

use std::fs;
use std::path::PathBuf;

use designer_core::{
    author_roles, Actor, ArtifactId, ArtifactKind, EventEnvelope, EventId, EventPayload,
    PayloadRef, ProjectId, Severity, StreamId, Timestamp, WorkspaceId,
};
use designer_learn::{
    detectors::multi_step_tool_sequence::MultiStepToolSequenceDetector, Detector, DetectorConfig,
    SessionAnalysisInput,
};
use time::Duration;
use uuid::Uuid;

mod fixture_data {
    use super::*;

    pub const PROJECT_UUID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_0011);
    pub const WORKSPACE_UUID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_0012);

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

    fn artifact_id(seq: u64) -> ArtifactId {
        ArtifactId::from_uuid(Uuid::from_u128(
            0x3000_0000_0000_0000_0000_0000_0000_0000 | seq as u128,
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

    pub fn user_message(seq: u64, body: &str) -> EventEnvelope {
        envelope(
            seq,
            EventPayload::MessagePosted {
                workspace_id: workspace_id(),
                author: Actor::user(),
                body: body.into(),
                tab_id: None,
            },
        )
    }

    pub fn tool_artifact(seq: u64, title: &str) -> EventEnvelope {
        envelope(
            seq,
            EventPayload::ArtifactCreated {
                artifact_id: artifact_id(seq),
                workspace_id: workspace_id(),
                artifact_kind: ArtifactKind::Report,
                title: title.into(),
                summary: String::new(),
                payload: PayloadRef::inline(""),
                author_role: Some(author_roles::AGENT.into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
    }

    /// Three sessions, each containing the same `(Read, Edit, Bash)`
    /// tool-use sequence. Total: 3 occurrences across 3 distinct
    /// sessions — exactly on the 3/3 trigger threshold.
    pub fn trigger_events() -> Vec<EventEnvelope> {
        let mut v = Vec::new();
        let mut seq = 0u64;
        for i in 0..3 {
            seq += 1;
            v.push(user_message(seq, &format!("session {i}: please refactor")));
            for title in ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"] {
                seq += 1;
                v.push(tool_artifact(seq, title));
            }
        }
        v
    }

    /// Three sessions, each with a *different* 3-tool sequence. No
    /// tuple identity repeats; no finding should fire.
    pub fn distinct_events() -> Vec<EventEnvelope> {
        let mut v = Vec::new();
        let mut seq = 0u64;
        let tuples = [
            ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"],
            ["Wrote x.txt", "Read y.txt", "Edited z.rs"],
            ["Searched files", "Used WebFetch", "Read result.md"],
        ];
        for (i, tuple) in tuples.iter().enumerate() {
            seq += 1;
            v.push(user_message(seq, &format!("session {i}: please refactor")));
            for title in tuple {
                seq += 1;
                v.push(tool_artifact(seq, title));
            }
        }
        v
    }

    /// Three sessions, but the recurring `(Read, Edit, Bash)` tuple
    /// appears in only 2 of them. Session 2 runs an unrelated sequence.
    /// Below the 3-session bar; no finding.
    pub fn under_threshold_events() -> Vec<EventEnvelope> {
        let mut v = Vec::new();
        let mut seq = 0u64;
        for i in 0..2 {
            seq += 1;
            v.push(user_message(seq, &format!("session {i}: please refactor")));
            for title in ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"] {
                seq += 1;
                v.push(tool_artifact(seq, title));
            }
        }
        seq += 1;
        v.push(user_message(seq, "session 2: unrelated"));
        for title in ["Wrote notes.md", "Read other.md", "Used WebSearch"] {
            seq += 1;
            v.push(tool_artifact(seq, title));
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

/// Test config that matches the roadmap's "3+ sequences across 3+
/// sessions" wording exactly. Production uses `SKILL_DEFAULTS` (4/3);
/// the fixture set is intentionally pinned to the roadmap floor so a
/// regression that *raises* the floor surfaces in the unit tests, not
/// here.
fn fixture_config() -> DetectorConfig {
    DetectorConfig {
        min_occurrences: 3,
        min_sessions: 3,
        ..DetectorConfig::default()
    }
}

async fn run_detector(input: &SessionAnalysisInput) -> Vec<designer_core::Finding> {
    let detector = MultiStepToolSequenceDetector;
    let cfg = fixture_config();
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
    let (findings, _) =
        run_fixture("multi_step_tool_sequence", fixture_data::trigger_events()).await;
    assert_eq!(findings.len(), 1);

    let f = &findings[0];
    assert_eq!(f.detector_name, "multi_step_tool_sequence");
    assert_eq!(f.detector_version, 1);
    assert_eq!(f.severity, Severity::Notice);
    assert!(
        f.summary.contains("Read"),
        "summary missing Read: {}",
        f.summary
    );
    assert!(
        f.summary.contains("Edit"),
        "summary missing Edit: {}",
        f.summary
    );
    assert!(
        f.summary.contains("Bash"),
        "summary missing Bash: {}",
        f.summary
    );
    assert!(
        f.summary.contains("3 sessions"),
        "summary missing session count: {}",
        f.summary
    );
    assert!(
        !f.summary.to_lowercase().contains(" you "),
        "summary uses second-person voice: {}",
        f.summary
    );
    assert!(
        f.summary.chars().count() <= 100,
        "summary {} chars > 100",
        f.summary.chars().count()
    );
    assert!((0.5..=0.9).contains(&f.confidence));
    // Three MessageSpan + three ToolCall anchors.
    assert_eq!(f.evidence.len(), 6);
    assert!(f.suggested_action.is_none());
}

#[tokio::test]
async fn distinct_fixture_does_not_fire() {
    let (findings, expected) = run_fixture(
        "multi_step_tool_sequence_distinct",
        fixture_data::distinct_events(),
    )
    .await;
    assert_eq!(expected, 0);
    assert!(findings.is_empty());
}

#[tokio::test]
async fn under_threshold_fixture_does_not_fire() {
    let (findings, expected) = run_fixture(
        "multi_step_tool_sequence_under_threshold",
        fixture_data::under_threshold_events(),
    )
    .await;
    assert_eq!(expected, 0);
    assert!(findings.is_empty());
}

/// Writes the canonical JSONL + expected.json files for the three
/// fixtures from `fixture_data`. Run with
/// `cargo test -p designer-learn --test multi_step_tool_sequence -- \
///   --ignored regenerate_fixtures` whenever the envelope shape changes.
#[tokio::test]
#[ignore = "writes fixture files; regenerate manually and commit"]
async fn regenerate_fixtures() {
    write_fixture("multi_step_tool_sequence", fixture_data::trigger_events()).await;
    write_fixture(
        "multi_step_tool_sequence_distinct",
        fixture_data::distinct_events(),
    )
    .await;
    write_fixture(
        "multi_step_tool_sequence_under_threshold",
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
/// Finding's serde-value form. Matches the cost_hot_streak fixture
/// pattern.
fn stable_finding_view(f: &designer_core::Finding) -> serde_json::Value {
    let mut v = serde_json::to_value(f).expect("serialize finding");
    if let Some(obj) = v.as_object_mut() {
        for k in ["id", "timestamp", "window_digest"] {
            obj.remove(k);
        }
    }
    v
}
