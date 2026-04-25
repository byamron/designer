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
    Actor, ArtifactId, ArtifactKind, CoreError, EventPayload, EventStore, PayloadRef, ProjectId,
    Projection, StreamId, Track, TrackId, TrackState, WorkspaceId,
};
use designer_git::{GitError, GitOps, RealGitOps, Status};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;

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
/// `TrackId`; value is a stable signature (file count + total +/- lines)
/// of the most recently emitted `code-change` artifact. Re-running
/// `cmd_status_check` with an unchanged signature is a no-op — that's
/// what keeps the projector from gaining duplicate cards on repeat clicks.
fn batch_signatures() -> &'static Mutex<HashMap<TrackId, String>> {
    static MAP: OnceLock<Mutex<HashMap<TrackId, String>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn signature_for(status: &Status) -> String {
    // Cheap canonical signature: file count, total +/-, and a sorted list
    // of paths. Distinguishes "added foo.rs" from "edited foo.rs" only via
    // the +/- counts, which is fine — both legitimately produce a new
    // semantic batch when the totals shift.
    let mut paths: Vec<String> = status
        .files
        .iter()
        .map(|f| f.path.display().to_string())
        .collect();
    paths.sort();
    format!(
        "{}|+{}|-{}|{}",
        status.files.len(),
        status.added_total,
        status.removed_total,
        paths.join(",")
    )
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

impl AppCore {
    /// Validate `repo_path` is a git work-tree and persist the link as a
    /// `WorkspaceWorktreeAttached` event. Pre-existing worktree paths on
    /// the workspace get overwritten — re-linking is supported and
    /// idempotent (replay yields the latest path).
    pub async fn link_repo(
        &self,
        workspace_id: WorkspaceId,
        repo_path: PathBuf,
    ) -> Result<(), CoreError> {
        let ops = current_git_ops();
        ops.validate_repo(&repo_path).await.map_err(map_git_err)?;
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::WorkspaceWorktreeAttached {
                    workspace_id,
                    path: repo_path,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Spawn a new track inside `workspace_id`. Creates a worktree under
    /// `<repo>/.designer/worktrees/<track-id>-<slug>` rooted at `base`,
    /// emits `TrackStarted`, seeds `core-docs/*.md` and commits them on
    /// the new branch. Returns the new track id.
    pub async fn start_track(
        &self,
        workspace_id: WorkspaceId,
        branch: String,
        base: Option<String>,
    ) -> Result<TrackId, CoreError> {
        let repo = require_linked_repo(workspace_id, self)?;
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| CoreError::NotFound(workspace_id.to_string()))?;
        let base = base.unwrap_or(workspace.base_branch.clone());

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

        // Best-effort doc seed: only write files that don't already exist
        // in the base tree. Avoids overwriting curated content on repos
        // that already have a `core-docs/` directory.
        seed_core_docs(&target).map_err(|e| CoreError::Invariant(format!("seed docs: {e}")))?;
        let _ = ops
            .commit_seed_docs(&target, "chore: seed core-docs (Designer)")
            .await
            .map_err(map_git_err)?;

        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TrackStarted {
                    track_id,
                    workspace_id,
                    worktree_path: target,
                    branch,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(track_id)
    }

    /// Request the track's branch be merged. Runs `gh pr create` from the
    /// worktree, emits `PullRequestOpened` on success, and emits a
    /// `pr` artifact summarizing the open PR. On failure the track stays
    /// `Active` so the user can retry from the UI.
    pub async fn request_merge(&self, track_id: TrackId) -> Result<u64, CoreError> {
        let track = self
            .projector
            .track(track_id)
            .ok_or_else(|| CoreError::NotFound(track_id.to_string()))?;
        if !matches!(
            track.state,
            TrackState::Active | TrackState::RequestingMerge
        ) {
            return Err(CoreError::Invariant(format!(
                "track {track_id} is not in a mergeable state ({:?})",
                track.state
            )));
        }
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
        let pr = ops
            .open_pr(&track.worktree_path, &title, &body, &workspace.base_branch)
            .await
            .map_err(map_git_err)?;

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
                    author_role: Some("system".into()),
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
        &self,
        track_id: TrackId,
    ) -> Result<Option<ArtifactId>, CoreError> {
        let track = self
            .projector
            .track(track_id)
            .ok_or_else(|| CoreError::NotFound(track_id.to_string()))?;
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
        let env = self
            .store
            .append(
                StreamId::Workspace(track.workspace_id),
                None,
                Actor::user(),
                EventPayload::ArtifactCreated {
                    artifact_id,
                    workspace_id: track.workspace_id,
                    artifact_kind: ArtifactKind::CodeChange,
                    title,
                    summary,
                    payload: PayloadRef::inline(body),
                    author_role: Some("system".into()),
                },
            )
            .await?;
        self.projector.apply(&env);
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

/// Map a `GitError` into `CoreError::Other`. We deliberately keep the
/// underlying message — IPC translates to `IpcError::Unknown` — so the
/// frontend can show actionable text ("gh failed: not authenticated").
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
        async fn remove_worktree(&self, _: &Path, _: &Path) -> GitResult<()> {
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
        let repo_path = repo_dir.path().to_path_buf();
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

        // First check: empty pop returns default empty Status — no artifact.
        // Reset by re-installing the fake without status responses isn't
        // needed because start_track doesn't consume status. Run the three
        // checks now.
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
        let res = core.link_repo(workspace.id, "/tmp/not-a-repo".into()).await;
        assert!(res.is_err(), "non-repo path must be rejected");
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
        // No link_repo call — start_track should fail with NotFound.
        let res = core
            .start_track(workspace.id, "feature/x".into(), None)
            .await;
        assert!(matches!(res, Err(CoreError::NotFound(_))));
    }
}
