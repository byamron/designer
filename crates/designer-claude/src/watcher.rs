//! Claude Code file watcher.
//!
//! **Role in the event pipeline:** secondary feed. Per ADR 0001 and
//! `core-docs/integration-notes.md`, the lead's `stream-json` output is the
//! primary lifecycle signal; the watcher catches out-of-band state that the
//! stream might miss — the initial `config.json` write, inbox deltas from
//! teammates, and shared task-list edits.
//!
//! **Validated shapes** (probe 2026-04-22, Claude Code 2.1.117):
//!
//! - `~/.claude/teams/{team}/config.json`        → [`WatcherEvent::TeamConfigChanged`]
//! - `~/.claude/teams/{team}/inboxes/{role}.json` → [`WatcherEvent::InboxChanged`]
//! - `~/.claude/tasks/{team}/{n}.json`            → [`WatcherEvent::TaskChanged`]
//! - `~/.claude/tasks/{session-uuid}/...`         → ignored (per-session TodoList tool state)
//!
//! Unknown paths log at DEBUG and surface as [`WatcherEvent::Unknown`] rather
//! than errors — the teams feature is experimental and may add new files.

use notify_debouncer_mini::{new_debouncer, DebouncedEvent, DebouncedEventKind, Debouncer};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WatcherEvent {
    /// `~/.claude/teams/{team}/config.json` was written or updated.
    TeamConfigChanged { team: String, path: PathBuf },
    /// `~/.claude/teams/{team}/inboxes/{role}.json` — a teammate posted to
    /// the `role` inbox (lead's inbox for lead-addressed messages).
    InboxChanged {
        team: String,
        role: String,
        path: PathBuf,
    },
    /// `~/.claude/tasks/{team}/{n}.json` — team task-list delta.
    TaskChanged { team: String, task_file: PathBuf },
    /// Any other path under the watched root. Expected for per-session
    /// TodoList state (`~/.claude/tasks/{uuid}/`) and future files.
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
                                debug!(path = %ev.path.display(), "watcher: out-of-scope path");
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

/// Classify a path that landed inside the watched root.
///
/// Return semantics:
/// - `None` — path is outside the known-interesting areas (e.g., `~/.claude/
///   settings.json`, `~/.claude/sessions/…`). Silently dropped; no consumer
///   event.
/// - `Some(WatcherEvent::Unknown)` — path is inside `teams/` or `tasks/` but
///   the shape is not one we recognize. Surfaced so consumers can log or
///   diagnose (e.g., Claude shipped a new file we haven't seen yet).
/// - `Some(WatcherEvent::…)` — a recognized shape.
fn classify(path: &Path) -> Option<WatcherEvent> {
    let components: Vec<&str> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    // Out-of-scope entirely: not under teams/ or tasks/.
    if !components.contains(&"teams") && !components.contains(&"tasks") {
        return None;
    }

    // Non-JSON files under the watched dirs are uninteresting; surface as
    // Unknown so they show up if we start seeing them.
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
        return Some(WatcherEvent::Unknown {
            path: path.to_path_buf(),
        });
    }

    let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");

    // .../teams/{team}/... branch
    if let Some(team_idx) = components.iter().position(|c| *c == "teams") {
        let Some(team) = components.get(team_idx + 1) else {
            return Some(WatcherEvent::Unknown {
                path: path.to_path_buf(),
            });
        };
        let after_team: &[&str] = &components[team_idx + 2..];
        return Some(match after_team {
            // .../teams/{team}/config.json
            [file] if *file == "config.json" => WatcherEvent::TeamConfigChanged {
                team: (*team).to_string(),
                path: path.to_path_buf(),
            },
            // .../teams/{team}/inboxes/{role}.json
            ["inboxes", file] if file.ends_with(".json") => WatcherEvent::InboxChanged {
                team: (*team).to_string(),
                role: file_stem.to_string(),
                path: path.to_path_buf(),
            },
            _ => WatcherEvent::Unknown {
                path: path.to_path_buf(),
            },
        });
    }

    // .../tasks/{maybe-team}/{n}.json branch. Ignore per-session TodoList
    // directories — they're UUID-named (36 chars with dashes), not team
    // names — so they drop to None, not Unknown.
    if let Some(tasks_idx) = components.iter().position(|c| *c == "tasks") {
        let Some(dir) = components.get(tasks_idx + 1) else {
            return Some(WatcherEvent::Unknown {
                path: path.to_path_buf(),
            });
        };
        if looks_like_uuid(dir) {
            debug!(path = %path.display(), "watcher: skipping per-session tasks dir");
            return None;
        }
        // Only surface actual task files (n.json), not directory markers.
        if !file_name.is_empty() {
            return Some(WatcherEvent::TaskChanged {
                team: (*dir).to_string(),
                task_file: path.to_path_buf(),
            });
        }
    }

    Some(WatcherEvent::Unknown {
        path: path.to_path_buf(),
    })
}

