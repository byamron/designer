use designer_core::{
    Actor, ArtifactId, ArtifactKind, EventPayload, EventStore, PayloadRef, ProjectId, Projection,
    Projector, SqliteEventStore, StreamId, StreamOptions, TrackId, TrackState, WorkspaceId,
};
use std::path::PathBuf;

#[tokio::test]
async fn append_and_read_stream_round_trip() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let stream = StreamId::Project(project_id);

    let payload = EventPayload::ProjectCreated {
        project_id,
        name: "Designer".into(),
        root_path: PathBuf::from("/tmp/designer"),
    };

    let env = store
        .append(stream.clone(), None, Actor::user(), payload)
        .await
        .unwrap();
    assert_eq!(env.sequence, 1);

    let events = store
        .read_stream(stream.clone(), StreamOptions::default())
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, env.id);
}

#[tokio::test]
async fn optimistic_concurrency_detects_conflict() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let stream = StreamId::Project(project_id);

    let payload = EventPayload::ProjectCreated {
        project_id,
        name: "A".into(),
        root_path: PathBuf::from("/tmp/a"),
    };
    store
        .append(stream.clone(), Some(0), Actor::user(), payload.clone())
        .await
        .unwrap();

    // Stale expected_sequence should fail.
    let err = store
        .append(stream.clone(), Some(0), Actor::user(), payload)
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        designer_core::CoreError::Concurrency {
            expected: 0,
            actual: 1
        }
    ));
}

#[tokio::test]
async fn projector_replays_events_into_aggregate_state() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let project_stream = StreamId::Project(project_id);
    let workspace_stream = StreamId::Workspace(workspace_id);

    store
        .append(
            project_stream.clone(),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Designer".into(),
                root_path: PathBuf::from("/tmp/d"),
            },
        )
        .await
        .unwrap();

    store
        .append(
            workspace_stream.clone(),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "onboarding".into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();

    let all = store.read_all(StreamOptions::default()).await.unwrap();
    assert_eq!(all.len(), 2);

    let projector = Projector::new();
    projector.replay(&all);
    assert_eq!(projector.projects().len(), 1);
    assert_eq!(projector.workspaces_in(project_id).len(), 1);
}

/// Regression: the live runtime applies every event twice — once
/// synchronously at the call site of `store.append` (read-your-own-
/// writes consistency) and once again from the broadcast subscriber
/// (`spawn_projector_task`). The projector must be sequence-idempotent
/// so the second apply doesn't double-project. Until 2026-05-01 this
/// raced silently; CI eventually surfaced it as `tabs.len() == 2`
/// instead of 1 in `core::tests::open_tab_appends_and_projects`.
#[tokio::test]
async fn projector_apply_is_idempotent_per_sequence() {
    use designer_core::{TabId, TabTemplate};

    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let tab_id = TabId::new();

    // Write minimal history: project + workspace + one tab.
    store
        .append(
            StreamId::Project(project_id),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "P".into(),
                root_path: PathBuf::from("/tmp/p"),
            },
        )
        .await
        .unwrap();
    let ws_env = store
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
    let tab_env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::TabOpened {
                tab_id,
                workspace_id,
                title: "Plan".into(),
                template: TabTemplate::Plan,
            },
        )
        .await
        .unwrap();

    // Variant 1 — manual dual-apply (the original CI-failing class).
    let projector = Projector::new();
    projector.apply(&ws_env);
    projector.apply(&tab_env);
    projector.apply(&ws_env);
    projector.apply(&tab_env);
    let ws = projector
        .workspace(workspace_id)
        .expect("workspace projected");
    assert_eq!(
        ws.tabs.len(),
        1,
        "manual dual-apply: must collapse to one tab (was {})",
        ws.tabs.len()
    );
    assert_eq!(ws.tabs[0].id, tab_id);

    // Variant 2 — the actual production boot path: `replay()` over the
    // full history (cold-boot snapshot rebuild) followed by a live
    // `apply()` that the broadcast subscriber would deliver for events
    // that happened during boot. The replay applies up through the
    // tab; the subsequent live apply of the same envelope must not
    // duplicate.
    let projector = Projector::new();
    let all = store.read_all(StreamOptions::default()).await.unwrap();
    projector.replay(&all);
    // Simulate the broadcast subscriber re-applying the most recent event.
    projector.apply(&tab_env);
    let ws = projector
        .workspace(workspace_id)
        .expect("workspace projected after replay");
    assert_eq!(
        ws.tabs.len(),
        1,
        "replay -> live apply: must not duplicate tab (was {})",
        ws.tabs.len()
    );

    // Variant 3 — concurrent applies of the same envelope from many
    // threads. The fix's atomicity comes from `parking_lot::RwLock`
    // wrapping the whole apply body, so two threads racing on the same
    // sequence both serialize through the write lock; whichever wins
    // first claims the sequence, and the loser's check sees the
    // claimed value and returns. Asserts the contract under load.
    let projector = std::sync::Arc::new(Projector::new());
    projector.apply(&ws_env);
    let mut handles = Vec::new();
    for _ in 0..16 {
        let p = projector.clone();
        let env = tab_env.clone();
        handles.push(std::thread::spawn(move || {
            p.apply(&env);
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    let ws = projector
        .workspace(workspace_id)
        .expect("workspace projected after concurrent applies");
    assert_eq!(
        ws.tabs.len(),
        1,
        "16-way concurrent apply: must collapse to one tab (was {})",
        ws.tabs.len()
    );
}

#[tokio::test]
async fn subscriber_receives_live_events() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let stream = StreamId::Project(project_id);
    let mut rx = store.subscribe();

    store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Live".into(),
                root_path: PathBuf::from("/tmp/live"),
            },
        )
        .await
        .unwrap();

    let received = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv())
        .await
        .expect("timeout waiting for event")
        .expect("channel closed");
    assert_eq!(
        received.kind(),
        designer_core::event::EventKind::ProjectCreated
    );
}

