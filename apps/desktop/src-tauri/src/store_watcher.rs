//! Watch `<data_dir>/events.db` (and its WAL sidecars) for external
//! mutations and notify the frontend so derived views (e.g. the friction
//! triage list) re-fetch.
//!
//! Why this exists: the running app keeps an in-memory `Projector` that
//! is kept fresh by an in-process broadcast channel. When the `designer`
//! CLI (or any other tool) appends to the on-disk event log, that channel
//! never fires — so the UI shows stale state until the user manually
//! refreshes. This watcher closes the gap by debouncing fs events on the
//! events directory and emitting a single `designer://store-changed`
//! notification per quiet window.
//!
//! Caveat: the watcher fires on the desktop's *own* writes too (since
//! they also touch the file). The 500ms debounce keeps the noise down,
//! and the FE listeners' re-fetch is cheap (a single `list_friction`
//! call). Distinguishing self-writes would require threading a "last
//! sequence I emitted" state through the bridge — out of scope for v1.

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Tauri event channel the watcher emits on. Frontend listeners subscribe
/// via `ipcClient().onStoreChanged(...)`.
pub const STORE_CHANGED_CHANNEL: &str = "designer://store-changed";

const DEBOUNCE: Duration = Duration::from_millis(500);

/// Spawn the watcher on a dedicated OS thread (notify is sync under the
/// hood). The returned thread handle is intentionally dropped — the
/// thread keeps itself alive by holding the debouncer; if the channel
/// closes (process shutdown) the loop exits and the thread terminates.
pub fn spawn_store_watcher(app: AppHandle, data_dir: PathBuf) {
    std::thread::Builder::new()
        .name("designer-store-watcher".into())
        .spawn(move || run_watcher(app, data_dir))
        .map(|_| ())
        .unwrap_or_else(|err| {
            tracing::warn!(error = %err, "could not spawn store watcher thread");
        });
}

fn run_watcher(app: AppHandle, data_dir: PathBuf) {
    let (tx, rx) = mpsc::channel::<DebounceEventResult>();
    let mut debouncer = match new_debouncer(DEBOUNCE, tx) {
        Ok(d) => d,
        Err(err) => {
            tracing::warn!(error = %err, "failed to construct fs debouncer; CLI writes will not auto-refresh the UI");
            return;
        }
    };
    // Watch the events directory non-recursively. SQLite WAL mode
    // touches `events.db`, `events.db-wal`, and `events.db-shm`; the
    // -wal/-shm files come and go during checkpoints, so watching the
    // directory and filtering by file name is sturdier than watching
    // each file individually.
    if let Err(err) = debouncer
        .watcher()
        .watch(&data_dir, RecursiveMode::NonRecursive)
    {
        tracing::warn!(
            error = %err,
            dir = %data_dir.display(),
            "failed to watch events directory; CLI writes will not auto-refresh the UI"
        );
        return;
    }
    tracing::info!(dir = %data_dir.display(), "store watcher armed");

    for batch in rx {
        let Ok(events) = batch else { continue };
        if events.iter().any(|e| is_event_store_path(&e.path)) {
            if let Err(err) = app.emit(STORE_CHANGED_CHANNEL, ()) {
                tracing::warn!(error = %err, "failed to emit store-changed");
            }
        }
    }
}

/// `events.db` is the only file we care about. The `-wal` and `-shm`
/// sidecars share the same triggering write under WAL mode, so debounce
/// + filter on the canonical name keeps the emit count to one per burst.
fn is_event_store_path(p: &Path) -> bool {
    matches!(
        p.file_name().and_then(|s| s.to_str()),
        Some("events.db") | Some("events.db-wal") | Some("events.db-shm")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_event_store_path_matches_db_and_wal() {
        assert!(is_event_store_path(Path::new("/tmp/.designer/events.db")));
        assert!(is_event_store_path(Path::new(
            "/tmp/.designer/events.db-wal"
        )));
        assert!(is_event_store_path(Path::new(
            "/tmp/.designer/events.db-shm"
        )));
    }

    #[test]
    fn is_event_store_path_rejects_unrelated_files() {
        assert!(!is_event_store_path(Path::new(
            "/tmp/.designer/settings.json"
        )));
        assert!(!is_event_store_path(Path::new("/tmp/.designer/crashes/x")));
        assert!(!is_event_store_path(Path::new("/tmp/.designer/")));
    }
}