/// Heuristic: Claude's per-session TodoList dirs under `~/.claude/tasks/` are
/// named with canonical UUIDs (36 chars, four hyphens). Agent-team task dirs
/// use human-readable team names (no hyphens of the UUID shape).
fn looks_like_uuid(s: &str) -> bool {
    s.len() == 36
        && s.as_bytes()
            .iter()
            .enumerate()
            .all(|(i, b)| match i {
                8 | 13 | 18 | 23 => *b == b'-',
                _ => b.is_ascii_hexdigit(),
            })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn classifies_team_config() {
        let p = Path::new("/Users/me/.claude/teams/dir-recon/config.json");
        match classify(p).unwrap() {
            WatcherEvent::TeamConfigChanged { team, .. } => assert_eq!(team, "dir-recon"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn classifies_inbox_file() {
        let p = Path::new("/Users/me/.claude/teams/dir-recon/inboxes/researcher.json");
        match classify(p).unwrap() {
            WatcherEvent::InboxChanged { team, role, .. } => {
                assert_eq!(team, "dir-recon");
                assert_eq!(role, "researcher");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn classifies_team_task_file() {
        let p = Path::new("/Users/me/.claude/tasks/dir-recon/1.json");
        match classify(p).unwrap() {
            WatcherEvent::TaskChanged { team, task_file } => {
                assert_eq!(team, "dir-recon");
                assert_eq!(task_file, p);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn skips_per_session_todo_dir_silently() {
        let p = Path::new(
            "/Users/me/.claude/tasks/04f8a70a-acff-4e79-9e46-f0dfe34929a1/1.json",
        );
        assert!(classify(p).is_none(), "per-session dirs should drop silently");
    }

    #[test]
    fn non_json_in_teams_surfaces_as_unknown() {
        let p = Path::new("/Users/me/.claude/teams/dir-recon/config.yaml");
        assert!(matches!(classify(p), Some(WatcherEvent::Unknown { .. })));
    }

    #[test]
    fn out_of_scope_path_is_none() {
        // settings.json lives under ~/.claude/ but not under teams/ or tasks/;
        // we don't want it cluttering the event channel.
        let p = Path::new("/Users/me/.claude/settings.json");
        assert!(classify(p).is_none());
    }

    #[test]
    fn unknown_inside_teams_surfaces() {
        // A file whose path goes through teams/ but has an unrecognized shape.
        let p = Path::new("/Users/me/.claude/teams/dir-recon/inboxes/researcher/meta.json");
        assert!(matches!(classify(p), Some(WatcherEvent::Unknown { .. })));
    }

    #[test]
    fn looks_like_uuid_matches_canonical_form() {
        assert!(looks_like_uuid("04f8a70a-acff-4e79-9e46-f0dfe34929a1"));
        assert!(!looks_like_uuid("dir-recon"));
        assert!(!looks_like_uuid("04f8a70a-acff-4e79-9e46-f0dfe34929a"));
        assert!(!looks_like_uuid("not-a-uuid-at-all-here-tooshort"));
    }
}
