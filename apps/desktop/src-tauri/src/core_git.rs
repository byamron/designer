//! AppCore methods for Phase 13.E — track primitive + git wire + repo
//! linking + core-docs persistence.
//!
//! All track lifecycle, worktree management, edit-batch coalescing, and
//! `gh pr create` automation flows through here. Other tracks never edit
//! this file (CLAUDE.md §"Parallel track conventions").
//!
//! Edit-batch coalescing strategy: explicit, on `cmd_status_check`. The
//! caller (UI button or background "agent finished tool call" hook from
//! 13.D) asks "what's changed?", we diff vs. base, hash the result, and
//! emit one `code-change` artifact only if the signature differs from the
//! last emit for that track. A 60-second timer was rejected as the primary
//! coalescer because (a) wall-clock heuristics are flaky in tests and on
//! suspended laptops, (b) it produces phantom artifacts when nothing
//! changed but the timer fired, and (c) explicit-on-check matches the
//! mental model of "snapshot a moment of work."

use crate::core::AppCore;
use designer_core::{
    author_roles, Actor, ArtifactId, ArtifactKind, CoreError, EventPayload, EventStore, PayloadRef,
    ProjectId, Projection, StreamId, Track, TrackId, TrackState, WorkspaceId,
};
use designer_git::{GitError, GitOps, RealGitOps, Status};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

/// Bounded timeout for `gh pr create` and other network-touching subprocesses.
/// Kept generous enough that a slow but live network completes (median
/// `gh pr create` is ~2–4s on broadband) but tight enough that the UI never
/// hangs indefinitely on a stalled connection. Test-overridable.
const GH_TIMEOUT_DEFAULT: Duration = Duration::from_secs(30);

#[cfg(test)]
fn gh_timeout_slot() -> &'static Mutex<Duration> {
    static SLOT: OnceLock<Mutex<Duration>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(GH_TIMEOUT_DEFAULT))
}

#[cfg(test)]
fn gh_timeout() -> Duration {
    *gh_timeout_slot().lock()
}

#[cfg(test)]
pub fn set_gh_timeout_for_tests(d: Duration) {
    *gh_timeout_slot().lock() = d;
}

#[cfg(not(test))]
const fn gh_timeout() -> Duration {
    GH_TIMEOUT_DEFAULT
}

/// Process-global GitOps. `RealGitOps` is stateless and only shells out to
/// `git` / `gh` so a singleton is safe; tests override via
/// `set_git_ops_for_tests`.
fn git_ops() -> Arc<dyn GitOps> {
    static OPS: OnceLock<Arc<dyn GitOps>> = OnceLock::new();
    OPS.get_or_init(|| Arc::new(RealGitOps::new()) as Arc<dyn GitOps>)
        .clone()
}

#[cfg(test)]
static TEST_GIT_OPS: OnceLock<Mutex<Option<Arc<dyn GitOps>>>> = OnceLock::new();

#[cfg(test)]
pub fn set_git_ops_for_tests(ops: Arc<dyn GitOps>) {
    TEST_GIT_OPS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .replace(ops);
}

#[cfg(test)]
fn current_git_ops() -> Arc<dyn GitOps> {
    TEST_GIT_OPS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .clone()
        .unwrap_or_else(git_ops)
}

#[cfg(not(test))]
fn current_git_ops() -> Arc<dyn GitOps> {
    git_ops()
}

/// Per-track in-memory baseline for the edit-batch coalescer. Keyed by
/// `TrackId`; value is a stable signature of the most recently emitted
/// `code-change` artifact (file count, +/- per file, sorted paths). Repeated
/// `check_track_status` calls with an unchanged signature are no-ops — that's
/// what keeps the projector from gaining duplicate cards on repeat clicks.
///
/// Cleaned up on `TrackArchived` (or programmatically via `forget_track`).
fn batch_signatures() -> &'static Mutex<HashMap<TrackId, String>> {
    static MAP: OnceLock<Mutex<HashMap<TrackId, String>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// In-flight `request_merge` set. A second concurrent or rapid double-click
/// finds the track id here and short-circuits with a friendly error instead
/// of running `gh pr create` twice (which would fail with "PR already
/// exists" the second time and confuse the user).
fn requesting_merge_inflight() -> &'static Mutex<HashSet<TrackId>> {
    static SET: OnceLock<Mutex<HashSet<TrackId>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// One mutex per repo path. `start_track` acquires the entry for its repo
/// before calling `init_worktree`, so two concurrent `start_track` calls on
/// the same repo serialize. Different repos run in parallel.
fn repo_locks() -> &'static Mutex<HashMap<PathBuf, Arc<AsyncMutex<()>>>> {
    static MAP: OnceLock<Mutex<HashMap<PathBuf, Arc<AsyncMutex<()>>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_for_repo(repo: &Path) -> Arc<AsyncMutex<()>> {
    let mut map = repo_locks().lock();
    map.entry(repo.to_path_buf())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

fn signature_for(status: &Status) -> String {
    // Per-file +/- counts so that two distinct diffs touching the same paths
    // with identical totals (e.g. +3/-1 on `a.rs` then +2/-0 on `a.rs` and
    // +1/-1 on `b.rs`) produce different signatures. The earlier coarse
    // version (file count + total +/-) silently dropped the second batch.
    let mut entries: Vec<String> = status
        .files
        .iter()
        .map(|f| format!("{}:+{}:-{}", f.path.display(), f.added, f.removed))
        .collect();
    entries.sort();
    format!(
        "n{}|+{}|-{}|{}",
        status.files.len(),
        status.added_total,
        status.removed_total,
        entries.join(",")
    )
}

/// Validate a branch name we're about to pass to `git`. The big risks are
/// argument injection (a leading `-` would be parsed as a flag) and
/// shell-meta characters that could break command parsing on a less-strict
/// runner. We delegate the rest of the check to git itself, which has its
/// own ref-name rules.
fn validate_branch(branch: &str) -> Result<(), CoreError> {
    if branch.is_empty() {
        return Err(CoreError::Invariant("branch must not be empty".into()));
    }
    if branch.starts_with('-') {
        return Err(CoreError::Invariant(format!(
            "branch must not start with '-': {branch}"
        )));
    }
    if branch.chars().any(|c| {
        c.is_whitespace()
            || c.is_control()
            || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '\0')
    }) {
        return Err(CoreError::Invariant(format!(
            "branch contains invalid characters: {branch}"
        )));
    }
    Ok(())
}

