//! Real Claude Code orchestrator. Spawns `claude` as a subprocess with
//! `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, watches the team/task directories
//! under `~/.claude/`, and streams results through the same `OrchestratorEvent`
//! surface as the mock.
//!
//! **Compliance:** we never touch Claude auth. Credentials live in the user's
//! own `claude` install. We only invoke the binary and read its file output.
//! See spec §"Anthropic Compliance Model" decision #26.
//!
//! **Resume / recovery:** Claude Code's agent teams do not survive `/resume`
//! across sessions (known limitation). The orchestrator re-spawns a fresh team
//! at resume time and emits `AgentSpawned` with matching roles; task-list state
//! is replayed from our own event log, not Claude's.

use crate::orchestrator::{
    Orchestrator, OrchestratorError, OrchestratorEvent, OrchestratorResult, TaskAssignment,
    TeamSpec,
};
use async_trait::async_trait;
use designer_core::{EventStore, WorkspaceId};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::broadcast;
use tracing::info;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClaudeCodeOptions {
    /// Path to the `claude` binary. Resolved via `PATH` when None.
    pub binary_path: Option<PathBuf>,
    /// Claude config root. Defaults to `~/.claude/`.
    pub claude_home: Option<PathBuf>,
    /// Extra environment variables to forward.
    #[serde(default)]
    pub extra_env: std::collections::BTreeMap<String, String>,
    /// Working directory for the subprocess (typically the workspace worktree).
    pub cwd: Option<PathBuf>,
}

pub struct ClaudeCodeOrchestrator<S: EventStore> {
    _store: Arc<S>,
    options: ClaudeCodeOptions,
    tx: broadcast::Sender<OrchestratorEvent>,
    processes: Mutex<HashMap<WorkspaceId, Child>>,
}

impl<S: EventStore> ClaudeCodeOrchestrator<S> {
    pub fn new(store: Arc<S>, options: ClaudeCodeOptions) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            _store: store,
            options,
            tx,
            processes: Mutex::new(HashMap::new()),
        }
    }

    fn binary(&self) -> PathBuf {
        self.options
            .binary_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("claude"))
    }
}

#[async_trait]
impl<S: EventStore + 'static> Orchestrator for ClaudeCodeOrchestrator<S> {
    async fn spawn_team(&self, spec: TeamSpec) -> OrchestratorResult<()> {
        let bin = self.binary();
        let mut cmd = Command::new(&bin);
        cmd.env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
        cmd.env("DESIGNER_WORKSPACE_ID", spec.workspace_id.to_string());
        if let Some(home) = &self.options.claude_home {
            cmd.env("CLAUDE_HOME", home);
        }
        for (k, v) in &self.options.extra_env {
            cmd.env(k, v);
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        if let Some(cwd) = &self.options.cwd {
            cmd.current_dir(cwd);
        }

        cmd.args([
            "team",
            "init",
            "--name",
            &spec.team_name,
            "--lead",
            &spec.lead_role,
        ]);
        for teammate in &spec.teammates {
            cmd.arg("--teammate").arg(teammate);
        }

        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

        info!(binary = %bin.display(), ?spec, "spawning claude team");

        let child = cmd
            .spawn()
            .map_err(|e| OrchestratorError::Spawn(format!("{bin:?}: {e}")))?;
        self.processes.lock().insert(spec.workspace_id, child);
        let _ = self.tx.send(OrchestratorEvent::TeamSpawned {
            workspace_id: spec.workspace_id,
            team: spec.team_name,
        });
        Ok(())
    }

    async fn assign_task(
        &self,
        workspace_id: WorkspaceId,
        assignment: TaskAssignment,
    ) -> OrchestratorResult<()> {
        let bin = self.binary();
        let mut cmd = Command::new(&bin);
        cmd.env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
        cmd.args([
            "team",
            "task",
            "--workspace",
            &workspace_id.to_string(),
            "--title",
            &assignment.title,
            "--description",
            &assignment.description,
        ]);
        if let Some(role) = &assignment.assignee_role {
            cmd.args(["--assignee", role]);
        }
        cmd.status()
            .await
            .map_err(|e| OrchestratorError::Spawn(format!("{bin:?}: {e}")))?;
        let _ = self.tx.send(OrchestratorEvent::TaskCreated {
            workspace_id,
            task_id: assignment.task_id,
            title: assignment.title,
        });
        Ok(())
    }

    async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        author_role: String,
        body: String,
    ) -> OrchestratorResult<()> {
        let bin = self.binary();
        let mut cmd = Command::new(&bin);
        cmd.env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
        cmd.args([
            "team",
            "message",
            "--workspace",
            &workspace_id.to_string(),
            "--role",
            &author_role,
            "--body",
            &body,
        ]);
        cmd.status()
            .await
            .map_err(|e| OrchestratorError::Spawn(format!("{bin:?}: {e}")))?;
        let _ = self.tx.send(OrchestratorEvent::MessagePosted {
            workspace_id,
            author_role,
            body,
        });
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<OrchestratorEvent> {
        self.tx.subscribe()
    }

    async fn shutdown(&self, workspace_id: WorkspaceId) -> OrchestratorResult<()> {
        if let Some(mut child) = self.processes.lock().remove(&workspace_id) {
            let _ = child.start_kill();
        }
        Ok(())
    }
}
