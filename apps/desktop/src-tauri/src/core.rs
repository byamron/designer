//! `AppCore` is the wiring hub: one event store, one projector, one
//! orchestrator (Claude Code or mock), one safety apparatus, one local-model
//! helper. Consumers (the Tauri shell, the CLI, tests) hold one `AppCore` and
//! call typed methods.

use async_trait::async_trait;
use designer_audit::{AuditLog, SqliteAuditLog};
use designer_claude::{
    ClaudeCodeOptions, ClaudeCodeOrchestrator, MockOrchestrator, Orchestrator,
};
use designer_core::{
    Actor, EventPayload, EventStore, Projection, Projector, ProjectId, SqliteEventStore, StreamId,
    StreamOptions, Tab, TabId, TabTemplate, Workspace, WorkspaceId,
};
use designer_ipc::{SpineAltitude, SpineRow, SpineState};
use designer_local_models::{FoundationHelper, NullHelper};
use designer_safety::{CostCap, CostTracker, InMemoryApprovalGate};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub data_dir: PathBuf,
    pub use_mock_orchestrator: bool,
    #[serde(default)]
    pub claude_options: ClaudeCodeOptions,
    pub default_cost_cap: CostCap,
}

impl AppConfig {
    pub fn default_in_home() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        Self {
            data_dir: PathBuf::from(home).join(".designer"),
            use_mock_orchestrator: true,
            claude_options: ClaudeCodeOptions::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: Some(10_00),
                max_tokens: Some(1_000_000),
            },
        }
    }
}

pub struct AppCore {
    pub config: AppConfig,
    pub store: Arc<SqliteEventStore>,
    pub projector: Projector,
    pub orchestrator: Arc<dyn Orchestrator>,
    pub audit: Arc<dyn AuditLog>,
    pub gate: Arc<InMemoryApprovalGate<SqliteEventStore>>,
    pub cost: CostTracker<SqliteEventStore>,
    pub helper: Arc<dyn FoundationHelper>,
}

#[async_trait]
pub trait AppCoreBoot {
    async fn boot(config: AppConfig) -> designer_core::Result<Arc<AppCore>>;
}

#[async_trait]
impl AppCoreBoot for AppCore {
    async fn boot(config: AppConfig) -> designer_core::Result<Arc<AppCore>> {
        let store = Arc::new(SqliteEventStore::open(config.data_dir.join("events.db"))?);
        let projector = Projector::new();

        // Replay history into the projector before live events.
        let history = store.read_all(StreamOptions::default()).await?;
        projector.replay(&history);

        let orchestrator: Arc<dyn Orchestrator> = if config.use_mock_orchestrator {
            Arc::new(MockOrchestrator::new(store.clone()))
        } else {
            Arc::new(ClaudeCodeOrchestrator::new(
                store.clone(),
                config.claude_options.clone(),
            ))
        };

        let audit: Arc<dyn AuditLog> = Arc::new(SqliteAuditLog::new(store.clone()));
        let gate = Arc::new(InMemoryApprovalGate::new(store.clone()));
        let cost = CostTracker::new(store.clone(), config.default_cost_cap);
        let helper: Arc<dyn FoundationHelper> = Arc::new(NullHelper::default());

        let core = Arc::new(AppCore {
            config,
            store,
            projector,
            orchestrator,
            audit,
            gate,
            cost,
            helper,
        });
        core.spawn_projector_task();
        info!("app core booted");
        Ok(core)
    }
}

impl AppCore {
    fn spawn_projector_task(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            let mut rx = me.store.subscribe();
            while let Ok(event) = rx.recv().await {
                me.projector.apply(&event);
            }
        });
    }

    pub async fn create_project(
        &self,
        name: String,
        root_path: PathBuf,
    ) -> designer_core::Result<designer_core::Project> {
        let id = ProjectId::new();
        let env = self
            .store
            .append(
                StreamId::Project(id),
                None,
                Actor::user(),
                EventPayload::ProjectCreated {
                    project_id: id,
                    name,
                    root_path,
                },
            )
            .await?;
        // Apply synchronously so the caller's subsequent read sees the write,
        // independent of the broadcast-subscriber task scheduling.
        self.projector.apply(&env);
        self.projector
            .project(id)
            .ok_or_else(|| designer_core::CoreError::NotFound(id.to_string()))
    }

    pub async fn create_workspace(
        &self,
        project_id: ProjectId,
        name: String,
        base_branch: String,
    ) -> designer_core::Result<Workspace> {
        let id = WorkspaceId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(id),
                None,
                Actor::user(),
                EventPayload::WorkspaceCreated {
                    workspace_id: id,
                    project_id,
                    name,
                    base_branch,
                },
            )
            .await?;
        self.projector.apply(&env);
        self.projector
            .workspace(id)
            .ok_or_else(|| designer_core::CoreError::NotFound(id.to_string()))
    }

    pub async fn list_projects(&self) -> Vec<designer_core::Project> {
        self.projector.projects()
    }

    pub async fn workspaces_in(&self, project_id: ProjectId) -> Vec<Workspace> {
        self.projector.workspaces_in(project_id)
    }

    pub async fn open_tab(
        &self,
        workspace_id: WorkspaceId,
        title: String,
        template: TabTemplate,
    ) -> designer_core::Result<Tab> {
        let tab_id = TabId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id,
                    workspace_id,
                    title,
                    template,
                },
            )
            .await?;
        self.projector.apply(&env);
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| designer_core::CoreError::NotFound(workspace_id.to_string()))?;
        workspace
            .tabs
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| designer_core::CoreError::NotFound(tab_id.to_string()))
    }

    /// Derive an activity-spine view from the projector. Summaries are `None`
    /// here; Phase 13.F replaces them with `LocalOps::summarize_row` output.
    pub async fn spine(&self, workspace_id: Option<WorkspaceId>) -> Vec<SpineRow> {
        match workspace_id {
            None => self
                .projector
                .projects()
                .into_iter()
                .map(|p| {
                    let count = self.projector.workspaces_in(p.id).len();
                    SpineRow {
                        id: p.id.to_string(),
                        altitude: SpineAltitude::Project,
                        label: p.name,
                        summary: Some(format!(
                            "{count} workspace{}",
                            if count == 1 { "" } else { "s" }
                        )),
                        state: SpineState::Idle,
                        children: vec![],
                    }
                })
                .collect(),
            Some(id) => {
                // Workspace-altitude view: one row per agent is Phase-13 territory;
                // until then, return a single placeholder row keyed to the
                // workspace itself so the surface renders without stubs.
                let Some(w) = self.projector.workspace(id) else {
                    return vec![];
                };
                vec![SpineRow {
                    id: w.id.to_string(),
                    altitude: SpineAltitude::Workspace,
                    label: w.name,
                    summary: Some(format!("state: {:?}", w.state).to_lowercase()),
                    state: match w.state {
                        designer_core::WorkspaceState::Active => SpineState::Active,
                        designer_core::WorkspaceState::Paused => SpineState::Idle,
                        designer_core::WorkspaceState::Archived => SpineState::Idle,
                        designer_core::WorkspaceState::Errored => SpineState::Errored,
                    },
                    children: vec![],
                }]
            }
        }
    }

    /// Full replay — used when an external writer (tests, repair tools) modifies
    /// the log outside `AppCore`. In the steady state, `apply` on each append
    /// keeps the projector current without touching the log.
    pub async fn sync_projector_from_log(&self) -> designer_core::Result<()> {
        let all = self.store.read_all(StreamOptions::default()).await?;
        self.projector.replay(&all);
        Ok(())
    }
}
