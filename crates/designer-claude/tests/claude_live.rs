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

use async_trait::async_trait;
use designer_claude::{
    ClaudeCodeOptions, ClaudeCodeOrchestrator, Orchestrator, OrchestratorEvent, PermissionDecision,
    PermissionHandler, PermissionRequest, TeamSpec,
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

/// Records every `decide()` call into a shared `Vec` and signals
/// `notify.notify_one()` so the test can wake when at least one prompt
/// has landed. Always returns `Accept` — under the round-trip path that
/// causes the orchestrator to encode `{"behavior":"allow"}` and write it
/// through the lead's stdin, which is what unblocks `claude` to continue.
struct RecordingHandler {
    received: Arc<tokio::sync::Mutex<Vec<PermissionRequest>>>,
    notify: Arc<tokio::sync::Notify>,
}

#[async_trait]
impl PermissionHandler for RecordingHandler {
    async fn decide(&self, req: PermissionRequest) -> PermissionDecision {
        self.received.lock().await.push(req);
        self.notify.notify_one();
        PermissionDecision::Accept
    }
}

/// Live round-trip for `--permission-prompt-tool stdio`. Asks `claude` to
/// perform an operation that the default permission policy gates (a
/// `Write`); the orchestrator forwards the prompt to our
/// [`RecordingHandler`], which returns `Accept`; the orchestrator encodes
/// `{"behavior":"allow"}` and writes it through stdin; the agent unblocks
/// and the test exits cleanly.
///
/// Skipped on hermetic CI; runs on the self-hosted runner via
/// `cargo test --features claude_live` (see `claude-live.yml`).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn permission_prompt_round_trip() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let received = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let notify = Arc::new(tokio::sync::Notify::new());
    let handler: Arc<dyn PermissionHandler> = Arc::new(RecordingHandler {
        received: received.clone(),
        notify: notify.clone(),
    });

    let workdir = tempfile::tempdir().expect("tempdir");
    let orch = ClaudeCodeOrchestrator::new(
        store,
        ClaudeCodeOptions {
            cwd: Some(workdir.path().to_path_buf()),
            // Skip the runner's `~/.claude/settings.json`. Personal installs
            // typically have `permissions.allow` rules for Bash/Write that
            // auto-accept tool calls before they reach the stdio handler;
            // including `user` here lets that bypass our test entirely.
            // `local` only keeps this test hermetic without disabling
            // project-tracked policy from being honoured if the runner's
            // checkout ever gains one.
            setting_sources: Some(vec!["local".into()]),
            ..Default::default()
        },
    )
    .with_permission_handler(handler);

    let mut events = orch.subscribe();
    let ws = WorkspaceId::new();
    let spec = TeamSpec {
        workspace_id: ws,
        team_name: "designer-permission-probe".into(),
        lead_role: "team-lead".into(),
        teammates: vec![],
        env: Default::default(),
        cwd: Some(workdir.path().to_path_buf()),
    };
    orch.spawn_team(spec)
        .await
        .expect("spawn_team should succeed");

    // Block until the synthetic TeamSpawned echo lands so the lead is
    // initialized before we drive a prompt at it.
    let team_spawned = await_event(&mut events, Duration::from_secs(15), |e| {
        matches!(
            e,
            OrchestratorEvent::TeamSpawned { team, .. } if team == "designer-permission-probe"
        )
    })
    .await;
    assert!(
        team_spawned.is_some(),
        "TeamSpawned did not land within 15s"
    );

    // Default permission policy gates the `Write` tool on every call, so
    // forcing the model to invoke `Write` is the most reliable way to
    // exercise the stdio round-trip. Read-class tools (Read/Glob/Grep/LS)
    // auto-accept and never fire `decide()`; Bash classification varies
    // by command and can also auto-accept for simple invocations.
    orch.post_message(
        ws,
        "user".into(),
        "Invoke the Write tool exactly once with these arguments: \
         file_path = \"hello.txt\", content = \"hi\". \
         Do not call any other tool. Do not call Read, Glob, Grep, LS, \
         or Bash first. Do not narrate. Just emit the Write tool call \
         immediately and stop."
            .into(),
    )
    .await
    .expect("post_message should succeed");

    // Live model latency under serialized test execution: typical run is
    // 30–90s, but cold-start + multi-step reasoning can stretch further.
    // 240s gives margin without masking a real wire regression (which
    // would manifest as zero `decide()` calls regardless of how long we
    // wait).
    let woken = timeout(Duration::from_secs(240), notify.notified()).await;
    assert!(
        woken.is_ok(),
        "permission handler.decide() did not fire within 240s — round-trip broken"
    );

    let calls = received.lock().await;
    assert!(!calls.is_empty(), "expected at least one PermissionRequest");
    let req = &calls[0];
    assert_eq!(
        req.workspace_id,
        Some(ws),
        "PermissionRequest.workspace_id must round-trip"
    );
    // The prompt asks for Write; Edit/MultiEdit/Bash are accepted
    // fallbacks if the model substitutes. What we're testing is the
    // orchestrator's wire path, not the model's tool choice.
    assert!(
        ["Write", "Edit", "MultiEdit", "Bash"].contains(&req.tool.as_str()),
        "unexpected tool {} for the write-file prompt",
        req.tool
    );
    drop(calls);

    let shutdown = timeout(Duration::from_secs(90), orch.shutdown(ws)).await;
    assert!(shutdown.is_ok(), "shutdown timed out");
    shutdown.unwrap().expect("shutdown should not error");
}
