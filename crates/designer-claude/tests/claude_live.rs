//! Live integration test. Spawns a real `claude` subprocess through
//! `ClaudeCodeOrchestrator` and observes the full event flow.
//!
//! **Gate:** `--features claude_live` + a working Claude Code install with a
//! valid subscription login (`claude auth status` OK). Without the feature
//! flag this entire file compiles to an empty module so hermetic CI stays
//! green. See `core-docs/adr/0001-claude-runtime-primitive.md`.
//!
//! **Cost:** one short team spawn — typically $0.05–$0.50 per run depending
//! on the coordinator model Claude picks.

#![cfg(feature = "claude_live")]

use designer_claude::{
    ClaudeCodeOptions, ClaudeCodeOrchestrator, Orchestrator, OrchestratorEvent, TeamSpec,
};
use designer_core::{SqliteEventStore, WorkspaceId};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::timeout;

/// Wait up to `window` for an event matching `pred`. Drains all non-matching
/// events along the way (useful against the live stream which fires many
/// events per second).
async fn await_event<F>(
    rx: &mut tokio::sync::broadcast::Receiver<OrchestratorEvent>,
    window: Duration,
    mut pred: F,
) -> Option<OrchestratorEvent>
where
    F: FnMut(&OrchestratorEvent) -> bool,
{
    let deadline = tokio::time::Instant::now() + window;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match timeout(remaining, rx.recv()).await {
            Ok(Ok(ev)) => {
                if pred(&ev) {
                    return Some(ev);
                }
            }
            Ok(Err(RecvError::Lagged(_))) => continue,
            Ok(Err(RecvError::Closed)) => return None,
            Err(_) => return None, // timeout
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_team_and_observe_lifecycle() {
    // Keep the team tiny: lead only, no teammates in the spec. The lead may
    // still spawn teammates on its own if it thinks they're warranted, but
    // the test is tolerant to either path.
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let orch = ClaudeCodeOrchestrator::new(
        store,
        ClaudeCodeOptions {
            // Let `claude` resolve via PATH. Tests assume it's installed.
            ..Default::default()
        },
    );
    let mut events = orch.subscribe();

    let ws = WorkspaceId::new();
    let spec = TeamSpec {
        workspace_id: ws,
        team_name: "designer-live-probe".into(),
        lead_role: "team-lead".into(),
        teammates: vec![],
        env: Default::default(),
        cwd: None,
    };

    orch.spawn_team(spec)
        .await
        .expect("spawn_team should succeed");

    // Fastest observable signal is the synthetic `TeamSpawned` emit.
    let team_spawned = await_event(&mut events, Duration::from_secs(5), |e| {
        matches!(e, OrchestratorEvent::TeamSpawned { team, .. } if team == "designer-live-probe")
    })
    .await;
    assert!(team_spawned.is_some(), "expected TeamSpawned within 5s");

    // Shutdown within a reasonable window. The graceful path ends in
    // `start_kill()` fallback if the lead dawdles — still within 90s.
    let shutdown = timeout(Duration::from_secs(90), orch.shutdown(ws)).await;
    assert!(
        shutdown.is_ok(),
        "shutdown did not complete within 90s; orchestrator may be stuck"
    );
    shutdown.unwrap().expect("shutdown should not error");
}
