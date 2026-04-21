//! Designer CLI. Phase 2 completeness target: create a workspace, spawn a
//! team, assign a task, observe the full event timeline — all without the
//! frontend. This is the verification surface for the backend before Phase 8.

use designer_claude::{MockOrchestrator, Orchestrator, TaskAssignment, TeamSpec};
use designer_core::{
    Actor, EventPayload, EventStore, Projection, Projector, ProjectId, SqliteEventStore, StreamId,
    StreamOptions, TaskId, WorkspaceId,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("demo");
    match cmd {
        "demo" => run_demo().await,
        "events" => dump_events().await,
        "version" => {
            println!("designer {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        other => {
            eprintln!("unknown command: {other}");
            Ok(())
        }
    }
}

async fn store_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".designer").join("events.db")
}

async fn run_demo() -> anyhow::Result<()> {
    let store = Arc::new(SqliteEventStore::open(store_path().await)?);
    let orchestrator = Arc::new(MockOrchestrator::new(store.clone()));
    let projector = Projector::new();

    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();

    store
        .append(
            StreamId::Project(project_id),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Designer".into(),
                root_path: std::env::current_dir()?,
            },
        )
        .await?;

    store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "onboarding".into(),
                base_branch: "main".into(),
            },
        )
        .await?;

    orchestrator
        .spawn_team(TeamSpec {
            workspace_id,
            team_name: "onboarding".into(),
            lead_role: "team-lead".into(),
            teammates: vec!["design-reviewer".into(), "test-runner".into()],
            env: Default::default(),
        })
        .await?;

    orchestrator
        .assign_task(
            workspace_id,
            TaskAssignment {
                task_id: TaskId::new(),
                title: "Draft initial onboarding flow".into(),
                description: "Produce a plan and wireframes.".into(),
                assignee_role: Some("design-reviewer".into()),
            },
        )
        .await?;

    // Replay the store into the projector.
    let events = store.read_all(StreamOptions::default()).await?;
    projector.replay(&events);

    println!("\nProjects:");
    for p in projector.projects() {
        println!("  - {} @ {}", p.name, p.root_path.display());
    }
    println!("Workspaces:");
    for w in projector.workspaces_in(project_id) {
        println!("  - {} (base: {})", w.name, w.base_branch);
    }

    println!("\nTimeline:");
    for e in events.iter().rev().take(20).collect::<Vec<_>>().iter().rev() {
        println!(
            "  [{}] {:?} — seq={} by {:?}",
            e.timestamp.unix_timestamp(),
            e.kind(),
            e.sequence,
            e.actor
        );
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(())
}

async fn dump_events() -> anyhow::Result<()> {
    let store = SqliteEventStore::open(store_path().await)?;
    let events = store.read_all(StreamOptions::default()).await?;
    for e in &events {
        let json = serde_json::to_string(e)?;
        println!("{json}");
    }
    Ok(())
}
