use designer_core::{
    Actor, EventPayload, EventStore, Projection, Projector, ProjectId, SqliteEventStore, StreamId,
    StreamOptions, WorkspaceId,
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
        designer_core::CoreError::Concurrency { expected: 0, actual: 1 }
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
    assert_eq!(received.kind(), designer_core::event::EventKind::ProjectCreated);
}
