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

use crate::core::AppCore;
use designer_core::EventStore;
use designer_ipc::StreamEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast::error::RecvError;

pub const EVENT_STREAM_CHANNEL: &str = "designer://event-stream";

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
                    tracing::warn!(dropped = n, "event bridge lagged — frontend may need to resync");
                }
                Err(RecvError::Closed) => {
                    tracing::info!("event store closed; stopping event bridge");
                    break;
                }
            }
        }
    });
}
