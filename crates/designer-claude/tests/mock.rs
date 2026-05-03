use designer_claude::{
    MockOrchestrator, Orchestrator, OrchestratorEvent, TaskAssignment, TeamSpec,
};
use designer_core::{
    EventStore, SqliteEventStore, StreamId, StreamOptions, TabId, TaskId, WorkspaceId,
};
use std::sync::Arc;

#[tokio::test]
async fn mock_spawns_team_emits_expected_events() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let orch = MockOrchestrator::new(store.clone());
    let mut stream = orch.subscribe();

    let ws = WorkspaceId::new();
    let tab = TabId::new();
    orch.spawn_team(TeamSpec {
        workspace_id: ws,
        tab_id: tab,
        team_name: "onboarding".into(),
        lead_role: "team-lead".into(),
        teammates: vec!["design-reviewer".into(), "test-runner".into()],
        env: Default::default(),
        cwd: None,
        model: None,
    })
    .await
    .unwrap();

    let mut seen: Vec<String> = vec![];
    for _ in 0..4 {
        let ev = tokio::time::timeout(std::time::Duration::from_millis(500), stream.recv())
            .await
            .unwrap()
            .unwrap();
        seen.push(match ev {
            OrchestratorEvent::TeamSpawned { .. } => "team".into(),
            OrchestratorEvent::AgentSpawned { role, .. } => format!("agent:{role}"),
            _ => "other".into(),
        });
    }
    assert!(seen.contains(&"team".into()));
    assert!(seen.contains(&"agent:team-lead".into()));
    assert!(seen.contains(&"agent:design-reviewer".into()));
    assert!(seen.contains(&"agent:test-runner".into()));
}

#[tokio::test]
async fn mock_assign_task_produces_create_and_complete() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let orch = MockOrchestrator::new(store.clone());
    let ws = WorkspaceId::new();
    let tab = TabId::new();
    orch.spawn_team(TeamSpec {
        workspace_id: ws,
        tab_id: tab,
        team_name: "build".into(),
        lead_role: "team-lead".into(),
        teammates: vec![],
        env: Default::default(),
        cwd: None,
        model: None,
    })
    .await
    .unwrap();

    orch.assign_task(
        ws,
        tab,
        TaskAssignment {
            task_id: TaskId::new(),
            title: "wire auth".into(),
            description: "implement auth middleware".into(),
            assignee_role: None,
        },
    )
    .await
    .unwrap();

    let events = store
        .read_stream(StreamId::Workspace(ws), StreamOptions::default())
        .await
        .unwrap();
    let kinds: Vec<_> = events.iter().map(|e| e.kind()).collect();
    use designer_core::event::EventKind::*;
    assert!(kinds.contains(&AgentSpawned));
    assert!(kinds.contains(&TaskCreated));
    assert!(kinds.contains(&TaskCompleted));
}
