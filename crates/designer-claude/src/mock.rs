//! Deterministic mock orchestrator. Used in tests and in the desktop app's
//! demo mode (no Claude binary required). Emits the full event stream that a
//! real Claude Code team would produce, in predictable order, with configurable
//! delays.

use crate::claude_code::ClaudeSignal;
use crate::orchestrator::{
    ActivityState, Orchestrator, OrchestratorError, OrchestratorEvent, OrchestratorResult,
    TaskAssignment, TeamSpec,
};
use crate::permission::{PermissionDecision, PermissionHandler, PermissionRequest};
use async_trait::async_trait;
use designer_core::{
    Actor, AgentContentBlockKind, AgentId, AgentStopReason, ArtifactId, ArtifactKind,
    ClaudeMessageId, ClaudeSessionId, EventPayload, EventStore, StreamId, TabId, TaskId,
    TokenUsage, WorkspaceId,
};
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
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
    /// Phase 24I — FIFO of scripted Phase 24 turns to play back per
    /// `(workspace_id, tab_id)`. When non-empty for the target key, the next
    /// `post_message` consumes the front entry and emits the scripted
    /// `AgentTurn*` sequence (parking on the permission handler for any
    /// `ScriptedBlock::ToolUse`) instead of the legacy v1
    /// `MessagePosted` + keyword-driven `ArtifactProduced` flow. Tests that
    /// don't script anything keep the legacy behavior unchanged.
    pending_scripts: Mutex<HashMap<(WorkspaceId, TabId), VecDeque<ScriptedTurn>>>,
    /// Phase 24I — optional inbox-grade permission handler. When set, any
    /// scripted `ToolUse` block parks the mock turn on
    /// `handler.decide(req)` until the test (or the inbox IPC) resolves it.
    /// When unset, scripted ToolUse blocks auto-accept so tests that don't
    /// care about the approval gate stay terse.
    permission_handler: parking_lot::RwLock<Option<Arc<dyn PermissionHandler>>>,
    /// Artificial delay used in integration tests. Zero by default.
    pub tick: Duration,
}

/// Test-only: a Phase 24 agent turn to play back on a scripted
/// `post_message`. The mock emits a full `AgentTurnStarted` →
/// per-block `Started`/`Delta`/`Ended` → optional `AgentToolResult`
/// (gated on the permission handler) → `AgentTurnEnded` sequence on the
/// orchestrator broadcast channel. `MessageCoalescer` persists each
/// matching `EventPayload::AgentTurn*` to the store, so a test can
/// `store.read_all()` to assert the full chain.
#[doc(hidden)]
#[derive(Debug, Clone)]
pub struct ScriptedTurn {
    pub turn_id: ClaudeMessageId,
    pub session_id: ClaudeSessionId,
    pub model: String,
    pub blocks: Vec<ScriptedBlock>,
    pub stop_reason: AgentStopReason,
    pub usage: TokenUsage,
}

/// Test-only: one content block inside a [`ScriptedTurn`].
#[doc(hidden)]
#[derive(Debug, Clone)]
pub enum ScriptedBlock {
    /// Plain text. `text` is emitted as a single
    /// `AgentContentBlockDelta` after the `Started` edge.
    Text { text: String },
    /// Extended-thinking block. `text` follows the same single-delta
    /// shape as `Text`.
    Thinking { text: String },
    /// Tool use. The mock emits `AgentContentBlockStarted{ToolUse{...}}`
    /// and `AgentContentBlockEnded`, then parks on the installed
    /// permission handler with the supplied input. On `Accept`, the mock
    /// emits an `AgentToolResult{tool_use_id, content: result_content,
    /// is_error}` matching this block. On `Deny`, the turn ends
    /// immediately with `stop_reason: Error` and no tool result.
    ///
    /// If no permission handler is installed (`with_permission_handler`
    /// was never called), the mock auto-accepts so tests that don't
    /// exercise the gate stay terse.
    ToolUse {
        tool_use_id: String,
        name: String,
        input: serde_json::Value,
        result_content: String,
        is_error: bool,
    },
}