fn parent_repo_path(workspace_id: WorkspaceId, core: &AppCore) -> Result<PathBuf, CoreError> {
    let workspace = core
        .projector
        .workspace(workspace_id)
        .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
    if let Some(p) = workspace.worktree_path {
        return Ok(p);
    }
    // Fall back to the project root — pre-link, before cmd_link_repo runs.
    let project = core
        .projector
        .project(workspace.project_id)
        .ok_or_else(|| CoreError::NotFound(workspace.project_id.to_string()))?;
    Ok(project.root_path)
}

fn require_linked_repo(workspace_id: WorkspaceId, core: &AppCore) -> Result<PathBuf, CoreError> {
    let workspace = core
        .projector
        .workspace(workspace_id)
        .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
    workspace
        .worktree_path
        .ok_or_else(|| CoreError::NotFound(format!("repo not linked: {}", workspace_id)))
}

/// Slug a branch name into a filesystem-friendly token. We don't try to be
/// clever — collapse anything that isn't `[A-Za-z0-9_]` to `-`.
fn slug(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn worktree_path_for(repo: &Path, track_id: TrackId, branch: &str) -> PathBuf {
    // Deterministic: repo/.designer/worktrees/<track-id>-<slug>. Including
    // the track id in the path means two concurrent `start_track` calls
    // for the same repo can never collide on a directory, even if the
    // branch slugs match.
    let dir = format!("{}-{}", track_id.as_uuid(), slug(branch));
    repo.join(".designer").join("worktrees").join(dir)
}

const SEED_DOC_SOURCES: &[(&str, &str)] = &[
    (
        "core-docs/plan.md",
        "# Plan\n\n_What this track is doing now._\n",
    ),
    (
        "core-docs/spec.md",
        "# Spec\n\n_The decisions this track is anchored to._\n",
    ),
    (
        "core-docs/feedback.md",
        "# Feedback\n\n_Direction the user has given._\n",
    ),
    (
        "core-docs/history.md",
        "# History\n\n_Shipped work, in reverse chronological order._\n",
    ),
];

/// Drop-guard for the in-flight `request_merge` set. Whatever the outcome of
/// the gh call, the track id is removed when this guard goes out of scope.
struct InflightGuard(TrackId);
impl Drop for InflightGuard {
    fn drop(&mut self) {
        requesting_merge_inflight().lock().remove(&self.0);
    }
}

impl AppCore {
    /// Validate `repo_path` is a git work-tree, canonicalize it (resolving
    /// symlinks so two distinct user-facing paths that point at the same
    /// repo dedupe to one stored value), and persist the link as a
    /// `WorkspaceWorktreeAttached` event. Re-linking is supported and
    /// idempotent (replay yields the latest path).
    pub async fn link_repo(
        &self,
        workspace_id: WorkspaceId,
        repo_path: PathBuf,
    ) -> Result<(), CoreError> {
        let canonical = std::fs::canonicalize(&repo_path).map_err(|e| {
            CoreError::Invariant(format!(
                "could not resolve repo path {}: {e}",
                repo_path.display()
            ))
        })?;
        let ops = current_git_ops();
        ops.validate_repo(&canonical).await.map_err(map_git_err)?;
        // Track 13.L: friction records persist under
        // `<repo>/.designer/friction/`. The default is "private to the
        // user" — write the entry to `.gitignore` on first link so the
        // user has to opt in to commit screenshots and bug bodies.
        // Best-effort; failure is logged inside `ensure_friction_gitignore`.
        crate::core_friction::ensure_friction_gitignore(&canonical);
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::WorkspaceWorktreeAttached {
                    workspace_id,
                    path: canonical,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Sever Designer's pointer to the workspace's linked repo. The
    /// repo on disk is untouched; only the projection's `worktree_path`
    /// is cleared. Idempotent — calling this on an already-unlinked
    /// workspace returns `Ok(())` without emitting an event so the UI
    /// can safely retry.
    pub async fn unlink_repo(&self, workspace_id: WorkspaceId) -> Result<(), CoreError> {
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
        if workspace.worktree_path.is_none() {
            return Ok(());
        }
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::WorkspaceWorktreeDetached { workspace_id },
            )
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Spawn a new track inside `workspace_id`. Creates a worktree under
    /// `<repo>/.designer/worktrees/<track-id>-<slug>` rooted at `base`,
    /// emits `TrackStarted`, seeds `core-docs/*.md` and commits them on
    /// the new branch. Returns the new track id.
    ///
    /// Concurrent `start_track` calls on the same repo are serialized via
    /// a per-repo async mutex; calls on distinct repos run in parallel.
    /// Failures after `init_worktree` succeeds (seed write, commit, event
    /// append) trigger a best-effort rollback that removes the worktree
    /// and the branch so the user can retry without a leaked checkout.
    pub async fn start_track(
        &self,
        workspace_id: WorkspaceId,
        branch: String,
        base: Option<String>,
    ) -> Result<TrackId, CoreError> {
        validate_branch(&branch)?;
        let repo = require_linked_repo(workspace_id, self)?;
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
        let base = base.unwrap_or(workspace.base_branch.clone());

        let lock = lock_for_repo(&repo);
        let _guard = lock.lock().await;

        let track_id = TrackId::new();
        let target = worktree_path_for(&repo, track_id, &branch);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoreError::Invariant(format!("create worktree parent: {e}")))?;
        }
        let ops = current_git_ops();
        ops.init_worktree(&repo, &branch, &base, &target)
            .await
            .map_err(map_git_err)?;

        // From here on, anything that fails must clean up the worktree
        // before returning so a partial init doesn't leak a checkout.
        let cleanup = |reason: String| {
            let ops = ops.clone();
            let repo = repo.clone();
            let target = target.clone();
            async move {
                let _ = ops.remove_worktree(&repo, &target).await;
                CoreError::Invariant(reason)
            }
        };

        if let Err(e) = seed_core_docs(&target) {
            return Err(cleanup(format!("seed docs: {e}")).await);
        }
        if let Err(e) = ops
            .commit_seed_docs(&target, "chore: seed core-docs (Designer)")
            .await
        {
            return Err(cleanup(format!("commit seed docs: {e}")).await);
        }

        match self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TrackStarted {
                    track_id,
                    workspace_id,
                    worktree_path: target.clone(),
                    branch,
                },
            )
            .await
        {
            Ok(env) => {
                self.projector.apply(&env);
                Ok(track_id)
            }
            Err(e) => {
                let _ = ops.remove_worktree(&repo, &target).await;
                Err(e)
            }
        }
    }

    /// Request the track's branch be merged. Idempotent against rapid
    /// double-clicks and against re-entry while a previous call is in
    /// flight: the second caller short-circuits with `Invariant("merge
    /// request already in flight")` instead of running `gh pr create`
    /// twice. The gh call itself is bounded by `GH_TIMEOUT`.
    pub async fn request_merge(&self, track_id: TrackId) -> Result<u64, CoreError> {
        let track = self
            .projector
            .track(track_id)
            .ok_or_else(|| CoreError::NotFound(track_id.to_string()))?;
        if !matches!(track.state, TrackState::Active) {
            return Err(CoreError::Invariant(format!(
                "track {track_id} is not in a mergeable state ({:?})",
                track.state
            )));
        }
        // Reserve the in-flight slot. If another caller already holds it,
        // bail out cleanly without touching gh.
        {
            let mut inflight = requesting_merge_inflight().lock();
            if !inflight.insert(track_id) {
                return Err(CoreError::Invariant(format!(
                    "merge request already in flight for track {track_id}"
                )));
            }
        }
        let _guard = InflightGuard(track_id);

        let workspace = self
            .projector
            .workspace(track.workspace_id)
            .ok_or_else(|| CoreError::NotFound(track.workspace_id.to_string()))?;
        let title = format!("{}: {}", workspace.name, track.branch);
        let body = format!(
            "Opened from Designer track `{}`.\n\nWorkspace: {}\nBranch: {}\nBase: {}",
            track_id, workspace.name, track.branch, workspace.base_branch
        );
        let ops = current_git_ops();
        let timeout = gh_timeout();
        let pr = match tokio::time::timeout(
            timeout,
            ops.open_pr(&track.worktree_path, &title, &body, &workspace.base_branch),
        )
        .await
        {
            Ok(Ok(pr)) => pr,
            Ok(Err(e)) => return Err(map_git_err(e)),
            Err(_) => {
                return Err(CoreError::Invariant(format!(
                    "gh pr create timed out after {}s",
                    timeout.as_secs()
                )));
            }
        };

        let env = self
            .store
            .append(
                StreamId::Workspace(track.workspace_id),
                None,
                Actor::user(),
                EventPayload::PullRequestOpened {
                    track_id,
                    pr_number: pr.number,
                },
            )
            .await?;
        self.projector.apply(&env);

        // Companion artifact for the unified thread.
        let pr_summary = format!("#{} · open · {}", pr.number, pr.title);
        let pr_artifact = ArtifactId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(track.workspace_id),
                None,
                Actor::user(),
                EventPayload::ArtifactCreated {
                    artifact_id: pr_artifact,
                    workspace_id: track.workspace_id,
                    artifact_kind: ArtifactKind::Pr,
                    title: format!("#{} — {}", pr.number, pr.title),
                    summary: pr_summary,
                    payload: PayloadRef::inline(pr.url.clone()),
                    author_role: Some(author_roles::TRACK.into()),
                    // PR artifacts are workspace-wide work products.
                    tab_id: None,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(pr.number)
    }

    /// All tracks for a workspace, oldest first. Replay-derived.
    pub async fn list_tracks(&self, workspace_id: WorkspaceId) -> Vec<Track> {
        self.projector.tracks_in(workspace_id)
    }

    pub async fn get_track(&self, track_id: TrackId) -> Option<Track> {
        self.projector.track(track_id)
    }

    /// Diff the track's worktree against base; if the diff has changed
    /// since the last status check, emit a `code-change` artifact and
    /// return the new artifact id. Otherwise return `None`.
    ///
    /// This is the explicit edit-batch coalescer (see module docstring
    /// for the rationale).
    pub async fn check_track_status(
        self: &Arc<Self>,
        track_id: TrackId,
    ) -> Result<Option<ArtifactId>, CoreError> {
        let track = self
            .projector
            .track(track_id)
            .ok_or_else(|| CoreError::NotFound(track_id.to_string()))?;
        // Archived / merged tracks: drop any in-memory state and bail.
        // This is the opportunistic cleanup path that keeps the
        // signature map bounded across long-lived processes (an
        // event-driven cleanup hook lives in `forget_track` for callers
        // that want to drive it explicitly).
        if matches!(track.state, TrackState::Archived | TrackState::Merged) {
            forget_track(track_id);
            return Ok(None);
        }
        let workspace = self
            .projector
            .workspace(track.workspace_id)
            .ok_or_else(|| CoreError::NotFound(track.workspace_id.to_string()))?;
        let ops = current_git_ops();
        let status = ops
            .current_status(&track.worktree_path, &workspace.base_branch)
            .await
            .map_err(map_git_err)?;
        let signature = signature_for(&status);
        {
            let mut sigs = batch_signatures().lock();
            if sigs.get(&track_id) == Some(&signature) {
                return Ok(None);
            }
            sigs.insert(track_id, signature);
        }
        if status.is_empty() {
            return Ok(None);
        }
        let title = match status.files.len() {
            1 => format!("Edited {}", status.files[0].path.display()),
            n => format!("Edited {n} files"),
        };
        let summary = format!(
            "+{} −{} across {} file{}",
            status.added_total,
            status.removed_total,
            status.files.len(),
            if status.files.len() == 1 { "" } else { "s" }
        );
        let body = status
            .files
            .iter()
            .map(|f| format!("{}\t+{}\t-{}", f.path.display(), f.added, f.removed))
            .collect::<Vec<_>>()
            .join("\n");
        let artifact_id = ArtifactId::new();
        // Route through the on-device summary hook so the rail's edit-batch
        // summary reads as an LLM line ("Refactored Tauri command
        // registration…") instead of the raw `+12 −3 across 2 files` diff
        // stat. The hook handles the 500ms deadline + late-return
        // ArtifactUpdated + per-track debounce.
        let draft = crate::core_local::ArtifactDraft {
            workspace_id: track.workspace_id,
            artifact_id,
            kind: ArtifactKind::CodeChange,
            title,
            summary,
            payload: PayloadRef::inline(body),
            author_role: Some(author_roles::TRACK.into()),
        };
        self.append_artifact_with_summary_hook(draft).await?;
        Ok(Some(artifact_id))
    }

    /// Helper for tests / future coalescer hooks: peek the parent repo
    /// path the workspace would use without requiring a link.
    pub fn parent_repo_path(&self, workspace_id: WorkspaceId) -> Result<PathBuf, CoreError> {
        parent_repo_path(workspace_id, self)
    }

    /// Returns the project id for a workspace; convenience for IPC.
    #[allow(dead_code, reason = "read by future cross-track hooks")]
    pub fn workspace_project(&self, workspace_id: WorkspaceId) -> Option<ProjectId> {
        self.projector.workspace(workspace_id).map(|w| w.project_id)
    }
}

/// Forget any in-memory state we hold for a track. Called by the projector
/// shim when a `TrackArchived` event is observed so the per-track signature
/// map doesn't grow unbounded over a long-lived process.
pub fn forget_track(track_id: TrackId) {
    batch_signatures().lock().remove(&track_id);
    requesting_merge_inflight().lock().remove(&track_id);
}

/// Map a `GitError` into `CoreError::Invariant`. We deliberately keep the
/// underlying message — IPC translates to `IpcError::InvalidRequest` — so
/// the frontend can show actionable text ("gh failed: not authenticated").
fn map_git_err(e: GitError) -> CoreError {
    CoreError::Invariant(e.to_string())
}

fn seed_core_docs(worktree: &Path) -> std::io::Result<()> {
    let docs_dir = worktree.join("core-docs");
    if !docs_dir.exists() {
        std::fs::create_dir_all(&docs_dir)?;
    }
    for (rel, body) in SEED_DOC_SOURCES {
        let path = worktree.join(rel);
        if path.exists() {
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, body)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, AppCoreBoot};
    use async_trait::async_trait;
    use designer_git::{DiffEntry, GitResult, PullRequest, Worktree};
    use designer_safety::CostCap;
    use std::sync::Mutex as StdMutex;
    use tempfile::tempdir;

    #[derive(Default)]
    pub(crate) struct FakeGitOps {
        pub validate_repo_ok: StdMutex<bool>,
        pub init_calls: StdMutex<Vec<(PathBuf, String, String, PathBuf)>>,
        pub status_responses: StdMutex<Vec<Status>>,
        pub pr_response: StdMutex<Option<PullRequest>>,
        pub pr_error: StdMutex<Option<GitError>>,
        pub pr_delay: StdMutex<Option<Duration>>,
        pub commit_seed_error: StdMutex<Option<GitError>>,
        pub init_branch_taken: StdMutex<HashSet<String>>,
        pub init_delay: StdMutex<Option<Duration>>,
        pub remove_calls: StdMutex<Vec<PathBuf>>,
    }

    impl FakeGitOps {
        pub(crate) fn new() -> Arc<Self> {
            Arc::new(Self {
                validate_repo_ok: StdMutex::new(true),
                ..Default::default()
            })
        }
    }

    #[async_trait]
    impl GitOps for FakeGitOps {
        async fn init_worktree(
            &self,
            repo: &Path,
            branch: &str,
            base: &str,
            worktree_path: &Path,
        ) -> GitResult<Worktree> {
            let delay = *self.init_delay.lock().unwrap();
            if let Some(d) = delay {
                tokio::time::sleep(d).await;
            }
            {
                let mut taken = self.init_branch_taken.lock().unwrap();
                if !taken.insert(branch.to_string()) {
                    return Err(GitError::GitFailed {
                        command: format!("worktree add -b {branch}"),
                        status: 128,
                        stderr: format!("fatal: a branch named '{branch}' already exists"),
                    });
                }
            }
            std::fs::create_dir_all(worktree_path).map_err(GitError::Io)?;
            self.init_calls.lock().unwrap().push((
                repo.to_path_buf(),
                branch.into(),
                base.into(),
                worktree_path.to_path_buf(),
            ));
            Ok(Worktree {
                path: worktree_path.to_path_buf(),
                branch: branch.into(),
            })
        }
        async fn remove_worktree(&self, _: &Path, worktree_path: &Path) -> GitResult<()> {
            self.remove_calls
                .lock()
                .unwrap()
                .push(worktree_path.to_path_buf());
            // Best-effort: actually delete so the test FS state matches the
            // production behavior of `git worktree remove`.
            let _ = std::fs::remove_dir_all(worktree_path);
            Ok(())
        }
        async fn create_branch(&self, _: &Path, _: &str, _: &str) -> GitResult<()> {
            Ok(())
        }
        async fn commit_all(&self, _: &Path, _: &str) -> GitResult<String> {
            Ok("deadbeef".into())
        }
        async fn diff(&self, _: &Path, _: &str) -> GitResult<Vec<DiffEntry>> {
            Ok(vec![])
        }
        async fn open_pr(&self, _: &Path, title: &str, _: &str, _: &str) -> GitResult<PullRequest> {
            let delay = *self.pr_delay.lock().unwrap();
            if let Some(d) = delay {
                tokio::time::sleep(d).await;
            }
            if let Some(e) = self.pr_error.lock().unwrap().take() {
                return Err(e);
            }
            Ok(self
                .pr_response
                .lock()
                .unwrap()
                .clone()
                .unwrap_or(PullRequest {
                    number: 7,
                    url: "https://example.com/pr/7".into(),
                    title: title.into(),
                }))
        }
        async fn validate_repo(&self, path: &Path) -> GitResult<()> {
            if *self.validate_repo_ok.lock().unwrap() {
                Ok(())
            } else {
                Err(GitError::NotARepo(path.to_path_buf()))
            }
        }
        async fn commit_seed_docs(&self, _: &Path, _: &str) -> GitResult<Option<String>> {
            if let Some(e) = self.commit_seed_error.lock().unwrap().take() {
                return Err(e);
            }
            Ok(Some("seedcommit".into()))
        }
        async fn current_status(&self, _: &Path, _: &str) -> GitResult<Status> {
            Ok(self
                .status_responses
                .lock()
                .unwrap()
                .pop()
                .unwrap_or_default())
        }
    }

    /// Serializes tests in this module: the GitOps override is a
    /// process-global, and parallel test runs would race the shared
    /// fake. Each test takes the guard for its full duration.
    fn test_lock() -> &'static tokio::sync::Mutex<()> {
        static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    async fn boot_test_core() -> Arc<AppCore> {
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        AppCore::boot(config).await.unwrap()
    }

    async fn seed_workspace_with_repo(
        core: &AppCore,
    ) -> (designer_core::ProjectId, WorkspaceId, PathBuf) {
        let repo_dir = tempdir().unwrap();
        // Canonicalize: macOS tempdirs return /var/... which symlinks to
        // /private/var/... and link_repo canonicalizes before persisting.
        let repo_path = std::fs::canonicalize(repo_dir.path()).unwrap();
        std::mem::forget(repo_dir);
        let project = core
            .create_project("Designer".into(), repo_path.clone())
            .await
            .unwrap();
        let workspace = core
            .create_workspace(project.id, "phase-13e".into(), "main".into())
            .await
            .unwrap();
        let fake = FakeGitOps::new();
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        core.link_repo(workspace.id, repo_path.clone())
            .await
            .unwrap();
        (project.id, workspace.id, repo_path)
    }

    #[tokio::test]
    async fn track_lifecycle_round_trip() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;

        let track_id = core
            .start_track(ws, "feature/a".into(), None)
            .await
            .unwrap();
        let track = core.get_track(track_id).await.expect("track exists");
        assert_eq!(track.state, TrackState::Active);
        assert_eq!(track.branch, "feature/a");

        // PR opens.
        let pr_number = core.request_merge(track_id).await.unwrap();
        assert_eq!(pr_number, 7);
        let track = core.get_track(track_id).await.expect("track exists");
        assert_eq!(track.state, TrackState::PrOpen);
        assert_eq!(track.pr_number, Some(7));

        // Replay-derived list contains the track.
        let listed = core.list_tracks(ws).await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, track_id);

        // Mark complete and archived directly via the event store to
        // exercise the projection path; the production trigger lands in a
        // later phase but the projection update is part of 13.E.
        let env = core
            .store
            .append(
                StreamId::Workspace(ws),
                None,
                Actor::system(),
                EventPayload::TrackCompleted { track_id },
            )
            .await
            .unwrap();
        core.projector.apply(&env);
        assert_eq!(
            core.get_track(track_id).await.unwrap().state,
            TrackState::Merged
        );
        let env = core
            .store
            .append(
                StreamId::Workspace(ws),
                None,
                Actor::system(),
                EventPayload::TrackArchived { track_id },
            )
            .await
            .unwrap();
        core.projector.apply(&env);
        assert_eq!(
            core.get_track(track_id).await.unwrap().state,
            TrackState::Archived
        );
    }

    #[tokio::test]
    async fn pr_open_emits_pr_artifact() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        let track_id = core
            .start_track(ws, "feature/b".into(), None)
            .await
            .unwrap();
        let before = core.list_artifacts(ws).await.len();
        core.request_merge(track_id).await.unwrap();
        let after = core.list_artifacts(ws).await;
        let new_artifacts: Vec<_> = after
            .iter()
            .filter(|a| matches!(a.kind, designer_core::ArtifactKind::Pr))
            .collect();
        assert_eq!(after.len(), before + 1);
        assert_eq!(new_artifacts.len(), 1);
        assert!(new_artifacts[0].title.contains("#7"));
    }

    #[tokio::test]
    async fn edit_batch_emits_one_artifact_per_unique_diff() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        // Two distinct diffs, then a repeat of the second.
        let s1 = Status {
            files: vec![DiffEntry {
                path: PathBuf::from("a.rs"),
                added: 3,
                removed: 1,
            }],
            added_total: 3,
            removed_total: 1,
        };
        let s2 = Status {
            files: vec![
                DiffEntry {
                    path: PathBuf::from("a.rs"),
                    added: 4,
                    removed: 1,
                },
                DiffEntry {
                    path: PathBuf::from("b.rs"),
                    added: 2,
                    removed: 0,
                },
            ],
            added_total: 6,
            removed_total: 1,
        };
        // FakeGitOps pops from the end → push in reverse.
        fake.status_responses.lock().unwrap().push(s2.clone());
        fake.status_responses.lock().unwrap().push(s2.clone());
        fake.status_responses.lock().unwrap().push(s1.clone());
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        // Re-install the fake (seed_workspace_with_repo replaced it for link_repo).
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/c".into(), None)
            .await
            .unwrap();

        let first = core.check_track_status(track_id).await.unwrap();
        assert!(first.is_some(), "first diff should emit");
        let second = core.check_track_status(track_id).await.unwrap();
        assert!(second.is_some(), "second diff (different) should emit");
        let third = core.check_track_status(track_id).await.unwrap();
        assert!(
            third.is_none(),
            "repeat diff should not re-emit a duplicate code-change artifact"
        );
        let code_changes: Vec<_> = core
            .list_artifacts(ws)
            .await
            .into_iter()
            .filter(|a| matches!(a.kind, designer_core::ArtifactKind::CodeChange))
            .collect();
        assert_eq!(
            code_changes.len(),
            2,
            "exactly two code-change artifacts for two distinct diffs"
        );
    }

    /// Regression test for a previous coarse signature (file count + total
    /// +/-) that collided when two distinct diffs touched the same paths
    /// with identical totals. Now the per-file +/- enters the signature so
    /// both batches survive.
    #[tokio::test]
    async fn edit_batch_signature_distinguishes_same_total_different_distribution() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        // Same paths, same totals (+3/-1 across two files), different
        // per-file distribution.
        let s1 = Status {
            files: vec![
                DiffEntry {
                    path: PathBuf::from("a.rs"),
                    added: 3,
                    removed: 1,
                },
                DiffEntry {
                    path: PathBuf::from("b.rs"),
                    added: 0,
                    removed: 0,
                },
            ],
            added_total: 3,
            removed_total: 1,
        };
        let s2 = Status {
            files: vec![
                DiffEntry {
                    path: PathBuf::from("a.rs"),
                    added: 0,
                    removed: 0,
                },
                DiffEntry {
                    path: PathBuf::from("b.rs"),
                    added: 3,
                    removed: 1,
                },
            ],
            added_total: 3,
            removed_total: 1,
        };
        fake.status_responses.lock().unwrap().push(s2);
        fake.status_responses.lock().unwrap().push(s1);
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/sig".into(), None)
            .await
            .unwrap();
        assert!(core.check_track_status(track_id).await.unwrap().is_some());
        assert!(core.check_track_status(track_id).await.unwrap().is_some());
        let code_changes: Vec<_> = core
            .list_artifacts(ws)
            .await
            .into_iter()
            .filter(|a| matches!(a.kind, designer_core::ArtifactKind::CodeChange))
            .collect();
        assert_eq!(
            code_changes.len(),
            2,
            "per-file +/- must distinguish redistributed diffs"
        );
    }

    #[tokio::test]
    async fn link_repo_rejects_non_repo_path() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        *fake.validate_repo_ok.lock().unwrap() = false;
        set_git_ops_for_tests(fake as Arc<dyn GitOps>);
        let project = core
            .create_project("X".into(), "/tmp".into())
            .await
            .unwrap();
        let workspace = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        // canonicalize() must succeed first; /tmp exists. Then validate_repo
        // returns the rejection.
        let res = core.link_repo(workspace.id, "/tmp".into()).await;
        assert!(res.is_err(), "non-repo path must be rejected");
    }

    #[tokio::test]
    async fn unlink_repo_clears_worktree_and_emits_detached_event() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let (_pid, ws, repo) = seed_workspace_with_repo(&core).await;
        // Sanity: link_repo set the projection.
        assert_eq!(
            core.projector.workspace(ws).unwrap().worktree_path.as_ref(),
            Some(&repo)
        );

        core.unlink_repo(ws).await.unwrap();
        assert!(
            core.projector
                .workspace(ws)
                .unwrap()
                .worktree_path
                .is_none(),
            "projection's worktree_path cleared after unlink"
        );
        let stored = core
            .store
            .read_all(designer_core::StreamOptions::default())
            .await
            .unwrap();
        let detached: Vec<_> = stored
            .iter()
            .filter(|env| {
                matches!(
                    env.payload,
                    designer_core::EventPayload::WorkspaceWorktreeDetached { .. }
                )
            })
            .collect();
        assert_eq!(detached.len(), 1, "exactly one detached event emitted");
    }

    #[tokio::test]
    async fn unlink_repo_is_idempotent_when_already_unlinked() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        core.unlink_repo(ws).await.unwrap();
        // Second call must succeed without emitting a duplicate event.
        core.unlink_repo(ws).await.unwrap();
        let stored = core
            .store
            .read_all(designer_core::StreamOptions::default())
            .await
            .unwrap();
        let detached_count = stored
            .iter()
            .filter(|env| {
                matches!(
                    env.payload,
                    designer_core::EventPayload::WorkspaceWorktreeDetached { .. }
                )
            })
            .count();
        assert_eq!(
            detached_count, 1,
            "second unlink must be a no-op success — no duplicate event"
        );
    }

    #[tokio::test]
    async fn unlink_repo_rejects_unknown_workspace() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let res = core.unlink_repo(WorkspaceId::new()).await;
        assert!(matches!(res, Err(CoreError::NotFound(_))));
    }

    #[tokio::test]
    async fn link_repo_canonicalizes_symlinked_path() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        set_git_ops_for_tests(fake as Arc<dyn GitOps>);
        let real = tempdir().unwrap();
        let real_path = real.path().to_path_buf();
        std::mem::forget(real);
        let link_dir = tempdir().unwrap();
        let link_path = link_dir.path().join("via-symlink");
        std::os::unix::fs::symlink(&real_path, &link_path).unwrap();
        std::mem::forget(link_dir);

        let project = core
            .create_project("X".into(), real_path.clone())
            .await
            .unwrap();
        let workspace = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        core.link_repo(workspace.id, link_path).await.unwrap();
        let stored = core
            .projector
            .workspace(workspace.id)
            .unwrap()
            .worktree_path
            .unwrap();
        let canonical_real = std::fs::canonicalize(&real_path).unwrap();
        assert_eq!(stored, canonical_real, "stored path is canonical");
    }

    #[tokio::test]
    async fn start_track_requires_linked_repo() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let project = core
            .create_project("X".into(), "/tmp".into())
            .await
            .unwrap();
        let workspace = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let res = core
            .start_track(workspace.id, "feature/x".into(), None)
            .await;
        assert!(matches!(res, Err(CoreError::NotFound(_))));
    }

    #[tokio::test]
    async fn start_track_rejects_branches_with_leading_dash() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        let res = core
            .start_track(ws, "--upload-pack=evil".into(), None)
            .await;
        match res {
            Err(CoreError::Invariant(msg)) => assert!(msg.contains("must not start with '-'")),
            other => panic!("expected Invariant error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn start_track_rejects_branch_with_whitespace() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        let res = core.start_track(ws, "bad branch".into(), None).await;
        match res {
            Err(CoreError::Invariant(msg)) => assert!(msg.contains("invalid characters")),
            other => panic!("expected Invariant error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn concurrent_start_track_same_branch_one_succeeds_one_fails_clean() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        // Slow init so both calls actually overlap inside the per-repo lock.
        *fake.init_delay.lock().unwrap() = Some(Duration::from_millis(50));
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);

        let core_a = core.clone();
        let core_b = core.clone();
        let fut_a =
            tokio::spawn(async move { core_a.start_track(ws, "feature/race".into(), None).await });
        let fut_b =
            tokio::spawn(async move { core_b.start_track(ws, "feature/race".into(), None).await });
        let r_a = fut_a.await.unwrap();
        let r_b = fut_b.await.unwrap();
        let oks = [&r_a, &r_b].iter().filter(|r| r.is_ok()).count();
        let errs = [&r_a, &r_b].iter().filter(|r| r.is_err()).count();
        assert_eq!(
            oks, 1,
            "exactly one start_track succeeds: {r_a:?} / {r_b:?}"
        );
        assert_eq!(
            errs, 1,
            "the other returns a clean error: {r_a:?} / {r_b:?}"
        );
        // Only one track was projected.
        let tracks = core.list_tracks(ws).await;
        assert_eq!(tracks.len(), 1);
    }

    #[tokio::test]
    async fn start_track_rolls_back_worktree_when_seed_commit_fails() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        // First commit_seed_docs call fails — link_repo's path doesn't go
        // through commit_seed_docs, so seeding the start_track call fails
        // and the worktree must be removed.
        *fake.commit_seed_error.lock().unwrap() = Some(GitError::GitFailed {
            command: "commit".into(),
            status: 128,
            stderr: "fatal: cannot commit".into(),
        });
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);

        let res = core.start_track(ws, "feature/rollback".into(), None).await;
        assert!(res.is_err(), "seed commit failure must propagate");
        // remove_worktree was called by the cleanup path.
        let removed = fake.remove_calls.lock().unwrap().clone();
        assert_eq!(removed.len(), 1, "rollback removed exactly one worktree");
        // No TrackStarted event was projected.
        assert!(core.list_tracks(ws).await.is_empty());
    }

    #[tokio::test]
    async fn request_merge_dedupes_concurrent_calls() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        *fake.pr_delay.lock().unwrap() = Some(Duration::from_millis(100));
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/dup".into(), None)
            .await
            .unwrap();
        let core_a = core.clone();
        let core_b = core.clone();
        let fut_a = tokio::spawn(async move { core_a.request_merge(track_id).await });
        // Give A a moment to claim the inflight slot.
        tokio::time::sleep(Duration::from_millis(10)).await;
        let fut_b = tokio::spawn(async move { core_b.request_merge(track_id).await });
        let r_a = fut_a.await.unwrap();
        let r_b = fut_b.await.unwrap();
        let oks = [&r_a, &r_b].iter().filter(|r| r.is_ok()).count();
        let errs = [&r_a, &r_b].iter().filter(|r| r.is_err()).count();
        assert_eq!(oks, 1, "first call wins: {r_a:?} / {r_b:?}");
        assert_eq!(errs, 1, "second call short-circuits: {r_a:?} / {r_b:?}");
    }

    #[tokio::test]
    async fn request_merge_times_out_on_stalled_gh() {
        let _g = test_lock().lock().await;
        // Tighten the timeout so the test runs in milliseconds; restore
        // before exiting so subsequent tests use the production default.
        set_gh_timeout_for_tests(Duration::from_millis(50));
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        // Delay much longer than the test timeout.
        *fake.pr_delay.lock().unwrap() = Some(Duration::from_secs(2));
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/timeout".into(), None)
            .await
            .unwrap();
        let res = core.request_merge(track_id).await;
        set_gh_timeout_for_tests(GH_TIMEOUT_DEFAULT);
        match res {
            Err(CoreError::Invariant(msg)) => assert!(msg.contains("timed out"), "{msg}"),
            other => panic!("expected timeout, got {other:?}"),
        }
        // Track must still be Active so the user can retry.
        let track = core.get_track(track_id).await.unwrap();
        assert_eq!(track.state, TrackState::Active);
    }

    #[tokio::test]
    async fn request_merge_surfaces_gh_already_exists() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        *fake.pr_error.lock().unwrap() = Some(GitError::GhFailed {
            command: "pr create".into(),
            status: 1,
            stderr: "a pull request for branch \"feature/exists\" already exists".into(),
        });
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/exists".into(), None)
            .await
            .unwrap();
        let res = core.request_merge(track_id).await;
        match res {
            Err(CoreError::Invariant(msg)) => {
                assert!(msg.contains("already exists"), "preserves gh stderr: {msg}");
            }
            other => panic!("expected Invariant carrying gh stderr, got {other:?}"),
        }
        // Track must stay Active so the user can resolve manually.
        assert_eq!(
            core.get_track(track_id).await.unwrap().state,
            TrackState::Active
        );
    }

    #[tokio::test]
    async fn request_merge_surfaces_gh_auth_failure() {
        let _g = test_lock().lock().await;
        let core = boot_test_core().await;
        let fake = FakeGitOps::new();
        *fake.pr_error.lock().unwrap() = Some(GitError::GhFailed {
            command: "pr create".into(),
            status: 4,
            stderr: "gh auth login required".into(),
        });
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/auth".into(), None)
            .await
            .unwrap();
        let res = core.request_merge(track_id).await;
        match res {
            Err(CoreError::Invariant(msg)) => assert!(msg.contains("auth login")),
            other => panic!("expected gh auth error, got {other:?}"),
        }
    }

    /// F4: counting `LocalOps` injected via the AppCore helper seam; one
    /// `summarize_row` call per `CodeChange` emit when the helper is Live.
    /// Locks `check_track_status` against future regressions where someone
    /// might re-introduce a direct `store.append` and bypass the on-device
    /// summary hook.
    #[tokio::test]
    async fn check_track_status_routes_through_summary_hook() {
        use crate::core::HelperStatusKind;
        use crate::core_local::tests::boot_with_local_ops;
        use crate::test_support::CountingOps;
        use designer_local_models::{FoundationHelper, LocalOps, NullHelper};
        use std::sync::atomic::Ordering;

        let _g = test_lock().lock().await;
        let counting_ops = Arc::new(CountingOps::default());
        let local_ops: Arc<dyn LocalOps> = counting_ops.clone();
        let null_helper: Arc<dyn FoundationHelper> = Arc::new(NullHelper::default());
        let core = boot_with_local_ops(null_helper, local_ops, HelperStatusKind::Live).await;

        // One status snapshot → one CodeChange emit. The 2-second per-track
        // debounce window short-circuits a quick second call into a cache
        // hit, so we assert routing on the first emit; the cache behavior
        // is covered by core_local's debounce tests.
        let s1 = Status {
            files: vec![DiffEntry {
                path: PathBuf::from("a.rs"),
                added: 3,
                removed: 1,
            }],
            added_total: 3,
            removed_total: 1,
        };
        let fake = FakeGitOps::new();
        fake.status_responses.lock().unwrap().push(s1);
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let (_pid, ws, _repo) = seed_workspace_with_repo(&core).await;
        set_git_ops_for_tests(fake.clone() as Arc<dyn GitOps>);
        let track_id = core
            .start_track(ws, "feature/sum".into(), None)
            .await
            .unwrap();

        assert!(core.check_track_status(track_id).await.unwrap().is_some());

        // One summarize_row call for the one CodeChange emit. If the call
        // ever drops back to a direct `store.append` that bypasses the
        // hook seam, this counter stays at zero.
        assert_eq!(
            counting_ops.summarize_calls.load(Ordering::SeqCst),
            1,
            "summary hook should fire once per check_track_status emit"
        );

        // The artifact's summary must be the LLM line, not the raw diff
        // stat — proving the hook actually mutated the row before append.
        let arts = core.list_artifacts(ws).await;
        let code_change = arts
            .iter()
            .find(|a| matches!(a.kind, designer_core::ArtifactKind::CodeChange))
            .expect("at least one code-change artifact");
        assert_eq!(code_change.summary, "summary line");

        // Routing through the hook intentionally shifts the actor from
        // `Actor::user()` (legacy direct-append) to `Actor::system()` (the
        // hook's append_artifact_inner attribution). Lock that semantics
        // so a future revert to Actor::user can't slip through.
        let stored = core
            .store
            .read_all(designer_core::StreamOptions::default())
            .await
            .unwrap();
        let cc_event = stored
            .iter()
            .find(|env| {
                matches!(
                    env.payload,
                    designer_core::EventPayload::ArtifactCreated {
                        artifact_kind: designer_core::ArtifactKind::CodeChange,
                        ..
                    }
                )
            })
            .expect("CodeChange event in store");
        assert_eq!(cc_event.actor, Actor::system());
    }
}
