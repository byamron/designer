//! Git operations. We shell out to `git` and `gh` rather than linking libgit2 —
//! two reasons:
//!
//! 1. The user's `git` config, hooks, and credential helpers are already
//!    correct; re-implementing them in-process would surprise the user.
//! 2. `gh` is the sanctioned PR automation surface and cannot be replaced by a
//!    library.
//!
//! The `GitOps` trait lets us inject a fake command runner in tests without
//! touching real repositories.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Output;
use thiserror::Error;
use tokio::process::Command;
use tracing::{debug, instrument};

#[derive(Debug, Error)]
pub enum GitError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("git failed: {command} → status {status}: {stderr}")]
    GitFailed {
        command: String,
        status: i32,
        stderr: String,
    },
    #[error("gh failed: {command} → status {status}: {stderr}")]
    GhFailed {
        command: String,
        status: i32,
        stderr: String,
    },
    #[error("not a git repository: {0}")]
    NotARepo(PathBuf),
}

pub type GitResult<T> = Result<T, GitError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffEntry {
    pub path: PathBuf,
    pub added: usize,
    pub removed: usize,
}

/// Worktree status — files modified since the last `cmd_status_check`. Used by
/// the edit-batch coalescer in `core_git.rs` to summarize a code-change
/// artifact.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Status {
    pub files: Vec<DiffEntry>,
    pub added_total: usize,
    pub removed_total: usize,
}

impl Status {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub url: String,
    pub title: String,
}

#[async_trait]
pub trait GitOps: Send + Sync {
    async fn init_worktree(
        &self,
        repo: &Path,
        branch: &str,
        base: &str,
        worktree_path: &Path,
    ) -> GitResult<Worktree>;
    async fn remove_worktree(&self, repo: &Path, worktree_path: &Path) -> GitResult<()>;
    async fn create_branch(&self, repo: &Path, branch: &str, base: &str) -> GitResult<()>;
    async fn commit_all(&self, repo: &Path, message: &str) -> GitResult<String>;
    async fn diff(&self, repo: &Path, base: &str) -> GitResult<Vec<DiffEntry>>;
    async fn open_pr(
        &self,
        repo: &Path,
        title: &str,
        body: &str,
        base: &str,
    ) -> GitResult<PullRequest>;

    /// Validate that `path` is the root (or inside) a Git working tree. Used
    /// by `cmd_link_repo` so the user gets an early, friendly error before
    /// any worktree creation runs.
    async fn validate_repo(&self, path: &Path) -> GitResult<()>;

    /// Commit the seeded `core-docs/*.md` files in a fresh worktree. The
    /// worktree is brand-new, so a no-op (no staged changes) is allowed —
    /// returns `Ok(None)` in that case so callers can no-op cleanly.
    async fn commit_seed_docs(
        &self,
        worktree_path: &Path,
        message: &str,
    ) -> GitResult<Option<String>>;

    /// Status of the worktree relative to the base branch — committed +
    /// uncommitted changes summarized as a list of files. The edit-batch
    /// coalescer uses this to emit a `code-change` artifact summary.
    async fn current_status(&self, worktree_path: &Path, base: &str) -> GitResult<Status>;
}

pub struct RealGitOps;

impl RealGitOps {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RealGitOps {
    fn default() -> Self {
        Self
    }
}

async fn run(cwd: &Path, program: &str, args: &[&str]) -> GitResult<Output> {
    let mut cmd = Command::new(program);
    cmd.current_dir(cwd);
    cmd.args(args);
    debug!(?cwd, program, ?args, "spawning command");
    let out = cmd.output().await?;
    if !out.status.success() {
        let status = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let command = format!("{program} {}", args.join(" "));
        return Err(match program {
            "gh" => GitError::GhFailed {
                command,
                status,
                stderr,
            },
            _ => GitError::GitFailed {
                command,
                status,
                stderr,
            },
        });
    }
    Ok(out)
}

#[async_trait]
impl GitOps for RealGitOps {
    #[instrument(skip(self))]
    async fn init_worktree(
        &self,
        repo: &Path,
        branch: &str,
        base: &str,
        worktree_path: &Path,
    ) -> GitResult<Worktree> {
        // Ensure base is fetched locally.
        let _ = run(repo, "git", &["fetch", "origin", base]).await;
        run(
            repo,
            "git",
            &[
                "worktree",
                "add",
                "-b",
                branch,
                &worktree_path.display().to_string(),
                base,
            ],
        )
        .await?;
        Ok(Worktree {
            path: worktree_path.to_path_buf(),
            branch: branch.into(),
        })
    }

    async fn remove_worktree(&self, repo: &Path, worktree_path: &Path) -> GitResult<()> {
        run(
            repo,
            "git",
            &["worktree", "remove", &worktree_path.display().to_string()],
        )
        .await?;
        Ok(())
    }

    async fn create_branch(&self, repo: &Path, branch: &str, base: &str) -> GitResult<()> {
        run(repo, "git", &["checkout", "-b", branch, base]).await?;
        Ok(())
    }

