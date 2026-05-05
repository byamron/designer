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
use designer_core::{SqliteEventStore, TabId, WorkspaceId};
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
    let tab = TabId::new();
    let spec = TeamSpec {
        workspace_id: ws,
        tab_id: tab,
        team_name: "designer-live-probe".into(),
        lead_role: "team-lead".into(),
        teammates: vec![],
        env: Default::default(),
        cwd: None,
        model: None,
        phase24: false,
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
    let shutdown = timeout(Duration::from_secs(90), orch.shutdown(ws, tab)).await;
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
/// **Triple-gated.** Even with `--features claude_live` this test only
/// runs when `DESIGNER_CLAUDE_LIVE_PERMISSION_TEST=1` is exported. The
/// CI tier-2 runner (`claude-live.yml`) currently does not export it —
/// the test is consistently flaky against the live model (four CI
/// failures, none reproducible from the captured event stream), and
/// the wire shape it exercises is already covered by
/// `claude_code::tests::stdio_permission_prompt_routes_to_decide`
/// against synthetic stdout. Keep the test in-tree as runnable
/// documentation of the expected end-to-end flow; opt in for ad-hoc
/// debugging via:
///
/// ```sh
/// DESIGNER_CLAUDE_LIVE_PERMISSION_TEST=1 cargo test \
///     --features claude_live -p designer-claude --test claude_live -- \
///     permission_prompt_round_trip --nocapture
/// ```
///
/// On opt-in failure the test surfaces every captured `OrchestratorEvent`
/// in the panic message so the next iteration can pinpoint whether the
/// model emitted a tool_use at all.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn permission_prompt_round_trip() {
    if std::env::var("DESIGNER_CLAUDE_LIVE_PERMISSION_TEST").is_err() {
        eprintln!(
            "skipping permission_prompt_round_trip — set \
             DESIGNER_CLAUDE_LIVE_PERMISSION_TEST=1 to enable; see test docstring"
        );
        return;
    }

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
            // Skip the runner's `~/.claude/settings.json` so the test
            // hits a hermetic permission policy. See test docstring for
            // the broader gating rationale.
            setting_sources: Some(vec!["local".into()]),
            ..Default::default()
        },
    )
    .with_permission_handler(handler);

    let mut events = orch.subscribe();
    let ws = WorkspaceId::new();
    let tab = TabId::new();
    let spec = TeamSpec {
        workspace_id: ws,
        tab_id: tab,
        team_name: "designer-permission-probe".into(),
        lead_role: "team-lead".into(),
        teammates: vec![],
        env: Default::default(),
        cwd: Some(workdir.path().to_path_buf()),
        model: None,
        phase24: false,
    };
    orch.spawn_team(spec)
        .await
        .expect("spawn_team should succeed");

    // Capture every event into a side-Vec so the panic path can dump the
    // observed stream — the failure mode we hit on CI is "no events
    // arrived at all" vs "events arrived but no permission prompt", and
    // the captured trace is the cheapest way to tell those apart.
    let captured: Arc<tokio::sync::Mutex<Vec<OrchestratorEvent>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let captured_for_task = captured.clone();
    let drain = tokio::spawn(async move {
        while let Ok(ev) = events.recv().await {
            captured_for_task.lock().await.push(ev);
        }
    });

    // Drive a prompt that forces the gated `Write` tool; see the original
    // analysis for why Bash / Read / Edit aren't reliable substitutes.
    orch.post_message(
        ws,
        tab,
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

    let woken = timeout(Duration::from_secs(240), notify.notified()).await;
    if woken.is_err() {
        let captured = captured.lock().await;
        let summary: Vec<String> = captured.iter().map(event_kind).collect();
        panic!(
            "permission handler.decide() did not fire within 240s. \
             Captured {} events: {:?}",
            captured.len(),
            summary
        );
    }

    let calls = received.lock().await;
    assert!(!calls.is_empty(), "expected at least one PermissionRequest");
    let req = &calls[0];
    assert_eq!(
        req.workspace_id,
        Some(ws),
        "PermissionRequest.workspace_id must round-trip"
    );
    assert!(
        ["Write", "Edit", "MultiEdit", "Bash"].contains(&req.tool.as_str()),
        "unexpected tool {} for the write-file prompt",
        req.tool
    );
    drop(calls);

    drain.abort();
    let shutdown = timeout(Duration::from_secs(90), orch.shutdown(ws, tab)).await;
    assert!(shutdown.is_ok(), "shutdown timed out");
    shutdown.unwrap().expect("shutdown should not error");
}

/// Compact one-line discriminant of an `OrchestratorEvent` for the
/// `permission_prompt_round_trip` failure trace. Keeps tool / role
/// fields where they matter for diagnosis; drops everything else.
fn event_kind(ev: &OrchestratorEvent) -> String {
    match ev {
        OrchestratorEvent::TeamSpawned { team, .. } => format!("TeamSpawned({team})"),
        OrchestratorEvent::AgentSpawned { role, .. } => format!("AgentSpawned({role})"),
        OrchestratorEvent::TaskCreated { title, .. } => format!("TaskCreated({title})"),
        OrchestratorEvent::TaskCompleted { .. } => "TaskCompleted".into(),
        OrchestratorEvent::TeammateIdle { .. } => "TeammateIdle".into(),
        OrchestratorEvent::AgentErrored { message, .. } => format!("AgentErrored({message})"),
        OrchestratorEvent::MessagePosted {
            author_role, body, ..
        } => {
            let preview: String = body.chars().take(40).collect();
            format!("MessagePosted({author_role}: {preview:?})")
        }
        OrchestratorEvent::ArtifactProduced { title, .. } => format!("ArtifactProduced({title})"),
        OrchestratorEvent::ArtifactUpdated { .. } => "ArtifactUpdated".into(),
        OrchestratorEvent::ActivityChanged { state, .. } => format!("ActivityChanged({state:?})"),
        // Phase 24 (ADR 0008) — chat-domain broadcasts. The
        // `permission_prompt_round_trip` test runs with
        // `phase24: false` so these arms are unreachable in practice;
        // kept for exhaustiveness so a future flag-on live test
        // doesn't fall off the match.
        OrchestratorEvent::AgentTurnStarted { turn_id, .. } => {
            format!("AgentTurnStarted({turn_id})")
        }
        OrchestratorEvent::AgentContentBlockStarted {
            block_index,
            block_kind,
            ..
        } => format!("AgentContentBlockStarted({block_index}: {block_kind:?})"),
        OrchestratorEvent::AgentContentBlockDelta { block_index, .. } => {
            format!("AgentContentBlockDelta({block_index})")
        }
        OrchestratorEvent::AgentContentBlockEnded { block_index, .. } => {
            format!("AgentContentBlockEnded({block_index})")
        }
        OrchestratorEvent::AgentToolResult {
            tool_use_id,
            is_error,
            ..
        } => format!("AgentToolResult({tool_use_id}, error={is_error})"),
        OrchestratorEvent::AgentTurnEnded { stop_reason, .. } => {
            format!("AgentTurnEnded({stop_reason:?})")
        }
    }
}
