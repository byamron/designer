//! Claude Code file watcher. Observes `~/.claude/teams/{team}/config.json` and
//! `~/.claude/tasks/{team}/*.json`; translates change events into
//! `OrchestratorEvent`s via the public `WatcherEvent` enum.
//!
//! Note on observability: Claude Code's agent-teams surface is still evolving.
//! The watcher is intentionally tolerant — unknown files are logged at DEBUG
//! and skipped, not treated as errors. The real-spike validation (Phase 0 of
//! the roadmap) catalogs actual file shapes and updates the translator.

use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WatcherEvent {
    TeamConfigChanged { team: String, path: PathBuf },
    TaskChanged { team: String, task_file: PathBuf },
    Unknown { path: PathBuf },
}

pub struct ClaudeFileWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher>,
    rx: mpsc::UnboundedReceiver<WatcherEvent>,
}

impl ClaudeFileWatcher {
    pub fn new(root: impl AsRef<Path>, debounce: Duration) -> notify::Result<Self> {
        let root = root.as_ref().to_path_buf();
        let (tx, rx) = mpsc::unbounded_channel();
        let mut debouncer = new_debouncer(
            debounce,
            move |result: Result<Vec<DebouncedEvent>, notify::Error>| match result {
                Ok(events) => {
                    for ev in events {
                        if ev.kind != DebouncedEventKind::Any {
                            continue;
                        }
                        match classify(&ev.path) {
                            Some(translated) => {
                                let _ = tx.send(translated);
                            }
                            None => {
                                debug!(path = %ev.path.display(), "watcher: skip unknown");
                            }
                        }
                    }
                }
                Err(e) => warn!(%e, "watcher: notify error"),
            },
        )?;
        debouncer
            .watcher()
            .watch(&root, notify::RecursiveMode::Recursive)?;
        Ok(Self {
            _debouncer: debouncer,
            rx,
        })
    }

    pub async fn next(&mut self) -> Option<WatcherEvent> {
        self.rx.recv().await
    }
}

fn classify(path: &Path) -> Option<WatcherEvent> {
    let components: Vec<&str> = path.components().filter_map(|c| c.as_os_str().to_str()).collect();
    // Expected shapes (subject to Phase 0 validation):
    //   .../teams/{team}/config.json
    //   .../tasks/{team}/{n}.json
    if let Some(idx) = components.iter().position(|c| *c == "teams") {
        if let Some(team) = components.get(idx + 1) {
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                return Some(WatcherEvent::TeamConfigChanged {
                    team: (*team).to_string(),
                    path: path.to_path_buf(),
                });
            }
        }
    }
    if let Some(idx) = components.iter().position(|c| *c == "tasks") {
        if let Some(team) = components.get(idx + 1) {
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                return Some(WatcherEvent::TaskChanged {
                    team: (*team).to_string(),
                    task_file: path.to_path_buf(),
                });
            }
        }
    }
    Some(WatcherEvent::Unknown {
        path: path.to_path_buf(),
    })
}