impl ScriptedTurn {
    /// Convenience: a single-text-block turn ending with `EndTurn`.
    /// Used by tests that only need to see "the agent said something."
    #[doc(hidden)]
    pub fn text(turn_id: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            turn_id: ClaudeMessageId::new(turn_id),
            session_id: ClaudeSessionId::new("sess_mock"),
            model: "claude-mock".into(),
            blocks: vec![ScriptedBlock::Text { text: body.into() }],
            stop_reason: AgentStopReason::EndTurn,
            usage: TokenUsage::default(),
        }
    }
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
            pending_scripts: Mutex::new(HashMap::new()),
            permission_handler: parking_lot::RwLock::new(None),
            tick: Duration::from_millis(0),
        }
    }

    /// Expose the signal sender so tests can inject side-channel signals
    /// (cost, rate-limit) without spinning up the real Claude subprocess.
    pub fn signals(&self) -> broadcast::Sender<ClaudeSignal> {
        self.signal_tx.clone()
    }

    /// Phase 24I — install the inbox-grade permission handler the
    /// scripted `ToolUse` blocks should park on. Without this, scripted
    /// tool uses auto-accept (tests that don't care about the gate stay
    /// terse). With this, the mock's scripted turn behaves like the real
    /// Claude path: `decide()` parks until the user (or IPC) resolves.
    #[doc(hidden)]
    pub fn with_permission_handler(self, handler: Arc<dyn PermissionHandler>) -> Self {
        *self.permission_handler.write() = Some(handler);
        self
    }

    /// Phase 24I — install the permission handler after the mock is
    /// already wrapped in an `Arc`. `with_permission_handler` is the
    /// builder-style version for the common case; this is for
    /// integration harnesses that hand the mock to `AppCore::boot_with_orchestrator`
    /// first and only afterward have the `InboxPermissionHandler` in
    /// hand (which is created inside boot).
    #[doc(hidden)]
    pub fn install_permission_handler(&self, handler: Arc<dyn PermissionHandler>) {
        *self.permission_handler.write() = Some(handler);
    }

    /// Phase 24I — queue a [`ScriptedTurn`] to play back on the next
    /// `post_message(workspace_id, tab_id, "user", ...)`. Scripts queue
    /// FIFO per `(workspace_id, tab_id)` — calling this twice and then
    /// `post_message` twice plays back the scripts in order.
    ///
    /// When a script is queued, the mock's legacy v1 emission path
    /// (`MessagePosted{author_role:agent}` + keyword `ArtifactProduced`)
    /// is suppressed for that `post_message` call. Calls with no script
    /// queued keep the legacy behavior unchanged.
    #[doc(hidden)]
    pub fn script_next_turn(&self, workspace_id: WorkspaceId, tab_id: TabId, turn: ScriptedTurn) {
        self.pending_scripts
            .lock()
            .entry((workspace_id, tab_id))
            .or_default()
            .push_back(turn);
    }

    fn take_pending_script(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
    ) -> Option<ScriptedTurn> {
        let mut scripts = self.pending_scripts.lock();
        let entry = scripts.get_mut(&(workspace_id, tab_id))?;
        let turn = entry.pop_front();
        if entry.is_empty() {
            scripts.remove(&(workspace_id, tab_id));
        }
        turn
    }

    /// Play back a [`ScriptedTurn`] on the broadcast. Emits the full
    /// Phase 24 event sequence; for `ToolUse` blocks, parks on the
    /// installed permission handler. The orchestrator's broadcast is
    /// the single source of truth — `MessageCoalescer` mirrors each
    /// edge into the store.
    async fn play_scripted_turn(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
        turn: ScriptedTurn,
    ) -> OrchestratorResult<()> {
        // Working edge — matches the v1 path's `ActivityChanged{Working}`
        // emission so per-tab activity badges still light up on a
        // scripted turn.
        self.emit(OrchestratorEvent::ActivityChanged {
            workspace_id,
            tab_id,
            state: ActivityState::Working,
            since: SystemTime::now(),
        });

        self.emit(OrchestratorEvent::AgentTurnStarted {
            workspace_id,
            tab_id,
            turn_id: turn.turn_id.clone(),
            model: turn.model.clone(),
            session_id: turn.session_id.clone(),
        });

        let mut early_stop: Option<AgentStopReason> = None;

        for (block_index, block) in turn.blocks.iter().enumerate() {
            let block_index = block_index as u32;
            let block_kind = match block {
                ScriptedBlock::Text { .. } => AgentContentBlockKind::Text,
                ScriptedBlock::Thinking { .. } => AgentContentBlockKind::Thinking,
                ScriptedBlock::ToolUse {
                    tool_use_id, name, ..
                } => AgentContentBlockKind::ToolUse {
                    name: name.clone(),
                    tool_use_id: tool_use_id.clone(),
                },
            };
            self.emit(OrchestratorEvent::AgentContentBlockStarted {
                workspace_id,
                tab_id,
                turn_id: turn.turn_id.clone(),
                block_index,
                block_kind,
            });

            self.pace().await;

            match block {
                ScriptedBlock::Text { text } | ScriptedBlock::Thinking { text } => {
                    if !text.is_empty() {
                        self.emit(OrchestratorEvent::AgentContentBlockDelta {
                            workspace_id,
                            tab_id,
                            turn_id: turn.turn_id.clone(),
                            block_index,
                            delta: text.clone(),
                        });
                    }
                    self.emit(OrchestratorEvent::AgentContentBlockEnded {
                        workspace_id,
                        tab_id,
                        turn_id: turn.turn_id.clone(),
                        block_index,
                    });
                }
                ScriptedBlock::ToolUse {
                    tool_use_id,
                    name,
                    input,
                    result_content,
                    is_error,
                } => {
                    self.emit(OrchestratorEvent::AgentContentBlockEnded {
                        workspace_id,
                        tab_id,
                        turn_id: turn.turn_id.clone(),
                        block_index,
                    });

                    // Phase 24I — park on the installed permission handler
                    // for parity with the real Claude path's `control_request`
                    // gate. The translator emits `AwaitingApproval` on the
                    // real path; we mirror it here so test assertions on the
                    // activity surface still hold.
                    self.emit(OrchestratorEvent::ActivityChanged {
                        workspace_id,
                        tab_id,
                        state: ActivityState::AwaitingApproval,
                        since: SystemTime::now(),
                    });

                    let decision = {
                        let handler_opt = self.permission_handler.read().clone();
                        match handler_opt {
                            Some(handler) => {
                                handler
                                    .decide(PermissionRequest {
                                        tool: name.clone(),
                                        input: input.clone(),
                                        summary: format!("{name} (scripted)"),
                                        workspace_id: Some(workspace_id),
                                    })
                                    .await
                            }
                            None => PermissionDecision::Accept,
                        }
                    };

                    // Back to Working after the gate resolves (real path
                    // emits this from the next streamed event; the mock
                    // emits it explicitly so the activity surface
                    // re-enters the streaming state before the result).
                    self.emit(OrchestratorEvent::ActivityChanged {
                        workspace_id,
                        tab_id,
                        state: ActivityState::Working,
                        since: SystemTime::now(),
                    });

                    match decision {
                        PermissionDecision::Accept => {
                            self.emit(OrchestratorEvent::AgentToolResult {
                                workspace_id,
                                tab_id,
                                turn_id: turn.turn_id.clone(),
                                tool_use_id: tool_use_id.clone(),
                                content: result_content.clone(),
                                is_error: *is_error,
                            });
                        }
                        PermissionDecision::Deny { reason } => {
                            // Real path: a denied permission causes claude
                            // to abort the turn. Surface the same way:
                            // emit a tool result carrying the deny reason
                            // (so the test can inspect it), then end the
                            // turn with `Error`.
                            self.emit(OrchestratorEvent::AgentToolResult {
                                workspace_id,
                                tab_id,
                                turn_id: turn.turn_id.clone(),
                                tool_use_id: tool_use_id.clone(),
                                content: reason,
                                is_error: true,
                            });
                            early_stop = Some(AgentStopReason::Error);
                            break;
                        }
                    }
                }
            }
        }

        let stop_reason = early_stop.unwrap_or(turn.stop_reason);
        self.emit(OrchestratorEvent::AgentTurnEnded {
            workspace_id,
            tab_id,
            turn_id: turn.turn_id.clone(),
            stop_reason,
            usage: turn.usage,
        });

        // Idle edge — matches v1's terminal `ActivityChanged{Idle}` so
        // per-tab badges clear when the scripted turn lands.
        self.emit(OrchestratorEvent::ActivityChanged {
            workspace_id,
            tab_id,
            state: ActivityState::Idle,
            since: SystemTime::now(),
        });

        Ok(())
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

        // Phase 24I — if a script is queued for this `(workspace, tab)`
        // and the post is from the user, consume the front entry and
        // play the Phase 24 turn back instead of running the legacy v1
        // simulator below. Lets tests script tool-use turns through the
        // real `post_message` IPC path, exercising the AppCore →
        // orchestrator → permission-handler → coalescer chain.
        if author_role == "user" {
            if let Some(turn) = self.take_pending_script(workspace_id, tab_id) {
                return self.play_scripted_turn(workspace_id, tab_id, turn).await;
            }
        }

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

    async fn interrupt(&self, workspace_id: WorkspaceId, tab_id: TabId) -> OrchestratorResult<()> {
        // Mirror the real orchestrator's TeamNotFound semantics so callers
        // see the same error surface across orchestrators. The session
        // stays alive on the (workspace, tab) — interrupt does NOT remove
        // the team entry; a follow-up post_message must still find it.
        let exists = self.teams.lock().contains_key(&(workspace_id, tab_id));
        if !exists {
            return Err(OrchestratorError::TeamNotFound(format!(
                "{workspace_id}/{tab_id}"
            )));
        }
        // Phase 23.F — synthesize the same `Idle` edge the real translator
        // emits when claude's `result` line lands after an interrupt. This
        // unblocks the activity surface and flushes any partial coalesced
        // text the way a real turn-end would.
        self.emit(OrchestratorEvent::ActivityChanged {
            workspace_id,
            tab_id,
            state: ActivityState::Idle,
            since: SystemTime::now(),
        });
        Ok(())
    }

    async fn shutdown(&self, workspace_id: WorkspaceId, tab_id: TabId) -> OrchestratorResult<()> {
        self.teams.lock().remove(&(workspace_id, tab_id));
        self.agents.lock().remove(&(workspace_id, tab_id));
        Ok(())
    }

    async fn kill(&self, workspace_id: WorkspaceId, tab_id: TabId) -> OrchestratorResult<()> {
        // Explicit override of the `Orchestrator::kill` default impl
        // (which delegates to `shutdown`). Mock has no subprocess to
        // SIGKILL, but we override for parity with `ClaudeCodeOrchestrator`
        // and so a future divergence in `shutdown` (e.g. a graceful-
        // teardown wait that simulates real Claude's 60s budget)
        // doesn't accidentally trap model-change tests in a wait. This
        // body matches `shutdown`'s today; the explicit declaration is
        // the contract.
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

    /// Test helper: the broadcast sender backing
    /// [`Orchestrator::subscribe`]. Mirrors [`signals`](Self::signals)
    /// for the side-channel sender — exposes the producer so tests can
    /// inject synthetic [`OrchestratorEvent`]s (e.g.
    /// `ActivityChanged`) without going through `post_message` and
    /// dragging in the rest of the simulator.
    #[doc(hidden)]
    pub fn event_sender(&self) -> broadcast::Sender<OrchestratorEvent> {
        self.tx.clone()
    }
}

// Unused-import suppression for `TaskId` (keeps re-export for clarity).
#[allow(dead_code)]
fn _compile_check(_id: TaskId) {}

#[cfg(test)]
mod script_next_turn_tests {
    //! Phase 24I — direct unit coverage for `script_next_turn` /
    //! `play_scripted_turn`. Asserts the emitted broadcast sequence
    //! matches what `MessageCoalescer` expects to bridge into the
    //! Phase 24 event log. Approval-gate parking is exercised here
    //! with a hand-rolled `PermissionHandler` so the AppCore /
    //! InboxPermissionHandler integration can stay in the higher-
    //! altitude `tests/round_trip_e2e.rs` harness test.
    use super::*;
    use crate::permission::{PermissionDecision, PermissionHandler, PermissionRequest};
    use designer_core::SqliteEventStore;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::broadcast::error::RecvError;

    struct AlwaysAccept {
        calls: Arc<AtomicUsize>,
    }
    #[async_trait]
    impl PermissionHandler for AlwaysAccept {
        async fn decide(&self, _req: PermissionRequest) -> PermissionDecision {
            self.calls.fetch_add(1, Ordering::SeqCst);
            PermissionDecision::Accept
        }
    }

    struct AlwaysDeny;
    #[async_trait]
    impl PermissionHandler for AlwaysDeny {
        async fn decide(&self, _req: PermissionRequest) -> PermissionDecision {
            PermissionDecision::Deny {
                reason: "test-deny".into(),
            }
        }
    }

    fn spawn_team_spec(workspace_id: WorkspaceId, tab_id: TabId) -> TeamSpec {
        TeamSpec {
            workspace_id,
            tab_id,
            team_name: "alpha".into(),
            lead_role: "lead".into(),
            teammates: vec![],
            env: Default::default(),
            cwd: None,
            model: None,
            phase24: true,
        }
    }

    async fn drain_events(
        rx: &mut tokio::sync::broadcast::Receiver<OrchestratorEvent>,
        deadline: Duration,
    ) -> Vec<OrchestratorEvent> {
        let mut out = Vec::new();
        let result = tokio::time::timeout(deadline, async {
            loop {
                match rx.recv().await {
                    Ok(ev) => out.push(ev),
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                }
            }
        })
        .await;
        // timeout is expected — the broadcast never closes on its own.
        let _ = result;
        out
    }

    #[tokio::test]
    async fn scripted_text_turn_emits_phase24_sequence() {
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        let mock = Arc::new(MockOrchestrator::new(store));
        let workspace_id = WorkspaceId::new();
        let tab_id = TabId::new();
        mock.spawn_team(spawn_team_spec(workspace_id, tab_id))
            .await
            .unwrap();
        let mut rx = mock.subscribe();
        // Drain the spawn_team broadcasts so the assertions below only see
        // the post_message-driven sequence.
        let _ = drain_events(&mut rx, Duration::from_millis(20)).await;

        mock.script_next_turn(
            workspace_id,
            tab_id,
            ScriptedTurn::text("msg_text", "hello"),
        );
        mock.post_message(workspace_id, tab_id, "user".into(), "ping".into())
            .await
            .unwrap();

        let events = drain_events(&mut rx, Duration::from_millis(50)).await;
        // The scripted path emits, in order:
        //   MessagePosted{user} (echo)
        //   ActivityChanged{Working}
        //   AgentTurnStarted
        //   AgentContentBlockStarted{Text}
        //   AgentContentBlockDelta{"hello"}
        //   AgentContentBlockEnded
        //   AgentTurnEnded{EndTurn}
        //   ActivityChanged{Idle}
        let kinds: Vec<&str> = events
            .iter()
            .map(|e| match e {
                OrchestratorEvent::MessagePosted { .. } => "MessagePosted",
                OrchestratorEvent::ActivityChanged {
                    state: ActivityState::Working,
                    ..
                } => "Working",
                OrchestratorEvent::ActivityChanged {
                    state: ActivityState::Idle,
                    ..
                } => "Idle",
                OrchestratorEvent::ActivityChanged {
                    state: ActivityState::AwaitingApproval,
                    ..
                } => "AwaitingApproval",
                OrchestratorEvent::AgentTurnStarted { .. } => "AgentTurnStarted",
                OrchestratorEvent::AgentContentBlockStarted { .. } => "BlockStarted",
                OrchestratorEvent::AgentContentBlockDelta { .. } => "BlockDelta",
                OrchestratorEvent::AgentContentBlockEnded { .. } => "BlockEnded",
                OrchestratorEvent::AgentTurnEnded { .. } => "AgentTurnEnded",
                OrchestratorEvent::AgentToolResult { .. } => "AgentToolResult",
                _ => "other",
            })
            .collect();
        assert_eq!(
            kinds,
            vec![
                "MessagePosted",
                "Working",
                "AgentTurnStarted",
                "BlockStarted",
                "BlockDelta",
                "BlockEnded",
                "AgentTurnEnded",
                "Idle",
            ],
            "scripted text-only turn must emit the Phase 24 sequence"
        );

        // Critically: NO legacy MessagePosted{agent} echo and NO
        // ArtifactProduced. The script replaces the v1 path.
        for ev in &events {
            if let OrchestratorEvent::MessagePosted { author_role, .. } = ev {
                assert_eq!(
                    author_role, "user",
                    "scripted path must suppress the v1 agent echo"
                );
            }
            assert!(
                !matches!(ev, OrchestratorEvent::ArtifactProduced { .. }),
                "scripted path must suppress the keyword-driven artifact emission"
            );
        }
    }

    #[tokio::test]
    async fn scripted_tool_use_parks_handler_and_emits_result_on_accept() {
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        let calls = Arc::new(AtomicUsize::new(0));
        let mock = Arc::new(
            MockOrchestrator::new(store).with_permission_handler(Arc::new(AlwaysAccept {
                calls: calls.clone(),
            })),
        );
        let workspace_id = WorkspaceId::new();
        let tab_id = TabId::new();
        mock.spawn_team(spawn_team_spec(workspace_id, tab_id))
            .await
            .unwrap();
        let mut rx = mock.subscribe();
        let _ = drain_events(&mut rx, Duration::from_millis(20)).await;

        mock.script_next_turn(
            workspace_id,
            tab_id,
            ScriptedTurn {
                turn_id: ClaudeMessageId::new("msg_tool"),
                session_id: ClaudeSessionId::new("sess_mock"),
                model: "claude-mock".into(),
                blocks: vec![ScriptedBlock::ToolUse {
                    tool_use_id: "tool_1".into(),
                    name: "Write".into(),
                    input: json!({"file_path": "/tmp/foo"}),
                    result_content: "ok".into(),
                    is_error: false,
                }],
                stop_reason: AgentStopReason::EndTurn,
                usage: TokenUsage::default(),
            },
        );
        mock.post_message(workspace_id, tab_id, "user".into(), "do it".into())
            .await
            .unwrap();

        let events = drain_events(&mut rx, Duration::from_millis(50)).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "permission handler must be invoked exactly once per ToolUse block"
        );
        // Must include AwaitingApproval edge before the result.
        let saw_awaiting = events.iter().any(|e| {
            matches!(
                e,
                OrchestratorEvent::ActivityChanged {
                    state: ActivityState::AwaitingApproval,
                    ..
                }
            )
        });
        assert!(saw_awaiting, "ToolUse must emit AwaitingApproval");
        // Must emit a non-error tool result with the scripted content.
        let result = events.iter().find_map(|e| match e {
            OrchestratorEvent::AgentToolResult {
                tool_use_id,
                content,
                is_error,
                ..
            } => Some((tool_use_id.clone(), content.clone(), *is_error)),
            _ => None,
        });
        assert_eq!(result, Some(("tool_1".into(), "ok".into(), false)));
    }

    #[tokio::test]
    async fn scripted_tool_use_terminates_turn_on_deny() {
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        let mock =
            Arc::new(MockOrchestrator::new(store).with_permission_handler(Arc::new(AlwaysDeny)));
        let workspace_id = WorkspaceId::new();
        let tab_id = TabId::new();
        mock.spawn_team(spawn_team_spec(workspace_id, tab_id))
            .await
            .unwrap();
        let mut rx = mock.subscribe();
        let _ = drain_events(&mut rx, Duration::from_millis(20)).await;

        mock.script_next_turn(
            workspace_id,
            tab_id,
            ScriptedTurn {
                turn_id: ClaudeMessageId::new("msg_deny"),
                session_id: ClaudeSessionId::new("sess_mock"),
                model: "claude-mock".into(),
                blocks: vec![
                    ScriptedBlock::ToolUse {
                        tool_use_id: "tool_1".into(),
                        name: "Bash".into(),
                        input: json!({"command": "rm -rf /"}),
                        result_content: String::new(),
                        is_error: false,
                    },
                    // This second block must NOT fire after the deny.
                    ScriptedBlock::Text {
                        text: "unreachable".into(),
                    },
                ],
                stop_reason: AgentStopReason::EndTurn,
                usage: TokenUsage::default(),
            },
        );
        mock.post_message(workspace_id, tab_id, "user".into(), "do it".into())
            .await
            .unwrap();

        let events = drain_events(&mut rx, Duration::from_millis(50)).await;
        // Tool result carries the deny reason, is_error=true.
        let tool_results: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                OrchestratorEvent::AgentToolResult {
                    is_error, content, ..
                } => Some((*is_error, content.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(tool_results, vec![(true, "test-deny".into())]);
        // Turn ends with Error stop_reason; no later blocks emitted.
        let stop_reasons: Vec<AgentStopReason> = events
            .iter()
            .filter_map(|e| match e {
                OrchestratorEvent::AgentTurnEnded { stop_reason, .. } => Some(*stop_reason),
                _ => None,
            })
            .collect();
        assert_eq!(stop_reasons, vec![AgentStopReason::Error]);
        // No BlockDelta for the unreachable text block.
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, OrchestratorEvent::AgentContentBlockDelta { .. })),
            "second block must not fire after the deny terminates the turn"
        );
    }

    #[tokio::test]
    async fn missing_handler_auto_accepts_tool_use() {
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        let mock = Arc::new(MockOrchestrator::new(store));
        let workspace_id = WorkspaceId::new();
        let tab_id = TabId::new();
        mock.spawn_team(spawn_team_spec(workspace_id, tab_id))
            .await
            .unwrap();
        let mut rx = mock.subscribe();
        let _ = drain_events(&mut rx, Duration::from_millis(20)).await;

        mock.script_next_turn(
            workspace_id,
            tab_id,
            ScriptedTurn {
                turn_id: ClaudeMessageId::new("msg_auto"),
                session_id: ClaudeSessionId::new("sess_mock"),
                model: "claude-mock".into(),
                blocks: vec![ScriptedBlock::ToolUse {
                    tool_use_id: "tool_1".into(),
                    name: "Read".into(),
                    input: json!({}),
                    result_content: "contents".into(),
                    is_error: false,
                }],
                stop_reason: AgentStopReason::EndTurn,
                usage: TokenUsage::default(),
            },
        );
        mock.post_message(workspace_id, tab_id, "user".into(), "go".into())
            .await
            .unwrap();
        let events = drain_events(&mut rx, Duration::from_millis(30)).await;
        let saw_result = events.iter().any(|e| {
            matches!(
                e,
                OrchestratorEvent::AgentToolResult {
                    is_error: false,
                    ..
                }
            )
        });
        assert!(saw_result, "no handler installed -> auto-accept");
    }

    #[tokio::test]
    async fn scripts_queue_fifo_per_tab() {
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        let mock = Arc::new(MockOrchestrator::new(store));
        let workspace_id = WorkspaceId::new();
        let tab_id = TabId::new();
        mock.spawn_team(spawn_team_spec(workspace_id, tab_id))
            .await
            .unwrap();
        let mut rx = mock.subscribe();
        let _ = drain_events(&mut rx, Duration::from_millis(20)).await;

        mock.script_next_turn(workspace_id, tab_id, ScriptedTurn::text("msg_a", "first"));
        mock.script_next_turn(workspace_id, tab_id, ScriptedTurn::text("msg_b", "second"));

        mock.post_message(workspace_id, tab_id, "user".into(), "go".into())
            .await
            .unwrap();
        mock.post_message(workspace_id, tab_id, "user".into(), "go".into())
            .await
            .unwrap();

        let events = drain_events(&mut rx, Duration::from_millis(50)).await;
        let turn_ids: Vec<String> = events
            .iter()
            .filter_map(|e| match e {
                OrchestratorEvent::AgentTurnStarted { turn_id, .. } => {
                    Some(turn_id.as_str().to_string())
                }
                _ => None,
            })
            .collect();
        assert_eq!(turn_ids, vec!["msg_a", "msg_b"]);
    }

    #[tokio::test]
    async fn no_script_falls_back_to_legacy_path() {
        // Belt-and-suspenders: existing tests cover this, but pin the
        // negative case directly so a refactor of `take_pending_script`
        // can't silently break the legacy fallback.
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        let mock = Arc::new(MockOrchestrator::new(store));
        let workspace_id = WorkspaceId::new();
        let tab_id = TabId::new();
        mock.spawn_team(spawn_team_spec(workspace_id, tab_id))
            .await
            .unwrap();
        let mut rx = mock.subscribe();
        let _ = drain_events(&mut rx, Duration::from_millis(20)).await;

        mock.post_message(workspace_id, tab_id, "user".into(), "hello".into())
            .await
            .unwrap();
        let events = drain_events(&mut rx, Duration::from_millis(50)).await;
        // Legacy path emits TWO MessagePosted (user + agent) and zero
        // AgentTurnStarted.
        let msg_count = events
            .iter()
            .filter(|e| matches!(e, OrchestratorEvent::MessagePosted { .. }))
            .count();
        assert_eq!(msg_count, 2, "legacy path must emit user + agent echo");
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, OrchestratorEvent::AgentTurnStarted { .. })),
            "legacy path must NOT emit Phase 24 events"
        );
    }
}
