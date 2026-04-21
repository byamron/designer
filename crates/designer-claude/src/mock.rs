//! Deterministic mock orchestrator. Used in tests and in the desktop app's
//! demo mode (no Claude binary required). Emits the full event stream that a
//! real Claude Code team would produce, in predictable order, with configurable
//! delays.

use crate::orchestrator::{
    Orchestrator, OrchestratorError, OrchestratorEvent, OrchestratorResult, TaskAssignment,
    TeamSpec,
};
use async_trait::async_trait;
use designer_core::{
    Actor, AgentId, EventPayload, EventStore, StreamId, TaskId, WorkspaceId,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{debug, info};

type Tx = broadcast::Sender<OrchestratorEvent>;

pub struct MockOrchestrator<S: EventStore> {
    store: Arc<S>,
    tx: Tx,
    teams: Mutex<HashMap<WorkspaceId, TeamSpec>>,
    agents: Mutex<HashMap<WorkspaceId, Vec<AgentId>>>,
    /// Artificial delay used in integration tests. Zero by default.
    pub tick: Duration,
}

impl<S: EventStore> MockOrchestrator<S> {
    pub fn new(store: Arc<S>) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            store,
            tx,
            teams: Mutex::new(HashMap::new()),
            agents: Mutex::new(HashMap::new()),
            tick: Duration::from_millis(0),
        }
    }

    fn emit(&self, event: OrchestratorEvent) {
        let _ = self.tx.send(event);
    }

    async fn pace(&self) {
        if !self.tick.is_zero() {
            tokio::time::sleep(self.tick).await;
        }
    }
}

#[async_trait]
impl<S: EventStore + 'static> Orchestrator for MockOrchestrator<S> {
    async fn spawn_team(&self, spec: TeamSpec) -> OrchestratorResult<()> {
        info!(workspace = %spec.workspace_id, team = %spec.team_name, "mock spawn_team");
        self.teams.lock().insert(spec.workspace_id, spec.clone());

        // Lead
        let lead_id = AgentId::new();
        self.agents
            .lock()
            .entry(spec.workspace_id)
            .or_default()
            .push(lead_id);
        self.store
            .append(
                StreamId::Workspace(spec.workspace_id),
                None,
                Actor::system(),
                EventPayload::AgentSpawned {
                    agent_id: lead_id,
                    workspace_id: spec.workspace_id,
                    team: spec.team_name.clone(),
                    role: spec.lead_role.clone(),
                },
            )
            .await?;
        self.emit(OrchestratorEvent::TeamSpawned {
            workspace_id: spec.workspace_id,
            team: spec.team_name.clone(),
        });
        self.emit(OrchestratorEvent::AgentSpawned {
            workspace_id: spec.workspace_id,
            agent_id: lead_id,
            team: spec.team_name.clone(),
            role: spec.lead_role.clone(),
        });

        // Teammates
        for role in &spec.teammates {
            self.pace().await;
            let id = AgentId::new();
            self.agents
                .lock()
                .entry(spec.workspace_id)
                .or_default()
                .push(id);
            self.store
                .append(
                    StreamId::Workspace(spec.workspace_id),
                    None,
                    Actor::system(),
                    EventPayload::AgentSpawned {
                        agent_id: id,
                        workspace_id: spec.workspace_id,
                        team: spec.team_name.clone(),
                        role: role.clone(),
                    },
                )
                .await?;
            self.emit(OrchestratorEvent::AgentSpawned {
                workspace_id: spec.workspace_id,
                agent_id: id,
                team: spec.team_name.clone(),
                role: role.clone(),
            });
        }
        Ok(())
    }

    async fn assign_task(
        &self,
        workspace_id: WorkspaceId,
        assignment: TaskAssignment,
    ) -> OrchestratorResult<()> {
        debug!(?workspace_id, ?assignment, "mock assign_task");
        let team = self
            .teams
            .lock()
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| OrchestratorError::TeamNotFound(workspace_id.to_string()))?;

        self.store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::agent(&team.team_name, &team.lead_role),
                EventPayload::TaskCreated {
                    task_id: assignment.task_id,
                    workspace_id,
                    title: assignment.title.clone(),
                    assignee: None,
                },
            )
            .await?;
        self.emit(OrchestratorEvent::TaskCreated {
            workspace_id,
            task_id: assignment.task_id,
            title: assignment.title.clone(),
        });

        self.pace().await;
        self.store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::agent(&team.team_name, &team.lead_role),
                EventPayload::TaskCompleted {
                    task_id: assignment.task_id,
                },
            )
            .await?;
        self.emit(OrchestratorEvent::TaskCompleted {
            workspace_id,
            task_id: assignment.task_id,
        });

        // Idle the lead after the task completes.
        if let Some(first) = self
            .agents
            .lock()
            .get(&workspace_id)
            .and_then(|v| v.first().copied())
        {
            self.emit(OrchestratorEvent::TeammateIdle {
                workspace_id,
                agent_id: first,
            });
        }

        Ok(())
    }

    async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        author_role: String,
        body: String,
    ) -> OrchestratorResult<()> {
        let team = self
            .teams
            .lock()
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| OrchestratorError::TeamNotFound(workspace_id.to_string()))?;
        self.store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::agent(&team.team_name, &author_role),
                EventPayload::MessagePosted {
                    workspace_id,
                    author: Actor::agent(&team.team_name, &author_role),
                    body: body.clone(),
                },
            )
            .await?;
        self.emit(OrchestratorEvent::MessagePosted {
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
        self.teams.lock().remove(&workspace_id);
        self.agents.lock().remove(&workspace_id);
        Ok(())
    }
}

// Unused-import suppression for `TaskId` (keeps re-export for clarity).
#[allow(dead_code)]
fn _compile_check(_id: TaskId) {}
