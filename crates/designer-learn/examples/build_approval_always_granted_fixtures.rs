//! Generates the on-disk fixtures for the `approval_always_granted`
//! detector at `tests/fixtures/approval_always_granted{,_under_threshold,_with_denial}`.
//!
//! Run manually: `cargo run --example build_approval_always_granted_fixtures
//! -p designer-learn`. The output paths and contents are deterministic —
//! UUIDs are seeded from `Uuid::from_u128(...)` and timestamps from a
//! fixed UNIX-epoch offset so the fixture diff is reviewable.
//!
//! The detector tests load these files via `serde_json::from_str` so any
//! shape drift in `EventEnvelope`, `EventPayload`, or `Timestamp`
//! bubbles up at test time.

use std::fs;
use std::path::{Path, PathBuf};

use designer_core::{
    Actor, ApprovalId, EventEnvelope, EventId, EventPayload, ProjectId, StreamId, Timestamp,
    WorkspaceId,
};
use uuid::Uuid;

fn main() {
    let project_id =
        ProjectId::from_uuid(Uuid::from_u128(0x4141_4141_4141_4141_4141_4141_4141_4141));
    let workspace_id =
        WorkspaceId::from_uuid(Uuid::from_u128(0x5757_5757_5757_5757_5757_5757_5757_5757));

    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    write_positive_fixture(&crate_root, project_id, workspace_id);
    write_under_threshold_fixture(&crate_root, project_id, workspace_id);
    write_with_denial_fixture(&crate_root, project_id, workspace_id);
}

fn write_positive_fixture(crate_root: &Path, _project_id: ProjectId, workspace_id: WorkspaceId) {
    let dir = crate_root
        .join("tests")
        .join("fixtures")
        .join("approval_always_granted");
    fs::create_dir_all(&dir).unwrap();

    let mut events = Vec::new();
    let mut seq = 0u64;
    for i in 0..6 {
        let approval_id = approval_id_seeded(0x1000 + i);
        events.push(envelope(
            event_id_seeded(0x2000 + i * 2),
            workspace_id,
            seq,
            timestamp_at(60 * (i as i64)),
            EventPayload::ApprovalRequested {
                approval_id,
                workspace_id,
                gate: "tool:Bash".into(),
                summary: format!("prettier --write src/index_{i}.ts"),
            },
        ));
        seq += 1;
        events.push(envelope(
            event_id_seeded(0x2000 + i * 2 + 1),
            workspace_id,
            seq,
            timestamp_at(60 * (i as i64) + 1),
            EventPayload::ApprovalGranted { approval_id },
        ));
        seq += 1;
    }

    write_jsonl(&dir.join("input.jsonl"), &events);

    // Expected: one finding for the `bash:prettier *` class with 6 grants.
    let expected = serde_json::json!({
        "findings": [
            {
                "detector_name": "approval_always_granted",
                "detector_version": 1,
                "severity": "notice",
                "summary_contains": [
                    "ApprovalRequested for Bash(prettier *)",
                    "granted 6\u{00d7}",
                    "0 denials"
                ],
                "evidence_count": 5,
                "confidence_min": 0.6,
                "confidence_max": 0.95
            }
        ]
    });
    write_json(&dir.join("expected.json"), &expected);
}

fn write_under_threshold_fixture(
    crate_root: &Path,
    _project_id: ProjectId,
    workspace_id: WorkspaceId,
) {
    let dir = crate_root
        .join("tests")
        .join("fixtures")
        .join("approval_always_granted_under_threshold");
    fs::create_dir_all(&dir).unwrap();

    let mut events = Vec::new();
    let mut seq = 0u64;
    for i in 0..4 {
        let approval_id = approval_id_seeded(0x3000 + i);
        events.push(envelope(
            event_id_seeded(0x4000 + i * 2),
            workspace_id,
            seq,
            timestamp_at(60 * (i as i64)),
            EventPayload::ApprovalRequested {
                approval_id,
                workspace_id,
                gate: "tool:Write".into(),
                summary: format!("Write src/lib_{i}.rs"),
            },
        ));
        seq += 1;
        events.push(envelope(
            event_id_seeded(0x4000 + i * 2 + 1),
            workspace_id,
            seq,
            timestamp_at(60 * (i as i64) + 1),
            EventPayload::ApprovalGranted { approval_id },
        ));
        seq += 1;
    }

    write_jsonl(&dir.join("input.jsonl"), &events);
    write_json(
        &dir.join("expected.json"),
        &serde_json::json!({ "findings": [] }),
    );
}

