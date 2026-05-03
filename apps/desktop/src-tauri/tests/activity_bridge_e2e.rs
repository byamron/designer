//! End-to-end test for [`spawn_activity_bridge`].
//!
//! The bridge subscribes to `OrchestratorEvent` on the orchestrator's
//! broadcast channel and forwards `ActivityChanged` variants onto the
//! Tauri channel `designer://activity-changed` as
//! [`designer_ipc::ActivityChanged`] payloads. This test exercises the
//! full path:
//!
//!   1. Boot `AppCore` with a `MockOrchestrator` we hold a typed
//!      reference to (so we can grab the broadcast sender).
//!   2. Construct a real Tauri app via `tauri::test::mock_app()` and
//!      install a listener on `ACTIVITY_CHANNEL`.
//!   3. Spawn the bridge against the mock app's `AppHandle`.
//!   4. Inject a synthetic `OrchestratorEvent::ActivityChanged
//!      { state: Working, since: now }` on the broadcast.
//!   5. Assert the listener receives a matching `ActivityChanged` DTO
//!      within ~100ms.
//!
//! See `apps/desktop/src-tauri/src/events.rs` for the bridge itself
//! and `core-docs/testing-strategy.md` §4 for the integration-test
//! conventions this file follows.

use designer_claude::{ActivityState, MockOrchestrator, Orchestrator, OrchestratorEvent};
use designer_core::{SqliteEventStore, TabId, WorkspaceId};
use designer_desktop::core::{AppConfig, AppCore};
use designer_desktop::events::{spawn_activity_bridge, ACTIVITY_CHANNEL};
use designer_ipc::ActivityChanged as ActivityChangedDto;
use designer_safety::CostCap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::Listener;
use tokio::sync::mpsc;
use tokio::time::timeout;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bridge_forwards_activity_to_tauri_channel() {
    // 1. Boot AppCore with an injected MockOrchestrator so we keep a
    //    typed handle and can grab the broadcast sender directly.
    let data_dir = tempfile::tempdir().expect("tempdir for data");
    // Mock owns its own in-memory store — we never read it back, only
    // broadcast through the orchestrator. AppCore opens a separate
    // sqlite under `data_dir/events.db` for its projector replay; the
    // two stores are independent (the broadcast channel is the only
    // surface this test cares about).
    let mock_store = Arc::new(SqliteEventStore::open_in_memory().expect("in-memory store"));
    let mock = Arc::new(MockOrchestrator::new(mock_store));
    let event_tx = mock.event_sender();

    let config = AppConfig {
        data_dir: data_dir.path().to_path_buf(),
        use_mock_orchestrator: true,
        claude_options: Default::default(),
        default_cost_cap: CostCap {
            max_dollars_cents: None,
            max_tokens: None,
        },
        helper_binary_path: None,
    };
    let core: Arc<AppCore> =
        AppCore::boot_with_orchestrator(config, Some(mock.clone() as Arc<dyn Orchestrator>))
            .await
            .expect("boot AppCore");

    // 2. Construct a Tauri app on the mock runtime + listen on the
    //    activity channel. `mock_app()` runs the runtime in-process —
    //    no Wry, no WebView — but emit/listen go through the same
    //    `tauri::Emitter` / `tauri::Listener` plumbing the production
    //    bridge uses, so a green test here proves the wire shape.
    let app = tauri::test::mock_app();
    let handle = app.handle().clone();

    let (received_tx, mut received_rx) = mpsc::unbounded_channel::<ActivityChangedDto>();
    let listener_tx = received_tx.clone();
    handle.listen(ACTIVITY_CHANNEL, move |event| {
        // Tauri's `Event::payload()` is the raw JSON string (no extra
        // wrapper) for `Emitter::emit` calls — same encoding the
        // production frontend `listen<ActivityChanged>` consumes.
        let payload: ActivityChangedDto =
            serde_json::from_str(event.payload()).expect("decode ActivityChanged payload");
        let _ = listener_tx.send(payload);
    });

    // 3. Spawn the bridge. It calls `core.orchestrator.subscribe()`
    //    internally, so the subscription is live before we publish
    //    below.
    spawn_activity_bridge(handle.clone(), core.clone());

    // The bridge spawns a tokio task that does its `subscribe()` on
    // first poll. Yield once so that subscription is in place before we
    // publish — otherwise the broadcast send can land in the gap and
    // the test races. This is the same hazard `tokio::sync::broadcast`
    // documents: subscribers added *after* a `send` miss the message.
    tokio::task::yield_now().await;
    tokio::time::sleep(Duration::from_millis(10)).await;

    // 4. Inject a synthetic ActivityChanged on the orchestrator's
    //    broadcast channel.
    let workspace_id = WorkspaceId::new();
    let tab_id = TabId::new();
    let since = SystemTime::now();
    let sent = event_tx
        .send(OrchestratorEvent::ActivityChanged {
            workspace_id,
            tab_id,
            state: ActivityState::Working,
            since,
        })
        .expect("broadcast ActivityChanged");
    assert!(
        sent >= 1,
        "bridge subscriber should have received the event"
    );

    // 5. Assert the Tauri channel received the matching DTO within
    //    100ms. The bridge's bounded latency is what the dock + tab
    //    badge depend on for the "Working… 0:00" baseline to flip in
    //    real time; a regression here is a UX regression.
    let received = timeout(Duration::from_millis(100), received_rx.recv())
        .await
        .expect("activity DTO not delivered within 100ms")
        .expect("listener channel closed before delivery");

    assert_eq!(received.workspace_id, workspace_id);
    assert_eq!(received.tab_id, tab_id);
    assert_eq!(received.state, designer_ipc::ActivityState::Working);
    // `since_ms` should round-trip the wall-clock instant we sent. We
    // don't pin an exact value — `SystemTime::now()` could differ from
    // `UNIX_EPOCH` by sub-ms in the conversion — but it must be in the
    // same neighborhood as the source `since`.
    let expected_ms = since
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let drift = received.since_ms.abs_diff(expected_ms);
    assert!(
        drift <= 5,
        "since_ms drifted from source by {drift}ms (expected ≤5ms)"
    );

    // Other variants must NOT cross the bridge — a TeamSpawned or
    // MessagePosted slipping through would mean the bridge was
    // forwarding the whole event stream instead of the
    // `ActivityChanged` arm.
    let _ = event_tx.send(OrchestratorEvent::TeamSpawned {
        workspace_id,
        team: "noop".into(),
    });
    let stray = timeout(Duration::from_millis(50), received_rx.recv()).await;
    assert!(
        stray.is_err(),
        "non-ActivityChanged events must not be forwarded onto ACTIVITY_CHANNEL (got {stray:?})"
    );
}
