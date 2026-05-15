//! Phase 24I — deterministic test for `read_all`'s rowid tiebreaker.
//!
//! PR #125 changed `read_all`'s `ORDER BY` from
//! `(timestamp ASC, sequence ASC)` to `(timestamp ASC, rowid ASC)` to
//! fix a 1/10 CI flake in
//! `projector_apply_is_idempotent_per_sequence`. `sequence` is
//! per-stream, so a Workspace-stream `seq=2` (TabOpened) could sort
//! before a Project-stream `seq=1` (ProjectCreated) when their RFC3339
//! timestamps tied — common on fast CI runners — and the projector's
//! `apply` dedup saw `seq=2` first, then skipped `seq=1` as a
//! duplicate. The fix is empirically stable (30/30 post-fix), but
//! stability is absence of evidence, not a contract. This test forces
//! the tie and asserts insertion order survives, so a future refactor
//! back to `sequence ASC` resurfaces immediately.

use designer_core::{
    Actor, EventPayload, EventStore, ProjectId, SqliteEventStore, StreamId, StreamOptions,
    WorkspaceId,
};
use std::path::PathBuf;

/// Two events on different streams, forced to the same RFC3339 instant
/// via `force_timestamp_for_test`. `read_all` must return them in
/// insertion order regardless of stream — that's the rowid tiebreaker.
#[tokio::test]
async fn read_all_tiebreaks_same_timestamp_by_rowid() {
    let store = SqliteEventStore::open_in_memory().unwrap();

    // 1. Project stream — appended first.
    let project_id = ProjectId::new();
    let project_env = store
        .append(
            StreamId::Project(project_id),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Rowid".into(),
                root_path: PathBuf::from("/tmp/rowid"),
            },
        )
        .await
        .unwrap();

    // 2. Workspace stream — appended second.
    let workspace_id = WorkspaceId::new();
    let workspace_env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "ws".into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();

    // Force both rows to the same RFC3339 instant so the primary order
    // key ties. The rowid tiebreaker has to fall through.
    let tied_ts = "2026-01-01T00:00:00.000000000Z";
    store
        .force_timestamp_for_test(project_env.id, tied_ts)
        .expect("force project timestamp");
    store
        .force_timestamp_for_test(workspace_env.id, tied_ts)
        .expect("force workspace timestamp");

    let all = store.read_all(StreamOptions::default()).await.unwrap();
    assert_eq!(all.len(), 2, "exactly two events should be in the store");

    // The Project event was inserted first, so rowid(Project) < rowid(Workspace).
    // `ORDER BY timestamp ASC, rowid ASC` must return Project first.
    // If a refactor switches back to `sequence ASC`, both events have
    // sequence=1 on their respective streams and the order becomes
    // implementation-defined — this assertion catches the regression.
    match (&all[0].payload, &all[1].payload) {
        (EventPayload::ProjectCreated { .. }, EventPayload::WorkspaceCreated { .. }) => {}
        other => panic!(
            "rowid tiebreaker broken: expected (ProjectCreated, WorkspaceCreated), got {other:?}"
        ),
    }
    assert_eq!(all[0].id, project_env.id);
    assert_eq!(all[1].id, workspace_env.id);
}

/// Same-stream timestamp tie: two events on the same workspace,
/// forced to identical timestamps. Insertion order must hold even
/// though sequences (1, 2) would have ordered them correctly anyway —
/// this pins the rowid tiebreaker as the authoritative final order,
/// not a coincidence.
#[tokio::test]
async fn read_all_tiebreaks_same_timestamp_same_stream_by_rowid() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();

    let first = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "ws-a".into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();

    let second = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::WorkspaceRenamed {
                workspace_id,
                name: "ws-b".into(),
            },
        )
        .await
        .unwrap();

    let tied_ts = "2026-01-01T00:00:00.000000000Z";
    store
        .force_timestamp_for_test(first.id, tied_ts)
        .expect("force first timestamp");
    store
        .force_timestamp_for_test(second.id, tied_ts)
        .expect("force second timestamp");

    let all = store.read_all(StreamOptions::default()).await.unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].id, first.id, "first append should sort first");
    assert_eq!(all[1].id, second.id, "second append should sort second");
}