fn write_with_denial_fixture(crate_root: &Path, _project_id: ProjectId, workspace_id: WorkspaceId) {
    let dir = crate_root
        .join("tests")
        .join("fixtures")
        .join("approval_always_granted_with_denial");
    fs::create_dir_all(&dir).unwrap();

    let mut events = Vec::new();
    let mut seq = 0u64;
    for i in 0..5 {
        let approval_id = approval_id_seeded(0x5000 + i);
        events.push(envelope(
            event_id_seeded(0x6000 + i * 2),
            workspace_id,
            seq,
            timestamp_at(60 * (i as i64)),
            EventPayload::ApprovalRequested {
                approval_id,
                workspace_id,
                gate: "tool:Write".into(),
                summary: format!("Write src/lib_{i}.rs"),
            },
        ));
        seq += 1;
        events.push(envelope(
            event_id_seeded(0x6000 + i * 2 + 1),
            workspace_id,
            seq,
            timestamp_at(60 * (i as i64) + 1),
            EventPayload::ApprovalGranted { approval_id },
        ));
        seq += 1;
    }

    // One same-class denial (the canonical class is `write:src/`, so any
    // path under `src/` lands in the same bucket as the grants above).
    let denial_id = approval_id_seeded(0x5500);
    events.push(envelope(
        event_id_seeded(0x6500),
        workspace_id,
        seq,
        timestamp_at(600),
        EventPayload::ApprovalRequested {
            approval_id: denial_id,
            workspace_id,
            gate: "tool:Write".into(),
            summary: "Write src/other.rs".into(),
        },
    ));
    seq += 1;
    events.push(envelope(
        event_id_seeded(0x6501),
        workspace_id,
        seq,
        timestamp_at(601),
        EventPayload::ApprovalDenied {
            approval_id: denial_id,
            reason: Some("not this one".into()),
        },
    ));

    write_jsonl(&dir.join("input.jsonl"), &events);
    write_json(
        &dir.join("expected.json"),
        &serde_json::json!({ "findings": [] }),
    );
}

fn envelope(
    id: EventId,
    workspace_id: WorkspaceId,
    sequence: u64,
    timestamp: Timestamp,
    payload: EventPayload,
) -> EventEnvelope {
    EventEnvelope {
        id,
        stream: StreamId::Workspace(workspace_id),
        sequence,
        timestamp,
        actor: Actor::user(),
        version: 1,
        causation_id: None,
        correlation_id: None,
        payload,
    }
}

fn approval_id_seeded(seed: u64) -> ApprovalId {
    ApprovalId::from_uuid(Uuid::from_u128(
        0x7000_0000_0000_0000_0000_0000_0000_0000 | (seed as u128),
    ))
}

fn event_id_seeded(seed: u64) -> EventId {
    EventId::from_uuid(Uuid::from_u128(
        0x8000_0000_0000_0000_0000_0000_0000_0000 | (seed as u128),
    ))
}

fn timestamp_at(offset_secs: i64) -> Timestamp {
    Timestamp::UNIX_EPOCH + time::Duration::seconds(offset_secs)
}

fn write_jsonl(path: &Path, events: &[EventEnvelope]) {
    let mut out = String::new();
    for env in events {
        out.push_str(&serde_json::to_string(env).expect("serialize EventEnvelope"));
        out.push('\n');
    }
    fs::write(path, out).unwrap_or_else(|err| panic!("write {}: {err}", path.display()));
    println!("wrote {}", path.display());
}

fn write_json(path: &Path, value: &serde_json::Value) {
    let text = serde_json::to_string_pretty(value).expect("serialize expected.json");
    fs::write(path, format!("{text}\n"))
        .unwrap_or_else(|err| panic!("write {}: {err}", path.display()));
    println!("wrote {}", path.display());
}
