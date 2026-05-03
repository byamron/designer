//! Deterministic mock orchestrator. Used in tests and in the desktop app's
//! demo mode (no Claude binary required). Emits the full event stream that a
//! real Claude Code team would produce, in predictable order, with configurable
//! delays.

use crate::claude_code::ClaudeSignal;
use crate::orchestrator::{
    ActivityState, Orchestrator, OrchestratorError, OrchestratorEvent, OrchestratorResult,
    TaskAssignment, TeamSpec,
};
use async_trait::async_trait;
use designer_core::{
    Actor, AgentId, ArtifactId, ArtifactKind, EventPayload, EventStore, StreamId, TabId, TaskId,
    WorkspaceId,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::broadcast;
use tracing::{debug, info};

type Tx = broadcast::Sender<OrchestratorEvent>;

pub struct MockOrchestrator<S: EventStore> {
    store: Arc<S>,
    tx: Tx,
    /// Side-channel signal sender so tests (and 13.H/F3's
    /// `signal_subscriber_records_to_store` in particular) can inject
    /// `ClaudeSignal::Cost` and assert the AppCore subscriber routes it into
    /// `CostTracker` + `EventPayload::CostRecorded`. Real Claude routes
    /// these via the stream-translator's cost arm; the mock stays silent
    /// unless a test calls `signals().send(...)`.
    signal_tx: broadcast::Sender<ClaudeSignal>,
    /// Phase 23.E: keyed by `(workspace_id, tab_id)` to mirror the real
    /// orchestrator's per-tab dispatch contract. Tests can inspect entry
    /// count to assert "two distinct teams" without touching real
    /// subprocesses.
    teams: Mutex<HashMap<(WorkspaceId, TabId), TeamSpec>>,
    agents: Mutex<HashMap<(WorkspaceId, TabId), Vec<AgentId>>>,
    /// Artificial delay used in integration tests. Zero by default.
    pub tick: Duration,
}

impl<S: EventStore> MockOrchestrator<S> {
    pub fn new(store: Arc<S>) -> Self {
        let (tx, _) = broadcast::channel(256);
        let (signal_tx, _) = broadcast::channel(64);
        Self {
            store,
            tx,
            signal_tx,
            teams: Mutex::new(HashMap::new()),
            agents: Mutex::new(HashMap::new()),
            tick: Duration::from_millis(0),
        }
    }

    /// Expose the signal sender so tests can inject side-channel signals
    /// (cost, rate-limit) without spinning up the real Claude subprocess.
    pub fn signals(&self) -> broadcast::Sender<ClaudeSignal> {
        self.signal_tx.clone()
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
        info!(workspace = %spec.workspace_id, tab = %spec.tab_id, team = %spec.team_name, "mock spawn_team");
        let key = (spec.workspace_id, spec.tab_id);
        self.teams.lock().insert(key, spec.clone());

        // Lead
        let lead_id = AgentId::new();
        self.agents.lock().entry(key).or_default().push(lead_id);
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
            self.agents.lock().entry(key).or_default().push(id);
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
        tab_id: TabId,
        assignment: TaskAssignment,
    ) -> OrchestratorResult<()> {
        debug!(?workspace_id, ?tab_id, ?assignment, "mock assign_task");
        let team = self
            .teams
            .lock()
            .get(&(workspace_id, tab_id))
            .cloned()
            .ok_or_else(|| OrchestratorError::TeamNotFound(format!("{workspace_id}/{tab_id}")))?;

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
            .get(&(workspace_id, tab_id))
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
        tab_id: TabId,
        author_role: String,
        body: String,
    ) -> OrchestratorResult<()> {
        let team = self
            .teams
            .lock()
            .get(&(workspace_id, tab_id))
            .cloned()
            .ok_or_else(|| OrchestratorError::TeamNotFound(format!("{workspace_id}/{tab_id}")))?;
        // Mirror the real orchestrator: don't persist; just broadcast.
        // AppCore is the single persister for `MessagePosted` (user side)
        // and `ArtifactCreated` (coalesced agent side). Persisting here
        // would double-write the user's text.
        self.emit(OrchestratorEvent::MessagePosted {
            workspace_id,
            author_role: author_role.clone(),
            body: body.clone(),
        });

        // Simulate an agent reply so the round-trip path is exercised.
        // The reply is persisted as `EventPayload::MessagePosted` (parity
        // with the real Claude orchestrator's reader task) AND broadcast
        // as `OrchestratorEvent::MessagePosted` so AppCore's coalescer can
        // flush it into an `ArtifactCreated { kind: Message }`. Keyword
        // detection drives optional structured artifact emission for the
        // diagram/report renderers (13.D scope is intentionally limited
        // to those two kinds).
        if author_role == "user" {
            // Phase 23.B parity with the real orchestrator: synthesize a
            // `Working` activity edge as soon as the user's message is
            // dispatched. The matching `Idle` follows after the reply
            // is broadcast. Mock subscribers (dev-mode UI, integration
            // tests) see the same per-tab ActivityChanged contract the
            // real Claude path emits via the stream translator.
            self.emit(OrchestratorEvent::ActivityChanged {
                workspace_id,
                tab_id,
                state: ActivityState::Working,
                since: SystemTime::now(),
            });
            self.pace().await;
            let reply = format!("Acknowledged: {body}");
            self.store
                .append(
                    StreamId::Workspace(workspace_id),
                    None,
                    Actor::agent(&team.team_name, &team.lead_role),
                    EventPayload::MessagePosted {
                        workspace_id,
                        author: Actor::agent(&team.team_name, &team.lead_role),
                        body: reply.clone(),
                        tab_id: None,
                    },
                )
                .await?;
            self.emit(OrchestratorEvent::MessagePosted {
                workspace_id,
                author_role: team.lead_role.clone(),
                body: reply,
            });

            let lower = body.to_lowercase();
            let maybe_kind = if lower.contains("diagram") {
                Some(ArtifactKind::Diagram)
            } else if lower.contains("report") {
                Some(ArtifactKind::Report)
            } else {
                None
            };
            if let Some(kind) = maybe_kind {
                let title = match kind {
                    ArtifactKind::Diagram => "Sequence diagram".to_string(),
                    ArtifactKind::Report => "Activity report".to_string(),
                    _ => "Artifact".to_string(),
                };
                let summary = match kind {
                    ArtifactKind::Diagram => "Mock diagram produced from the prompt.".into(),
                    ArtifactKind::Report => "Mock report produced from the prompt.".into(),
                    _ => "Mock artifact.".into(),
                };
                let payload_body = match kind {
                    ArtifactKind::Diagram => {
                        "sequenceDiagram\n  user->>team-lead: prompt\n  team-lead->>user: ack"
                            .to_string()
                    }
                    ArtifactKind::Report => {
                        format!("# Report\n\nMock summary derived from: {body}")
                    }
                    _ => body.clone(),
                };
                self.emit(OrchestratorEvent::ArtifactProduced {
                    workspace_id,
                    artifact_id: ArtifactId::new(),
                    artifact_kind: kind,
                    title,
                    summary,
                    body: payload_body,
                    author_role: Some(team.lead_role.clone()),
                });
            }
            // Phase 23.B parity: turn end emits `Idle` so the per-tab
            // dock + tab-strip badge clear when the simulated reply
            // lands. Mirrors the real translator's `result/success`
            // arm.
            self.emit(OrchestratorEvent::ActivityChanged {
                workspace_id,
                tab_id,
                state: ActivityState::Idle,
                since: SystemTime::now(),
            });
        }

        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<OrchestratorEvent> {
        self.tx.subscribe()
    }

    fn subscribe_signals(&self) -> broadcast::Receiver<ClaudeSignal> {
        self.signal_tx.subscribe()
    }

    async fn shutdown(&self, workspace_id: WorkspaceId, tab_id: TabId) -> OrchestratorResult<()> {
        self.teams.lock().remove(&(workspace_id, tab_id));
        self.agents.lock().remove(&(workspace_id, tab_id));
        Ok(())
    }
}

impl<S: EventStore> MockOrchestrator<S> {
    /// Test helper: number of live `(workspace, tab)` teams. Used by the
    /// 23.E acceptance tests to assert per-tab isolation without touching
    /// real subprocesses.
    #[doc(hidden)]
    pub fn team_count(&self) -> usize {
        self.teams.lock().len()
    }

    /// Test helper: every `(workspace, tab)` key currently registered.
    /// Used by 23.E tests to assert which tabs got teams.
    #[doc(hidden)]
    pub fn team_keys(&self) -> Vec<(WorkspaceId, TabId)> {
        self.teams.lock().keys().copied().collect()
    }
}

// Unused-import suppression for `TaskId` (keeps re-export for clarity).
#[allow(dead_code)]
fn _compile_check(_id: TaskId) {}
