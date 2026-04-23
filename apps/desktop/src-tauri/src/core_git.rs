//! AppCore methods reserved for Phase 13.E — track primitive + git wire +
//! repo linking + core-docs persistence.
//!
//! This file starts as an empty `impl AppCore { … }` block. Track 13.E fills
//! in methods for `link_repo`, track creation (emitting `TrackStarted`),
//! `open_pr` (emitting `PullRequestOpened`), and `core-docs/` seeding. Other
//! tracks never edit this file.
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Mark cross-track hooks with `// TODO(13.X):` so grep finds them.
//! - IPC handlers live in `commands_git.rs`.
//! - Do **not** touch `core.rs` itself.

use crate::core::AppCore;

#[allow(dead_code, reason = "reserved for Phase 13.E — track + git wire")]
impl AppCore {
    // Phase 13.E will land:
    //   pub async fn link_repo(&self, project_id: ProjectId, path: PathBuf) -> Result<…>
    //   pub async fn create_track(&self, workspace_id: WorkspaceId, …) -> Result<TrackId, …>
    //   pub async fn open_pr(&self, track_id: TrackId, …) -> Result<PullRequestOpened, …>
    //   pub async fn complete_track(&self, track_id: TrackId) -> Result<…>
    //   pub async fn seed_core_docs(&self, project_id: ProjectId) -> Result<…>
    //
    // Event vocabulary is frozen in `designer-core::event::EventPayload` by
    // Phase 13.0 (see TrackStarted / TrackCompleted / PullRequestOpened /
    // TrackArchived / WorkspaceForked / WorkspacesReconciled).
}
