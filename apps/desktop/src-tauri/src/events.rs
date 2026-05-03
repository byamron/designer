//! Rust → frontend event bridge.
//!
//! A background task subscribes to `AppCore.store.subscribe()` (a Tokio
//! broadcast receiver) and forwards each event as a flattened `StreamEvent` on
//! the Tauri event channel `designer://event-stream`. The frontend listens via
//! `TauriIpcClient.stream()`.
//!
//! Back-pressure: the broadcast channel has a bounded capacity (1024 in
//! `SqliteEventStore`). If the bridge lags, `recv()` returns
//! `RecvError::Lagged(n)` — we log a warning and continue. The frontend can
//! re-bootstrap from `list_projects`/`list_workspaces` on next user action.
//!
//! Phase 23.B adds a parallel bridge (`spawn_activity_bridge`) for the
//! orchestrator's broadcast-only `OrchestratorEvent::ActivityChanged`
//! variant. It rides a *separate* Tauri channel
//! (`designer://activity-changed`) so the persisted event-stream wire
//! stays focused on the projector's domain events. Activity is a
//! transient signal — no replay invariant, no projector arm — so
//! routing it through the event store would be a category error.

use crate::core::AppCore;
use designer_claude::{ActivityState as CoreActivityState, OrchestratorEvent};
use designer_core::EventStore;
use designer_ipc::{ActivityChanged, ActivityState, StreamEvent};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast::error::RecvError;

pub const EVENT_STREAM_CHANNEL: &str = "designer://event-stream";

/// Phase 23.B — Tauri channel for `OrchestratorEvent::ActivityChanged`
/// fan-out. Frontend `TauriIpcClient.activityStream()` listens on this
/// channel; the dock + tab-strip badge update from the resulting
/// `ActivityChanged` DTOs.
pub const ACTIVITY_CHANNEL: &str = "designer://activity-changed";

/// Spawn the forwarder. Call once in `.setup()`; the task outlives it via the
/// cloned `AppHandle`.
pub fn spawn_event_bridge(app: AppHandle, core: Arc<AppCore>) {
    tauri::async_runtime::spawn(async move {
        let mut rx = core.store.subscribe();
        loop {
            match rx.recv().await {
                Ok(env) => {
                    let payload = StreamEvent::from(&env);
                    if let Err(err) = app.emit(EVENT_STREAM_CHANNEL, &payload) {
                        tracing::warn!(error = %err, "failed to emit event to frontend");
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!(
                        dropped = n,
                        "event bridge lagged — frontend may need to resync"
                    );
                }
                Err(RecvError::Closed) => {
                    tracing::info!("event store closed; stopping event bridge");
                    break;
                }
            }
        }
    });
}

/// Phase 23.B — fan out per-tab activity transitions to the frontend.
/// Subscribes to the orchestrator's broadcast (not the event store)
/// and emits a typed [`ActivityChanged`] DTO on
/// [`ACTIVITY_CHANNEL`] for every state edge.
pub fn spawn_activity_bridge(app: AppHandle, core: Arc<AppCore>) {
    tauri::async_runtime::spawn(async move {
        let mut rx = core.orchestrator.subscribe();
        loop {
            match rx.recv().await {
                Ok(OrchestratorEvent::ActivityChanged {
                    workspace_id,
                    tab_id,
                    state,
                    since,
                }) => {
                    let payload = ActivityChanged {
                        workspace_id,
                        tab_id,
                        state: map_state(state),
                        since_ms: system_time_to_ms(since),
                    };
                    if let Err(err) = app.emit(ACTIVITY_CHANNEL, &payload) {
                        tracing::warn!(error = %err, "failed to emit activity to frontend");
                    }
                }
                Ok(_) => {} // other variants belong to the message coalescer
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!(
                        dropped = n,
                        "activity bridge lagged — frontend may show stale state until next transition"
                    );
                }
                Err(RecvError::Closed) => {
                    tracing::info!("orchestrator closed; stopping activity bridge");
                    break;
                }
            }
        }
    });
}

fn map_state(state: CoreActivityState) -> ActivityState {
    match state {
        CoreActivityState::Idle => ActivityState::Idle,
        CoreActivityState::Working => ActivityState::Working,
        CoreActivityState::AwaitingApproval => ActivityState::AwaitingApproval,
    }
}

fn system_time_to_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        // Pre-epoch system times only happen on a wildly miscalibrated
        // clock; fall back to "now" so the elapsed counter doesn't
        // explode.
        .unwrap_or_else(|_| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        })
}