    async fn commit_all(&self, repo: &Path, message: &str) -> GitResult<String> {
        run(repo, "git", &["add", "-A"]).await?;
        run(repo, "git", &["commit", "-m", message]).await?;
        let out = run(repo, "git", &["rev-parse", "HEAD"]).await?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn diff(&self, repo: &Path, base: &str) -> GitResult<Vec<DiffEntry>> {
        let out = run(
            repo,
            "git",
            &["diff", "--numstat", &format!("{base}...HEAD")],
        )
        .await?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        let mut entries = Vec::new();
        for line in text.lines() {
            let mut parts = line.split('\t');
            let added = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let removed = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            if let Some(path) = parts.next() {
                entries.push(DiffEntry {
                    path: PathBuf::from(path),
                    added,
                    removed,
                });
            }
        }
        Ok(entries)
    }

    async fn open_pr(
        &self,
        repo: &Path,
        title: &str,
        body: &str,
        base: &str,
    ) -> GitResult<PullRequest> {
        // `gh pr create` doesn't print JSON directly; it prints the PR URL.
        // Capture the URL on stdout, then `gh pr view` for the structured
        // fields. That keeps a single create call (so `gh` does the push +
        // open dance once) without parsing free-form output.
        let create = run(
            repo,
            "gh",
            &[
                "pr", "create", "--title", title, "--body", body, "--base", base,
            ],
        )
        .await?;
        let url = String::from_utf8_lossy(&create.stdout).trim().to_string();
        let view = run(
            repo,
            "gh",
            &["pr", "view", &url, "--json", "number,url,title"],
        )
        .await?;
        let stdout = String::from_utf8_lossy(&view.stdout).to_string();
        let parsed: PullRequest =
            serde_json::from_str(&stdout).map_err(|e| GitError::GhFailed {
                command: "pr view".into(),
                status: 0,
                stderr: format!("parse json: {e}; raw: {stdout}"),
            })?;
        Ok(parsed)
    }

    async fn validate_repo(&self, path: &Path) -> GitResult<()> {
        if !path.exists() {
            return Err(GitError::NotARepo(path.to_path_buf()));
        }
        let out = run(path, "git", &["rev-parse", "--is-inside-work-tree"])
            .await
            .map_err(|_| GitError::NotARepo(path.to_path_buf()))?;
        let txt = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if txt != "true" {
            return Err(GitError::NotARepo(path.to_path_buf()));
        }
        Ok(())
    }

    async fn commit_seed_docs(
        &self,
        worktree_path: &Path,
        message: &str,
    ) -> GitResult<Option<String>> {
        // Stage everything new under the worktree. A fresh `init_worktree`
        // produces a clean tree, so the only changes here are the
        // `core-docs/*.md` files the caller just wrote.
        run(worktree_path, "git", &["add", "-A"]).await?;
        // `git diff --cached --quiet` exits non-zero when there are staged
        // changes, zero when the index is clean. Probe before committing so
        // we don't fail on a no-op (the caller may have skipped seeding when
        // `core-docs/` already existed in the base tree).
        let mut probe = Command::new("git");
        probe.current_dir(worktree_path);
        probe.args(["diff", "--cached", "--quiet"]);
        let probe_status = probe.status().await?;
        if probe_status.success() {
            return Ok(None);
        }
        run(worktree_path, "git", &["commit", "-m", message]).await?;
        let head = run(worktree_path, "git", &["rev-parse", "HEAD"]).await?;
        Ok(Some(
            String::from_utf8_lossy(&head.stdout).trim().to_string(),
        ))
    }

    async fn current_status(&self, worktree_path: &Path, base: &str) -> GitResult<Status> {
        // Includes both committed-on-branch and uncommitted changes vs. the
        // base ref so the coalescer's summary matches the "what changed
        // since this track started" mental model.
        let out = run(
            worktree_path,
            "git",
            &["diff", "--numstat", &format!("{base}...HEAD")],
        )
        .await?;
        let mut files = Vec::new();
        let mut added_total = 0usize;
        let mut removed_total = 0usize;
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let mut parts = line.split('\t');
            let added: usize = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let removed: usize = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            if let Some(path) = parts.next() {
                files.push(DiffEntry {
                    path: PathBuf::from(path),
                    added,
                    removed,
                });
                added_total += added;
                removed_total += removed;
            }
        }
        // Plus uncommitted changes in the worktree.
        let dirty = run(worktree_path, "git", &["diff", "--numstat"]).await?;
        for line in String::from_utf8_lossy(&dirty.stdout).lines() {
            let mut parts = line.split('\t');
            let added: usize = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let removed: usize = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            if let Some(path) = parts.next() {
                files.push(DiffEntry {
                    path: PathBuf::from(path),
                    added,
                    removed,
                });
                added_total += added;
                removed_total += removed;
            }
        }
        Ok(Status {
            files,
            added_total,
            removed_total,
        })
    }
}

/// Simple same-file overlap detection: two branches touched the same path
/// within the last `hours`. Day-one cross-workspace conflict primitive
/// (spec §Product Architecture, Phase 6).
pub async fn recent_overlap(
    repo: &Path,
    branches: &[&str],
    hours: u64,
) -> GitResult<Vec<(String, String, PathBuf)>> {
    let since = format!("--since={hours} hours ago");
    let mut changed_by_branch: std::collections::BTreeMap<
        String,
        std::collections::HashSet<PathBuf>,
    > = Default::default();
    for br in branches {
        let out = run(
            repo,
            "git",
            &["log", &since, "--name-only", "--pretty=format:", br],
        )
        .await?;
        let text = String::from_utf8_lossy(&out.stdout);
        let files: std::collections::HashSet<PathBuf> = text
            .lines()
            .filter(|l| !l.is_empty())
            .map(PathBuf::from)
            .collect();
        changed_by_branch.insert((*br).to_string(), files);
    }
    let names: Vec<String> = changed_by_branch.keys().cloned().collect();
    let mut overlaps = Vec::new();
    for i in 0..names.len() {
        for j in (i + 1)..names.len() {
            let a = &names[i];
            let b = &names[j];
            let sa = &changed_by_branch[a];
            let sb = &changed_by_branch[b];
            for path in sa.intersection(sb) {
                overlaps.push((a.clone(), b.clone(), path.clone()));
            }
        }
    }
    Ok(overlaps)
}