#[tokio::test]
async fn artifact_lifecycle_projects_through_pin_unpin_archive() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let workspace_id = WorkspaceId::new();
    let artifact_id = ArtifactId::new();
    let stream = StreamId::Workspace(workspace_id);

    // Created
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id,
                workspace_id,
                artifact_kind: ArtifactKind::Spec,
                title: "Onboarding spec".into(),
                summary: "Three-step link + autonomy choice.".into(),
                payload: PayloadRef::inline("# Onboarding\n\nGoal: link + spawn under 60s."),
                author_role: Some("team-lead".into()),
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let found = projector.artifact(artifact_id).expect("artifact created");
    assert_eq!(found.kind, ArtifactKind::Spec);
    assert_eq!(found.version, 1);
    assert!(found.pinned_at.is_none());

    // Pinned
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactPinned { artifact_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let pinned = projector.pinned_artifacts(workspace_id);
    assert_eq!(pinned.len(), 1);
    assert_eq!(pinned[0].id, artifact_id);

    // Unpinned
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactUnpinned { artifact_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert!(projector.pinned_artifacts(workspace_id).is_empty());

    // Archived
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactArchived { artifact_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert!(projector.artifacts_in(workspace_id).is_empty());
    // Archived artifacts are still fetchable by id.
    assert!(projector.artifact(artifact_id).is_some());
}

#[tokio::test]
async fn track_lifecycle_projects_through_pr_open_complete_archive() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let workspace_id = WorkspaceId::new();
    let track_id = TrackId::new();
    let stream = StreamId::Workspace(workspace_id);

    // Started
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::TrackStarted {
                track_id,
                workspace_id,
                worktree_path: PathBuf::from("/tmp/repo/.designer/worktrees/feature-a"),
                branch: "feature/a".into(),
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let track = projector.track(track_id).expect("track created");
    assert_eq!(track.state, TrackState::Active);
    assert_eq!(projector.tracks_in(workspace_id).len(), 1);

    // PR opened
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::PullRequestOpened {
                track_id,
                pr_number: 42,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let track = projector.track(track_id).unwrap();
    assert_eq!(track.state, TrackState::PrOpen);
    assert_eq!(track.pr_number, Some(42));

    // Completed
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::system(),
            EventPayload::TrackCompleted { track_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert_eq!(projector.track(track_id).unwrap().state, TrackState::Merged);

    // Archived
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::system(),
            EventPayload::TrackArchived { track_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert_eq!(
        projector.track(track_id).unwrap().state,
        TrackState::Archived
    );

    // Replay produces identical state.
    let all = store.read_all(StreamOptions::default()).await.unwrap();
    let replayed = Projector::new();
    replayed.replay(&all);
    let replayed_track = replayed.track(track_id).unwrap();
    assert_eq!(replayed_track.state, TrackState::Archived);
    assert_eq!(replayed_track.pr_number, Some(42));
    assert_eq!(replayed.tracks_in(workspace_id).len(), 1);
}

#[tokio::test]
async fn payload_ref_inline_vs_hash_serialize_distinctly() {
    let inline = PayloadRef::inline("short");
    let hash = PayloadRef::Hash {
        hash: "abc123".into(),
        size: 50_000,
    };
    let inline_json = serde_json::to_string(&inline).unwrap();
    let hash_json = serde_json::to_string(&hash).unwrap();
    assert!(inline_json.contains("\"kind\":\"inline\""));
    assert!(hash_json.contains("\"kind\":\"hash\""));
    assert!(hash_json.contains("\"size\":50000"));
    let round: PayloadRef = serde_json::from_str(&inline_json).unwrap();
    assert!(round.is_inline());
}

#[tokio::test]
async fn busy_timeout_is_5_seconds_on_pool_connections() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    assert_eq!(store.busy_timeout_ms().unwrap(), 5000);
}
