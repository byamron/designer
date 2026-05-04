//! Stream-json event translator. Converts Claude Code's `--output-format
//! stream-json` output into `OrchestratorEvent`s plus side-channel signals
//! (rate-limit info, per-turn cost).
//!
//! Stateful: maintains deterministic UUIDv5 mappings from Claude's external
//! IDs (task_id strings like `"t9zu6heo5"`, agent names like
//! `"researcher@dir-recon"`) to our `TaskId` / `AgentId` UUIDs. The workspace's
//! UUID is the v5 namespace, so the same Claude ID within the same workspace
//! always maps to the same internal ID across restarts.
//!
//! Event shapes are captured in `core-docs/integration-notes.md`; fixtures in
//! `tests/fixtures/stream_json/` cover every variant this module translates.

use crate::orchestrator::{ActivityState, OrchestratorEvent};
use designer_core::{
    author_roles, AgentContentBlockKind, AgentId, AgentStopReason, ArtifactId, ArtifactKind,
    ClaudeMessageId, ClaudeSessionId, TabId, TaskId, TokenUsage, WorkspaceId,
};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::time::SystemTime;
use tracing::debug;
use uuid::Uuid;

/// Cap applied to every per-translator id map (`tasks`, `agents`,
/// `tool_uses`). One entry ≈ 32-byte key + 16-byte UUID, so 1024 entries
/// per map keeps the worst-case footprint well under 256 KB even when all
/// three maps are saturated. A multi-day session that issues thousands of
/// tool calls will recycle the oldest entries; the user-visible artifacts
/// have already been written to the event store, so the cap only loses
/// the in-memory correlation handle for very old tool_use_ids whose
/// matching tool_result will never arrive.
const TRANSLATOR_STATE_MAX_ENTRIES: usize = 1024;

/// Outputs emitted by the translator. Not every stream-json line produces an
/// `OrchestratorEvent` — some carry side-channel information (capacity
/// signals, cost) that routes to specialized consumers.
#[derive(Debug, Clone)]
pub enum TranslatorOutput {
    /// Normalized orchestrator event; fans out to the broadcast channel.
    Event(OrchestratorEvent),
    /// Claude's `rate_limit_event` payload. Feeds the usage chip (Decision 34).
    RateLimit(Value),
    /// Per-turn dollar cost from `result/success`. Feeds `CostTracker`.
    Cost(f64),
    /// Permission prompt emitted by `--permission-prompt-tool stdio`.
    /// `claude_code.rs::reader_task` routes the request to the installed
    /// [`crate::PermissionHandler`]; once the handler resolves, the orchestrator
    /// encodes the response and writes it back through the lead's stdin. The
    /// `request_id` is opaque — Claude correlates the response by it; we copy
    /// it through verbatim.
    PermissionPrompt {
        request_id: String,
        tool: String,
        input: Value,
        summary: String,
        tool_use_id: Option<String>,
    },
}

pub struct ClaudeStreamTranslator {
    workspace_id: WorkspaceId,
    /// Phase 23.B — every `OrchestratorEvent::ActivityChanged` the
    /// translator emits is keyed by `(workspace_id, tab_id)`. Each
    /// per-tab claude subprocess (Phase 23.E) owns its own translator
    /// instance, so the tab id is fixed for the translator's lifetime.
    tab_id: TabId,
    team_name: String,
    /// Phase 24 — when `true`, emit the `AgentTurn*` family from the
    /// stream-json projection and suppress the legacy
    /// `MessagePosted` / `ArtifactProduced` / `ActivityChanged` chat
    /// events. The legacy path is preserved for users who haven't
    /// flipped `show_chat_v2` yet so dogfood machines aren't disrupted
    /// before the renderer-side rewrite ships. Cost extraction,
    /// permission prompts, and `system/task_*` handling are mode-
    /// independent — they fire identically in both modes.
    phase24: bool,
    /// Phase 23.B — last activity state we emitted, used to suppress
    /// no-op transitions (we only broadcast on edges so the frontend
    /// counter doesn't reset on every stream-json line). Always
    /// tracked, but Phase 24 mode does not broadcast transitions.
    activity: ActivityState,
    /// Phase 24 — Claude's own `session_id` from the most recent
    /// `system/init`. Held until an `AgentTurnStarted` is emitted, then
    /// stamped onto the event so the frontend can drive `--resume`
    /// across model switches. Survives across turns.
    session_id: Option<ClaudeSessionId>,
    /// Phase 24 — open-turn state. Created on `message_start`,
    /// finalized on `message_stop` / `result/error_during_execution`,
    /// cleared on `AgentTurnEnded`. Holds the per-turn transient
    /// tool-use → block-index map that replaces the legacy bounded LRU.
    turn: Option<TurnState>,
    tasks: BoundedMap<String, TaskId>,
    agents: BoundedMap<String, AgentId>,
    /// Legacy mode only. Maps an assistant `tool_use` block's `id` to
    /// the deterministic `ArtifactId` we minted when emitting its
    /// `ArtifactProduced`. The matching `tool_result` content block (in
    /// a later user-typed message) looks the id up here and emits
    /// `ArtifactUpdated` against the same artifact, so the rail's
    /// "Read CLAUDE.md" card gains a result summary in place rather
    /// than spawning a sibling artifact. Phase 24 mode replaces this
    /// with the per-turn transient map on [`TurnState`].
    tool_uses: BoundedMap<String, ArtifactId>,
}

/// Phase 24 — open-turn correlation. Lives only while a turn is open;
/// dropped on `AgentTurnEnded`. The bounded LRU on the legacy path was
/// a workaround for tool_results arriving across turn boundaries; in
/// the post-Phase-24 stream-json projection, tool_results land within
/// the same turn so we can scope the map and avoid the LRU cost.
struct TurnState {
    turn_id: ClaudeMessageId,
    /// Stop reason captured from `message_delta`; finalized at
    /// `message_stop` to emit `AgentTurnEnded`. `None` until
    /// `message_delta` arrives.
    pending_stop_reason: Option<AgentStopReason>,
    /// Cumulative usage from `message_delta.usage` and `result/success`
    /// envelopes. `result/success` is the canonical source for the
    /// final-turn token totals; `message_delta` is the per-stream
    /// hint we accumulate while waiting.
    pending_usage: TokenUsage,
    /// Set true after `message_stop` (or any other terminal envelope)
    /// so a subsequent `result/success` line attributes its cost to
    /// this turn but doesn't double-emit `AgentTurnEnded`.
    ended: bool,
    /// Tool-use ids opened within this turn, mapped to the block index
    /// the renderer uses to address them. Cleared with the turn.
    tool_use_blocks: HashMap<String, u32>,
}

impl ClaudeStreamTranslator {
    /// `team_name` is what the lead was asked to name the team during
    /// `spawn_team`. Required at construction so agent-id derivation is
    /// unambiguous even for events that arrive before any `config.json` read.
    /// `tab_id` (Phase 23.B / 23.E) keys the per-tab `ActivityChanged`
    /// broadcasts the translator emits. `phase24` selects the chat-domain
    /// emission family per ADR 0008 — defaults to `false` (legacy path)
    /// via [`Self::new`]; opt in via [`Self::new_phase24`] or
    /// [`Self::with_phase24`].
    pub fn new(workspace_id: WorkspaceId, tab_id: TabId, team_name: impl Into<String>) -> Self {
        Self::with_phase24(workspace_id, tab_id, team_name, false)
    }

    /// Phase 24 — construct a translator that emits `AgentTurn*` events
    /// instead of the legacy chat-domain split. Cost / permission-prompt
    /// / task lifecycle outputs are unchanged in either mode.
    pub fn new_phase24(
        workspace_id: WorkspaceId,
        tab_id: TabId,
        team_name: impl Into<String>,
    ) -> Self {
        Self::with_phase24(workspace_id, tab_id, team_name, true)
    }

    fn with_phase24(
        workspace_id: WorkspaceId,
        tab_id: TabId,
        team_name: impl Into<String>,
        phase24: bool,
    ) -> Self {
        Self {
            workspace_id,
            tab_id,
            team_name: team_name.into(),
            phase24,
            activity: ActivityState::Idle,
            session_id: None,
            turn: None,
            tasks: BoundedMap::with_capacity(TRANSLATOR_STATE_MAX_ENTRIES),
            agents: BoundedMap::with_capacity(TRANSLATOR_STATE_MAX_ENTRIES),
            tool_uses: BoundedMap::with_capacity(TRANSLATOR_STATE_MAX_ENTRIES),
        }
    }

    /// Phase 24 — true when the translator emits the new `AgentTurn*`
    /// vocabulary. Used by `claude_code.rs` to decide which
    /// `OrchestratorEvent` variants its bridge needs to handle.
    pub fn is_phase24(&self) -> bool {
        self.phase24
    }

    /// Phase 23.B — emit an [`OrchestratorEvent::ActivityChanged`] only
    /// on a real transition. Same-state writes (a long burst of
    /// `Working` stream events) collapse so the frontend counter
    /// keeps ticking from the first transition's `since` instead of
    /// resetting on every line. Returns `None` when the state didn't
    /// change.
    fn transition(&mut self, next: ActivityState) -> Option<TranslatorOutput> {
        if self.activity == next {
            return None;
        }
        self.activity = next;
        Some(TranslatorOutput::Event(
            OrchestratorEvent::ActivityChanged {
                workspace_id: self.workspace_id,
                tab_id: self.tab_id,
                state: next,
                since: SystemTime::now(),
            },
        ))
    }

    /// Phase 23.B — synthesize an `Idle` activity event when the
    /// reader detects EOF / subprocess death. Idempotent: if the
    /// translator was already `Idle`, no event is produced (the UI
    /// already shows the dock hidden). Called by
    /// `claude_code::run_reader_loop` after the read loop exits so a
    /// crashed subprocess doesn't leave a phantom "Working… 47:00"
    /// indicator.
    pub fn flush_idle(&mut self) -> Option<OrchestratorEvent> {
        match self.transition(ActivityState::Idle)? {
            TranslatorOutput::Event(ev) => Some(ev),
            // `transition` only returns `Event` variants — guarded to
            // future-proof against the helper changing shape.
            _ => None,
        }
    }

    /// Translate one JSON line (as produced by `claude --output-format
    /// stream-json`). Returns zero or more outputs. Malformed lines yield an
    /// empty vector and a DEBUG log.
    pub fn translate(&mut self, line: &str) -> Vec<TranslatorOutput> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            debug!(?line, "stream: unparseable line");
            return Vec::new();
        };
        self.translate_value(&value)
    }

    fn translate_value(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");

        // Phase 24 (ADR 0008) — capture Claude's own session id from the
        // `system/init` envelope before it gets dropped by the system
        // routing below. Held until the next `AgentTurnStarted` so the
        // frontend can drive `--resume` across model switches. Captured
        // in either mode: the legacy path doesn't read it, but capturing
        // unconditionally keeps the field load-bearing for the moment a
        // user flips `show_chat_v2`.
        if ty == "system" && v.get("subtype").and_then(Value::as_str) == Some("init") {
            if let Some(sid) = v.get("session_id").and_then(Value::as_str) {
                self.session_id = Some(ClaudeSessionId::new(sid));
            }
        }

        // Phase 23.B — activity transitions, computed before the per-type
        // translation so the `Working` edge lands at the head of the
        // returned vector (frontend reducers see the state change before
        // the artifact / message it triggered). Only events that imply
        // Claude is *actively producing* trigger `Working` — boot-time
        // `system/init` and `system/status` lines are excluded so the
        // dock doesn't flash "Working… 0:01" before the user has typed
        // anything (init arrives once at subprocess spawn, before any
        // turn).
        //
        // Phase 24 mode: the activity indicator becomes a render-time
        // observable (subprocess_running && turn_open) computed from
        // `AgentTurnStarted` / `AgentTurnEnded` boundaries. Suppressing
        // emission here keeps the legacy frontend behavior intact when
        // the flag is off and lets the new renderer ignore the dock
        // state machine entirely when it's on.
        let mut activity_edge: Option<TranslatorOutput> = if self.phase24 {
            None
        } else {
            match ty {
                // `assistant` carries text + tool_use blocks; `user` carries
                // tool_result echoes mid-turn; `stream_event` is the partial
                // delta stream. Any of the three is unambiguous evidence that
                // a turn is in flight, and re-arms `Working` after an
                // `AwaitingApproval` round-trip.
                "assistant" | "user" | "stream_event" => self.transition(ActivityState::Working),
                // `system/task_started` / `task_updated` / `task_notification`
                // signal in-process teammate lifecycle and also imply the
                // agent is working; init / status are excluded above.
                "system" => match v.get("subtype").and_then(Value::as_str) {
                    Some("task_started" | "task_updated" | "task_notification") => {
                        self.transition(ActivityState::Working)
                    }
                    _ => None,
                },
                // Per-turn `result/success` or `result/error` ends the turn.
                // The translator only inspects `subtype == "success"` for cost,
                // but any `result` line means Claude is done — `Idle` regardless.
                "result" => self.transition(ActivityState::Idle),
                // Permission-prompt `control_request` parks the agent on the
                // user (or inbox). `translate_control_request` filters for
                // `subtype == "can_use_tool"`; mirror that filter here so a
                // future `interrupt` request doesn't false-positive into
                // AwaitingApproval.
                "control_request"
                    if v.get("request")
                        .and_then(|r| r.get("subtype"))
                        .and_then(Value::as_str)
                        == Some("can_use_tool") =>
                {
                    self.transition(ActivityState::AwaitingApproval)
                }
                _ => None,
            }
        };

        let mut outputs = match ty {
            "system" => self.translate_system(v),
            "assistant" => self.translate_assistant(v),
            "user" => self.translate_user(v),
            "result" => self.translate_result(v),
            "rate_limit_event" => v
                .get("rate_limit_info")
                .map(|info| vec![TranslatorOutput::RateLimit(info.clone())])
                .unwrap_or_default(),
            "control_request" => translate_control_request(v),
            // stream_event / unknown: drop (partials broadcast is a separate
            // concern; see 120ms coalesce in ADR 0001). Phase 24's
            // per-token streaming consumes `stream_event` — to be added
            // in a follow-up step.
            _ => Vec::new(),
        };
        if let Some(edge) = activity_edge.take() {
            outputs.insert(0, edge);
        }
        outputs
    }

    fn translate_system(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let subtype = v.get("subtype").and_then(Value::as_str).unwrap_or("");
        match subtype {
            "task_started" => self.on_task_started(v),
            "task_updated" => self.on_task_updated(v),
            "task_notification" => self.on_task_notification(v),
            // init / status / hook_started / hook_response: informational; drop.
            _ => Vec::new(),
        }
    }

    fn on_task_started(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let task_id_str = v.get("task_id").and_then(Value::as_str).unwrap_or("");
        let description = v.get("description").and_then(Value::as_str).unwrap_or("");
        let task_type = v.get("task_type").and_then(Value::as_str).unwrap_or("");

        if task_id_str.is_empty() {
            return Vec::new();
        }

        if task_type == "in_process_teammate" {
            // description starts with "{role}: <spawn prompt>"; extract role.
            let role = description
                .split_once(':')
                .map(|(r, _)| r.trim())
                .unwrap_or(description)
                .to_string();
            let agent_name = format!("{role}@{}", self.team_name);
            let agent_id = self.agent_id_for(&agent_name);
            vec![TranslatorOutput::Event(OrchestratorEvent::AgentSpawned {
                workspace_id: self.workspace_id,
                agent_id,
                team: self.team_name.clone(),
                role,
            })]
        } else {
            let task_id = self.task_id_for(task_id_str);
            let title = truncate(description, 80);
            vec![TranslatorOutput::Event(OrchestratorEvent::TaskCreated {
                workspace_id: self.workspace_id,
                task_id,
                title,
            })]
        }
    }

    fn on_task_updated(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let task_id_str = v.get("task_id").and_then(Value::as_str).unwrap_or("");
        let status = v
            .get("patch")
            .and_then(|p| p.get("status"))
            .and_then(Value::as_str);
        if status == Some("completed") && !task_id_str.is_empty() {
            let task_id = self.task_id_for(task_id_str);
            vec![TranslatorOutput::Event(OrchestratorEvent::TaskCompleted {
                workspace_id: self.workspace_id,
                task_id,
            })]
        } else {
            Vec::new()
        }
    }

    fn on_task_notification(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let status = v.get("status").and_then(Value::as_str);
        let summary = v.get("summary").and_then(Value::as_str).unwrap_or("");
        // `summary` for in-process teammate completion is "role@team"; that's
        // our TeammateIdle trigger.
        if status == Some("completed") && summary.contains('@') {
            let agent_id = self.agent_id_for(summary);
            vec![TranslatorOutput::Event(OrchestratorEvent::TeammateIdle {
                workspace_id: self.workspace_id,
                agent_id,
            })]
        } else {
            Vec::new()
        }
    }

    fn translate_assistant(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        if self.phase24 {
            return self.translate_assistant_phase24(v);
        }
        self.translate_assistant_legacy(v)
    }

    fn translate_assistant_legacy(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };

        let mut outputs = Vec::new();
        let mut text_parts: Vec<&str> = Vec::new();

        for block in content {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(Value::as_str) {
                        text_parts.push(t);
                    }
                }
                Some("tool_use") => {
                    let tool = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    let (title, summary) = tool_use_card(tool, &input);
                    let body = serde_json::to_string(&input).unwrap_or_default();
                    let tool_use_id = block.get("id").and_then(Value::as_str);
                    let artifact_id = match tool_use_id {
                        Some(id) => self.artifact_id_for(id),
                        // Defensive fallback. Anthropic's stream-json always
                        // populates `id`, but a fresh UUID keeps downstream
                        // contracts intact if the field is ever missing.
                        None => ArtifactId::new(),
                    };
                    outputs.push(TranslatorOutput::Event(
                        OrchestratorEvent::ArtifactProduced {
                            workspace_id: self.workspace_id,
                            artifact_id,
                            artifact_kind: ArtifactKind::Report,
                            title,
                            summary,
                            body,
                            author_role: Some(author_roles::AGENT.into()),
                        },
                    ));
                }
                _ => {} // thinking / other block kinds: ignore.
            }
        }

        if !text_parts.is_empty() {
            // Lead emits these; teammate messages surface via inbox files.
            outputs.push(TranslatorOutput::Event(OrchestratorEvent::MessagePosted {
                workspace_id: self.workspace_id,
                author_role: author_roles::TEAM_LEAD.into(),
                body: text_parts.join(""),
            }));
        }

        outputs
    }

    /// Phase 24 — project a coarse `assistant` envelope onto
    /// `AgentTurnStarted` (if a turn isn't already open with the same
    /// `message_id`) plus per-block `AgentContentBlockStarted` /
    /// `Delta` / `Ended` for each content block. The envelope's
    /// `tool_use` block ids land in the per-turn correlation map so
    /// the matching `tool_result` (carried by the next `user` envelope)
    /// can address the same `block_index`.
    ///
    /// This is the turn-level projection: each block's full body is
    /// emitted as a single `Delta`. Per-token streaming via
    /// `stream_event` lines is a separate consumer added in a follow-up
    /// step; the renderer's per-block accumulator is shape-compatible
    /// with both forms.
    fn translate_assistant_phase24(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let Some(message) = v.get("message") else {
            return Vec::new();
        };
        let Some(content) = message.get("content").and_then(Value::as_array) else {
            return Vec::new();
        };
        let Some(turn_id_str) = message.get("id").and_then(Value::as_str) else {
            // No `message.id` — Anthropic always populates it; if it's
            // missing the envelope is malformed. Drop rather than mint
            // a turn id we'd never reconcile against the matching
            // `result` line.
            debug!("phase24: assistant envelope missing message.id; dropping");
            return Vec::new();
        };
        let model = message
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let turn_id = ClaudeMessageId::new(turn_id_str);

        let mut outputs = Vec::new();

        // Open the turn if this is the first envelope with this id. A
        // mid-turn re-emission of the same id (rare but seen with
        // --verbose stream-json) reuses the open turn.
        let is_new_turn = match &self.turn {
            Some(t) => t.turn_id != turn_id,
            None => true,
        };
        if is_new_turn {
            // Close any stranded prior turn before opening a fresh one.
            // Defensive — Claude shouldn't emit overlapping ids, but
            // ending the prior turn cleanly avoids a leak in the
            // renderer's per-turn accumulator if it does.
            if let Some(prior) = self.turn.take() {
                outputs.push(turn_ended_output(
                    self.workspace_id,
                    self.tab_id,
                    prior.turn_id,
                    prior
                        .pending_stop_reason
                        .unwrap_or(AgentStopReason::EndTurn),
                    prior.pending_usage,
                ));
            }
            // session_id is captured from `system/init`. Unwrap-or a
            // fresh-uuid fallback only fires if init never landed,
            // which shouldn't happen in --print stream-json but keeps
            // the field load-bearing.
            let session_id = self
                .session_id
                .clone()
                .unwrap_or_else(|| ClaudeSessionId::new(Uuid::new_v4().to_string()));
            outputs.push(TranslatorOutput::Event(
                OrchestratorEvent::AgentTurnStarted {
                    workspace_id: self.workspace_id,
                    tab_id: self.tab_id,
                    turn_id: turn_id.clone(),
                    model,
                    session_id,
                },
            ));
            self.turn = Some(TurnState {
                turn_id: turn_id.clone(),
                pending_stop_reason: None,
                pending_usage: TokenUsage::default(),
                ended: false,
                tool_use_blocks: HashMap::new(),
            });
        }

        // Emit one block-trio per content entry. The block_index is
        // the array position; same shape the Messages API carries for
        // `content_block_start.index`.
        for (idx, block) in content.iter().enumerate() {
            let block_index = idx as u32;
            let Some(block_kind) = block_kind_from_value(block) else {
                continue; // unknown block type — drop, don't synthesize.
            };
            // Track tool_use ids in the per-turn correlation map.
            if let AgentContentBlockKind::ToolUse { tool_use_id, .. } = &block_kind {
                if let Some(turn) = self.turn.as_mut() {
                    turn.tool_use_blocks
                        .insert(tool_use_id.clone(), block_index);
                }
            }
            let delta = block_delta_text(block).unwrap_or_default();

            outputs.push(TranslatorOutput::Event(
                OrchestratorEvent::AgentContentBlockStarted {
                    workspace_id: self.workspace_id,
                    tab_id: self.tab_id,
                    turn_id: turn_id.clone(),
                    block_index,
                    block_kind,
                },
            ));
            if !delta.is_empty() {
                outputs.push(TranslatorOutput::Event(
                    OrchestratorEvent::AgentContentBlockDelta {
                        workspace_id: self.workspace_id,
                        tab_id: self.tab_id,
                        turn_id: turn_id.clone(),
                        block_index,
                        delta,
                    },
                ));
            }
            outputs.push(TranslatorOutput::Event(
                OrchestratorEvent::AgentContentBlockEnded {
                    workspace_id: self.workspace_id,
                    tab_id: self.tab_id,
                    turn_id: turn_id.clone(),
                    block_index,
                },
            ));
        }

        // Capture stop_reason from message.stop_reason (when present
        // on the coarse envelope — Claude includes it on the final
        // assistant payload). Held until `result/success` lands so
        // both events emit in the right order.
        if let Some(reason_str) = message.get("stop_reason").and_then(Value::as_str) {
            if let Some(turn) = self.turn.as_mut() {
                turn.pending_stop_reason = Some(stop_reason_from_str(reason_str));
            }
        }
        if let Some(usage) = message.get("usage") {
            if let Some(turn) = self.turn.as_mut() {
                turn.pending_usage = merge_usage(turn.pending_usage, usage);
            }
        }

        outputs
    }

    /// Translate a `user` typed envelope. The `user` line carries the
    /// turn-result echoes that complete the assistant's `tool_use` blocks
    /// (`tool_result` content blocks). Per F5+1 (legacy mode) we match
    /// those back to the originating `ArtifactProduced` and emit
    /// `ArtifactUpdated` with the result summary; per Phase 24 (mode on)
    /// we emit `AgentToolResult` against the per-turn correlation map.
    fn translate_user(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        if self.phase24 {
            return self.translate_user_phase24(v);
        }
        self.translate_user_legacy(v)
    }

    fn translate_user_legacy(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };

        let mut outputs = Vec::new();
        for block in content {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let Some(tool_use_id) = block.get("tool_use_id").and_then(Value::as_str) else {
                continue;
            };
            let Some(artifact_id) = self.tool_uses.get(tool_use_id) else {
                // No producing `tool_use` recorded — skip rather than
                // synthesise a phantom artifact. The most common cause is
                // LRU eviction of a multi-day-old tool_use; see
                // `TRANSLATOR_STATE_MAX_ENTRIES`.
                debug!(
                    ?tool_use_id,
                    "tool_result with no matching tool_use; dropping"
                );
                continue;
            };
            let Some(mut summary) = tool_result_summary(block.get("content")) else {
                // Non-text result (image-only, unrecognised shape) carries
                // no rail-altitude line to surface; skip the update rather
                // than emit a blank summary that overwrites the produced
                // card with whitespace.
                continue;
            };
            if block
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                // Anthropic API marks failed tool invocations with
                // `is_error: true`. Surface that explicitly so the rail
                // doesn't render an error result identically to a success.
                summary = format!("Failed: {summary}");
            }
            outputs.push(TranslatorOutput::Event(
                OrchestratorEvent::ArtifactUpdated {
                    workspace_id: self.workspace_id,
                    artifact_id,
                    summary,
                },
            ));
        }
        outputs
    }

    /// Phase 24 — emit `AgentToolResult` for each `tool_result` block in
    /// the user envelope, correlating against the open turn's
    /// `tool_use_blocks` map. Tool results that arrive after the turn
    /// closed (or for an unknown id) are dropped with a debug log; the
    /// per-turn map deliberately doesn't outlive the turn.
    fn translate_user_phase24(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };
        let Some(turn) = self.turn.as_ref() else {
            // No open turn means no in-flight tool calls to correlate
            // against. Drop rather than fabricate a turn boundary.
            return Vec::new();
        };
        let turn_id = turn.turn_id.clone();

        let mut outputs = Vec::new();
        for block in content {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let Some(tool_use_id) = block.get("tool_use_id").and_then(Value::as_str) else {
                continue;
            };
            // Phase 24 §3.1: out-of-turn results are discarded with a
            // logged warning. With stream-json discipline this should
            // not happen — tool results land within the turn that
            // emitted them.
            if !turn.tool_use_blocks.contains_key(tool_use_id) {
                debug!(
                    ?tool_use_id,
                    "phase24: tool_result for unknown tool_use_id; dropping"
                );
                continue;
            }
            let content_text = tool_result_content_string(block.get("content"));
            let is_error = block
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            outputs.push(TranslatorOutput::Event(
                OrchestratorEvent::AgentToolResult {
                    workspace_id: self.workspace_id,
                    tab_id: self.tab_id,
                    turn_id: turn_id.clone(),
                    tool_use_id: tool_use_id.to_string(),
                    content: content_text,
                    is_error,
                },
            ));
        }
        outputs
    }

    fn translate_result(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let subtype = v.get("subtype").and_then(Value::as_str).unwrap_or("");
        let mut outputs = Vec::new();

        // Cost extraction is mode-independent — the cost chip subscribes
        // identically in both modes.
        if subtype == "success" {
            if let Some(cost) = v.get("total_cost_usd").and_then(Value::as_f64) {
                outputs.push(TranslatorOutput::Cost(cost));
            }
        }

        if !self.phase24 {
            return outputs;
        }

        // Phase 24 §11.0 P2 spike: SIGINT-interrupted turns surface as
        // `result/error_during_execution` with `stop_reason: null`. We
        // synthesize `AgentTurnEnded { Interrupted }` for that subtype
        // — the legacy `translate_result` early-returned and the event
        // was lost.
        let stop_reason_for_close = match subtype {
            "success" => Some(AgentStopReason::EndTurn),
            "error_during_execution" => Some(AgentStopReason::Interrupted),
            "error_max_turns" => Some(AgentStopReason::MaxTokens),
            "error" => Some(AgentStopReason::Error),
            _ => None,
        };

        if let Some(default_reason) = stop_reason_for_close {
            // Pull the open turn out, finalize, and emit. If a
            // `message.stop_reason` already landed (more authoritative
            // than the result envelope's coarse subtype), prefer it.
            if let Some(turn) = self.turn.take() {
                if turn.ended {
                    // Already closed — this is a stray result echo.
                    self.turn = Some(turn);
                } else {
                    let stop_reason = turn.pending_stop_reason.unwrap_or(default_reason);
                    let usage = result_usage(v).unwrap_or(turn.pending_usage);
                    outputs.push(turn_ended_output(
                        self.workspace_id,
                        self.tab_id,
                        turn.turn_id,
                        stop_reason,
                        usage,
                    ));
                }
            }
        }

        outputs
    }

    fn agent_id_for(&mut self, name: &str) -> AgentId {
        if let Some(id) = self.agents.get(name) {
            return id;
        }
        let ns = *self.workspace_id.as_uuid();
        let id = AgentId::from_uuid(Uuid::new_v5(&ns, name.as_bytes()));
        self.agents.insert(name.to_string(), id);
        id
    }

    fn task_id_for(&mut self, claude_id: &str) -> TaskId {
        if let Some(id) = self.tasks.get(claude_id) {
            return id;
        }
        let ns = *self.workspace_id.as_uuid();
        let id = TaskId::from_uuid(Uuid::new_v5(&ns, claude_id.as_bytes()));
        self.tasks.insert(claude_id.to_string(), id);
        id
    }

    fn artifact_id_for(&mut self, tool_use_id: &str) -> ArtifactId {
        if let Some(id) = self.tool_uses.get(tool_use_id) {
            return id;
        }
        let ns = *self.workspace_id.as_uuid();
        let id = ArtifactId::from_uuid(Uuid::new_v5(&ns, tool_use_id.as_bytes()));
        self.tool_uses.insert(tool_use_id.to_string(), id);
        id
    }
}

/// Tiny bounded LRU built on `HashMap` + `VecDeque<K>`. `get` and `insert`
/// move the touched key to the back (most-recently-used); when `insert`
/// would push the size past `cap`, the least-recently-used key is evicted.
///
/// PERF: `position`-based bumps are O(n) on the deque. Acceptable at the
/// translator's `TRANSLATOR_STATE_MAX_ENTRIES = 1024` cap because each call
/// runs once per stream-json line, dwarfed by `serde_json::from_str`. A
/// future caller using `BoundedMap` for a hotter path should switch to a
/// generation-counter shape (`HashMap<K, (V, u64)>` + tick + scan-on-evict)
/// or pull `lru` / `linked-hash-map` as a direct dep. Neither is in the
/// tree today — the API surface needed here is two methods.
struct BoundedMap<K, V> {
    cap: usize,
    map: HashMap<K, V>,
    /// Front = least recently used, back = most recently used.
    order: VecDeque<K>,
}

impl<K: Clone + Eq + Hash, V: Copy> BoundedMap<K, V> {
    fn with_capacity(cap: usize) -> Self {
        debug_assert!(cap > 0, "BoundedMap cap must be > 0");
        Self {
            cap,
            map: HashMap::with_capacity(cap),
            order: VecDeque::with_capacity(cap),
        }
    }

    fn get<Q>(&mut self, k: &Q) -> Option<V>
    where
        K: std::borrow::Borrow<Q>,
        Q: ?Sized + Eq + Hash,
    {
        let v = *self.map.get(k)?;
        // Bump to most-recently-used. The `unwrap` documents the
        // post-condition of `position`: we just walked the deque and
        // found `pos`, so removing at that index can't fail without a
        // concurrent mutation — and `&mut self` rules that out.
        if let Some(pos) = self.order.iter().position(|x| x.borrow() == k) {
            let key = self.order.remove(pos).unwrap();
            self.order.push_back(key);
        }
        Some(v)
    }

    fn insert(&mut self, k: K, v: V) {
        if self.map.contains_key(&k) {
            if let Some(pos) = self.order.iter().position(|x| x == &k) {
                self.order.remove(pos);
            }
            self.order.push_back(k.clone());
            self.map.insert(k, v);
            return;
        }
        if self.map.len() >= self.cap {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
        self.order.push_back(k.clone());
        self.map.insert(k, v);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.map.len()
    }
}

/// Phase 24 — extract a `tool_result.content` Value (string OR
/// Anthropic content-block array) as a single string for
/// `AgentToolResult.content`. Unlike [`tool_result_summary`] this does
/// not truncate or discard non-text blocks; the renderer chooses how to
/// surface the full body, so we hand it through verbatim.
fn tool_result_content_string(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        let parts: Vec<&str> = arr
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(Value::as_str) == Some("text") {
                    b.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect();
        return parts.join("\n");
    }
    String::new()
}

/// Phase 24 — read a content block's `type` field and project to
/// [`AgentContentBlockKind`]. Returns `None` for unrecognised block
/// types so the caller can skip rather than synthesize a phantom block.
fn block_kind_from_value(block: &Value) -> Option<AgentContentBlockKind> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => Some(AgentContentBlockKind::Text),
        "thinking" => Some(AgentContentBlockKind::Thinking),
        "tool_use" => {
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let tool_use_id = block.get("id").and_then(Value::as_str)?.to_string();
            Some(AgentContentBlockKind::ToolUse { name, tool_use_id })
        }
        _ => None,
    }
}

/// Phase 24 — pull the deltable text out of a content block. For
/// `text`, the `text` field; for `thinking`, the `thinking` field; for
/// `tool_use`, a JSON-encoded `input` object. Empty string when the
/// block carries no text body. Mirrors the per-block delta that
/// per-token streaming would emit incrementally — turn-level mode
/// emits the full body in one delta; the renderer's per-block
/// accumulator is shape-compatible with both.
fn block_delta_text(block: &Value) -> Option<String> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => block
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string),
        "thinking" => block
            .get("thinking")
            .and_then(Value::as_str)
            .map(str::to_string),
        "tool_use" => {
            let input = block.get("input").cloned().unwrap_or(Value::Null);
            Some(serde_json::to_string(&input).unwrap_or_default())
        }
        _ => None,
    }
}

/// Phase 24 — string `stop_reason` (per Anthropic Messages API) →
/// typed [`AgentStopReason`]. Unknown values fall back to `EndTurn`
/// rather than `Error` because a model that emits a forward-compatible
/// stop reason we don't recognise is closer to a clean turn end than
/// to a failure.
fn stop_reason_from_str(s: &str) -> AgentStopReason {
    match s {
        "end_turn" => AgentStopReason::EndTurn,
        "tool_use" => AgentStopReason::ToolUse,
        "max_tokens" => AgentStopReason::MaxTokens,
        "stop_sequence" => AgentStopReason::EndTurn,
        // Phase 24 §11.0 P2 — interrupted turns carry `null` here and
        // are pinned by the `result.subtype: error_during_execution`
        // envelope; this branch handles a future shape where the
        // assistant envelope itself carries `interrupted`.
        "interrupted" => AgentStopReason::Interrupted,
        "error" => AgentStopReason::Error,
        _ => AgentStopReason::EndTurn,
    }
}

/// Phase 24 — accumulate per-turn usage across `message.usage` blocks
/// from successive assistant envelopes. Anthropic's Messages API
/// reports cumulative counts per envelope; taking the maximum on each
/// field is the correct merge.
fn merge_usage(prev: TokenUsage, usage: &Value) -> TokenUsage {
    let pick = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0) as u32;
    TokenUsage {
        input: prev.input.max(pick("input_tokens")),
        output: prev.output.max(pick("output_tokens")),
        cache_read: prev.cache_read.max(pick("cache_read_input_tokens")),
        cache_creation: prev.cache_creation.max(pick("cache_creation_input_tokens")),
    }
}

/// Phase 24 — pull the final-turn usage from a `result/success`
/// envelope's `usage` block, when present. `result/error*` envelopes
/// rarely carry a complete usage block; the caller falls back to the
/// turn's accumulated `pending_usage`.
fn result_usage(v: &Value) -> Option<TokenUsage> {
    let usage = v.get("usage")?;
    Some(merge_usage(TokenUsage::default(), usage))
}

/// Phase 24 — package a finalized turn into an `AgentTurnEnded`
/// translator output. Inlined out of `translate_result` so the
/// stranded-prior-turn cleanup branch in `translate_assistant_phase24`
/// can reuse the same shape.
fn turn_ended_output(
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,
    stop_reason: AgentStopReason,
    usage: TokenUsage,
) -> TranslatorOutput {
    TranslatorOutput::Event(OrchestratorEvent::AgentTurnEnded {
        workspace_id,
        tab_id,
        turn_id,
        stop_reason,
        usage,
    })
}

/// Reduce a `tool_result.content` Value (string OR Anthropic content-block
/// array) to a single short summary. Returns `None` for empty / non-text
/// shapes (image-only results, unrecognised payloads) so the caller can
/// skip the `ArtifactUpdated` emission rather than blanking the produced
/// card with whitespace.
fn tool_result_summary(content: Option<&Value>) -> Option<String> {
    let content = content?;
    let raw = if let Some(s) = content.as_str() {
        s.to_string()
    } else if let Some(arr) = content.as_array() {
        let texts: Vec<&str> = arr
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(Value::as_str) == Some("text") {
                    b.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect();
        texts.join("\n")
    } else {
        return None;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_with_ellipsis(trimmed, TOOL_SUMMARY_MAX))
}

/// Char-count truncate that returns the input unchanged when it already fits,
/// avoiding an allocation in the common (short-path) case.
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().nth(max_chars).is_none() {
        return s.to_string();
    }
    s.chars().take(max_chars).collect()
}

/// Like `truncate`, but appends a `…` (single-char) ellipsis when the
/// input was actually trimmed. Used by `tool_result_summary` so a
/// mid-word cut doesn't read as a bug at the rail altitude. Mirrors the
/// grammar of `core_agents::first_line_truncate`, keeping rail surfaces
/// consistent. Total length stays bounded — the ellipsis displaces one
/// character of content, never grows past `max_chars`.
fn truncate_with_ellipsis(s: &str, max_chars: usize) -> String {
    debug_assert!(max_chars > 0);
    if s.chars().nth(max_chars).is_none() {
        return s.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let mut out: String = s.chars().take(keep).collect();
    out.push('…');
    out
}

/// Strip directory components from a `/`-style path; falls back to the input
/// when there's no slash. Used by `tool_use_card` to surface the leaf in the
/// title while keeping the full path in the summary.
fn basename(path: &str) -> &str {
    path.rsplit_once('/').map(|(_, name)| name).unwrap_or(path)
}

/// First whitespace-delimited token of a shell command, used as the verb in
/// "Ran git" / "Ran cargo". Falls back to a generic "Ran" for empty input.
fn shell_verb(command: &str) -> &str {
    command.split_whitespace().next().unwrap_or("command")
}

/// Build (title, summary) for a `tool_use` block. Title is verb-first
/// present-tense ("Read CLAUDE.md", "Wrote x.txt", "Ran git push origin main")
/// so the rail reads as agent action, not engineer log lines. Summary holds
/// the full path/command so the expanded view drills in.
fn tool_use_card(tool: &str, input: &Value) -> (String, String) {
    let pick = |key: &str| input.get(key).and_then(Value::as_str);
    let pair = |verb: &str, full: Option<&str>| match full {
        Some(p) => (
            format!("{verb} {}", basename(p)),
            truncate(p, TOOL_SUMMARY_MAX),
        ),
        None => (verb.to_string(), String::new()),
    };
    match tool {
        "Read" => pair("Read", pick("file_path").or_else(|| pick("path"))),
        "Write" => pair("Wrote", pick("file_path")),
        "Edit" | "MultiEdit" | "NotebookEdit" => pair("Edited", pick("file_path")),
        "Glob" => pair(
            "Searched files",
            pick("pattern").or_else(|| pick("file_path")),
        ),
        "Grep" => match pick("pattern") {
            Some(p) => (
                format!("Searched for \"{}\"", truncate(p, 60)),
                pick("path")
                    .or_else(|| pick("glob"))
                    .map(|p| truncate(p, TOOL_SUMMARY_MAX))
                    .unwrap_or_default(),
            ),
            None => ("Searched".into(), String::new()),
        },
        "Bash" => match pick("command") {
            Some(c) => (
                format!("Ran {}", shell_verb(c)),
                truncate(c, TOOL_SUMMARY_MAX),
            ),
            None => ("Ran command".into(), String::new()),
        },
        _ => (format!("Used {tool}"), String::new()),
    }
}

const TOOL_SUMMARY_MAX: usize = 120;

/// Parse a `--permission-prompt-tool stdio` request into a
/// [`TranslatorOutput::PermissionPrompt`]. The stdio protocol's `subtype` is
/// `can_use_tool`; anything else is a future or unrelated control request and
/// gets dropped here. Wire shape captured under
/// `tests/fixtures/permission_prompt/`.
fn translate_control_request(v: &Value) -> Vec<TranslatorOutput> {
    let request_id = v
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let Some(req) = v.get("request") else {
        return Vec::new();
    };
    if req.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
        return Vec::new();
    }
    let tool = req
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if request_id.is_empty() || tool.is_empty() {
        return Vec::new();
    }
    // Defer the (potentially large) input clone until validity passes.
    let input = req.get("input").cloned().unwrap_or(Value::Null);
    let display = req
        .get("display_name")
        .and_then(Value::as_str)
        .unwrap_or(&tool);
    let (_, raw_summary) = tool_use_card(&tool, &input);
    let summary = if raw_summary.is_empty() {
        display.to_string()
    } else {
        format!("{display}: {raw_summary}")
    };
    let tool_use_id = req
        .get("tool_use_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    vec![TranslatorOutput::PermissionPrompt {
        request_id,
        tool,
        input,
        summary,
        tool_use_id,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::{TabId, WorkspaceId};

    fn ws() -> WorkspaceId {
        // Deterministic workspace id so v5 mapping is stable across runs.
        WorkspaceId::from_uuid(Uuid::parse_str("00000000-0000-7000-8000-000000000001").unwrap())
    }

    fn tab() -> TabId {
        // Deterministic tab id so the per-tab `ActivityChanged` events
        // the translator now emits are stable across runs.
        TabId::from_uuid(Uuid::parse_str("00000000-0000-7000-8000-000000000aaa").unwrap())
    }

    /// Phase 23.B — strip the activity-state edges so existing
    /// assertions about translator output shape (TaskCreated count,
    /// MessagePosted body, …) keep matching the *substantive* events
    /// they were authored for. Activity transitions get their own
    /// targeted tests.
    fn non_activity(out: Vec<TranslatorOutput>) -> Vec<TranslatorOutput> {
        out.into_iter()
            .filter(|o| {
                !matches!(
                    o,
                    TranslatorOutput::Event(OrchestratorEvent::ActivityChanged { .. })
                )
            })
            .collect()
    }

    #[test]
    fn unparseable_line_produces_no_output() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        assert!(t.translate("not json").is_empty());
        assert!(t.translate("").is_empty());
    }

    #[test]
    fn task_started_non_teammate_emits_task_created() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_started","task_id":"t9zu6heo5","description":"Run the tests","task_type":"regular"}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::TaskCreated { title, .. }) => {
                assert_eq!(title, "Run the tests");
            }
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn task_started_in_process_teammate_emits_agent_spawned() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_started","task_id":"t9zu6heo5","description":"researcher: You are the researcher teammate.","task_type":"in_process_teammate"}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::AgentSpawned { role, team, .. }) => {
                assert_eq!(role, "researcher");
                assert_eq!(team, "dir-recon");
            }
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn task_updated_completed_emits_task_completed() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_updated","task_id":"bacnr21el","patch":{"status":"completed","end_time":1776871130382}}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        assert!(matches!(
            out[0],
            TranslatorOutput::Event(OrchestratorEvent::TaskCompleted { .. })
        ));
    }

    #[test]
    fn task_updated_non_completed_emits_nothing() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_updated","task_id":"x","patch":{"status":"in_progress"}}"#;
        // Phase 23.B: `task_updated` flips activity to `Working`; that
        // edge is intentional — the test guards the substantive
        // output (no `TaskCompleted` for an in-progress patch).
        assert!(non_activity(t.translate(line)).is_empty());
    }

    #[test]
    fn task_notification_completed_with_at_summary_emits_idle() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_notification","task_id":"t9zu6heo5","status":"completed","summary":"researcher@dir-recon"}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        assert!(matches!(
            out[0],
            TranslatorOutput::Event(OrchestratorEvent::TeammateIdle { .. })
        ));
    }

    #[test]
    fn rate_limit_event_surfaces_raw_info() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1776884400,"rateLimitType":"five_hour"}}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::RateLimit(info) => {
                assert_eq!(
                    info.get("rateLimitType").and_then(Value::as_str),
                    Some("five_hour")
                );
            }
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn result_success_emits_cost() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line =
            r#"{"type":"result","subtype":"success","total_cost_usd":0.36,"duration_ms":17222}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Cost(c) => assert!((c - 0.36).abs() < 1e-6),
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn assistant_text_emits_message_posted() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello from the lead."}]}}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::MessagePosted {
                body, author_role, ..
            }) => {
                assert_eq!(body, "Hello from the lead.");
                assert_eq!(author_role, "team-lead");
            }
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn tool_use_block_emits_artifact_produced() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        // Mixed text + tool_use blocks. Expect: 1 ArtifactProduced
        // ("Read CLAUDE.md") + 1 MessagePosted with concatenated text.
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Reading CLAUDE.md."},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/repo/CLAUDE.md"}}]}}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 2);
        let mut saw_artifact = false;
        let mut saw_message = false;
        for o in &out {
            match o {
                TranslatorOutput::Event(OrchestratorEvent::ArtifactProduced {
                    title,
                    summary,
                    artifact_kind,
                    author_role,
                    ..
                }) => {
                    assert_eq!(title, "Read CLAUDE.md");
                    assert_eq!(summary, "/repo/CLAUDE.md");
                    assert!(matches!(artifact_kind, designer_core::ArtifactKind::Report));
                    assert_eq!(author_role.as_deref(), Some("agent"));
                    saw_artifact = true;
                }
                TranslatorOutput::Event(OrchestratorEvent::MessagePosted { body, .. }) => {
                    assert_eq!(body, "Reading CLAUDE.md.");
                    saw_message = true;
                }
                other => panic!("unexpected output: {other:?}"),
            }
        }
        assert!(saw_artifact, "expected one ArtifactProduced");
        assert!(saw_message, "expected one MessagePosted");
    }

    #[test]
    fn tool_use_only_assistant_emits_artifact_only() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"git status"}}]}}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactProduced {
                title, summary, ..
            }) => {
                assert_eq!(title, "Ran git");
                assert_eq!(summary, "git status");
            }
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn tool_use_card_titles_are_verb_first() {
        // Lock the verb-first microcopy across all five families. If a
        // future regression flips back to "Used X" this test catches it.
        let cases = [
            (
                "Read",
                serde_json::json!({"file_path":"/a/b.txt"}),
                "Read b.txt",
            ),
            (
                "Write",
                serde_json::json!({"file_path":"/a/b.txt"}),
                "Wrote b.txt",
            ),
            (
                "Edit",
                serde_json::json!({"file_path":"/a/b.txt"}),
                "Edited b.txt",
            ),
            (
                "Grep",
                serde_json::json!({"pattern":"auth"}),
                "Searched for \"auth\"",
            ),
            (
                "Bash",
                serde_json::json!({"command":"git push origin main"}),
                "Ran git",
            ),
        ];
        for (tool, input, expected) in cases {
            let (title, _) = tool_use_card(tool, &input);
            assert_eq!(title, expected, "title mismatch for {tool}");
        }
    }

    #[test]
    fn control_request_can_use_tool_emits_permission_prompt() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","input":{"file_path":"/tmp/x.txt","content":"hi"},"tool_use_id":"toolu_x"}}"#;
        let out = non_activity(t.translate(line));
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::PermissionPrompt {
                request_id,
                tool,
                input,
                summary,
                tool_use_id,
            } => {
                assert_eq!(request_id, "req-1");
                assert_eq!(tool, "Write");
                assert_eq!(
                    input.get("file_path").and_then(|v| v.as_str()),
                    Some("/tmp/x.txt")
                );
                assert!(summary.contains("/tmp/x.txt"));
                assert_eq!(tool_use_id.as_deref(), Some("toolu_x"));
            }
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn control_request_without_can_use_tool_subtype_drops() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line =
            r#"{"type":"control_request","request_id":"req-2","request":{"subtype":"interrupt"}}"#;
        // Phase 23.B: only `subtype: can_use_tool` triggers the
        // AwaitingApproval transition, so this line emits *nothing*.
        // No filter needed.
        assert!(t.translate(line).is_empty());
    }

    #[test]
    fn encode_permission_response_allow_includes_updated_input() {
        use crate::permission::PermissionDecision;
        let original = serde_json::json!({"file_path":"/x.txt","content":"hi"});
        let bytes = PermissionDecision::Accept.encode_response("req-9", &original);
        let s = std::str::from_utf8(&bytes).unwrap();
        assert!(s.ends_with('\n'));
        let parsed: serde_json::Value = serde_json::from_str(s.trim()).unwrap();
        assert_eq!(parsed["type"], "control_response");
        assert_eq!(parsed["response"]["subtype"], "success");
        assert_eq!(parsed["response"]["request_id"], "req-9");
        assert_eq!(parsed["response"]["response"]["behavior"], "allow");
        assert_eq!(
            parsed["response"]["response"]["updatedInput"]["file_path"],
            "/x.txt"
        );
    }

    #[test]
    fn encode_permission_response_deny_includes_message() {
        use crate::permission::PermissionDecision;
        let bytes = PermissionDecision::Deny {
            reason: "user denied".into(),
        }
        .encode_response("req-10", &Value::Null);
        let parsed: serde_json::Value = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
        assert_eq!(parsed["response"]["response"]["behavior"], "deny");
        assert_eq!(parsed["response"]["response"]["message"], "user denied");
    }

    #[test]
    fn agent_id_is_deterministic_across_invocations() {
        let mut a = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let mut b = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let id_a = a.agent_id_for("researcher@dir-recon");
        let id_b = b.agent_id_for("researcher@dir-recon");
        assert_eq!(id_a, id_b);
    }

    #[test]
    fn ignores_init_status_empty_user_and_stream_events() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        // Phase 23.B note: `user` and `stream_event` lines now flip
        // activity to `Working` (the user-tool_result and partial-delta
        // are evidence the agent is computing). The substantive
        // translation still drops these as a no-op, so the test
        // filters out the activity edge before asserting "no real
        // event emitted." `system/init` / `status` / `hook_started`
        // are excluded from the activity trigger by design (init
        // arrives at boot before any user message).
        let lines = [
            r#"{"type":"system","subtype":"init","cwd":"/x"}"#,
            r#"{"type":"system","subtype":"status"}"#,
            r#"{"type":"user","message":{}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta"}}"#,
            r#"{"type":"system","subtype":"hook_started","hook_id":"h1"}"#,
        ];
        for line in lines {
            assert!(
                non_activity(t.translate(line)).is_empty(),
                "expected empty for {line}"
            );
        }
    }

    /// F5+1: an assistant `tool_use` followed (in a later user-typed line)
    /// by the matching `tool_result` block produces one `ArtifactProduced`
    /// then one `ArtifactUpdated` against the *same* artifact id, so the
    /// rail's "Read CLAUDE.md" card gains a result summary in place.
    #[test]
    fn tool_use_followed_by_tool_result_emits_correlated_update() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");

        let assistant = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_corr","name":"Read","input":{"file_path":"/repo/CLAUDE.md"}}]}}"#;
        let produced = non_activity(t.translate(assistant));
        assert_eq!(produced.len(), 1);
        let original_id = match &produced[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactProduced {
                artifact_id,
                title,
                ..
            }) => {
                assert_eq!(title, "Read CLAUDE.md");
                *artifact_id
            }
            other => panic!("expected ArtifactProduced, got {other:?}"),
        };

        let user = r##"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_corr","content":"# Designer\n\nLocal-first cockpit..."}]}}"##;
        let updated = non_activity(t.translate(user));
        assert_eq!(updated.len(), 1);
        match &updated[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated {
                artifact_id,
                summary,
                ..
            }) => {
                assert_eq!(*artifact_id, original_id);
                assert!(summary.contains("Designer"));
            }
            other => panic!("expected ArtifactUpdated, got {other:?}"),
        }
    }

    /// `tool_result.content` may be an array of content blocks (Anthropic
    /// API shape). Text blocks concatenate; non-text blocks (image refs)
    /// drop. Same artifact-id correlation as the string case.
    #[test]
    fn tool_result_with_content_block_array_concatenates_text() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t.translate(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_arr","name":"Bash","input":{"command":"ls"}}]}}"#,
        );
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_arr","content":[{"type":"text","text":"file_a.rs"},{"type":"text","text":"file_b.rs"}]}]}}"#;
        let out = t.translate(user);
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { summary, .. }) => {
                assert!(summary.contains("file_a.rs"));
                assert!(summary.contains("file_b.rs"));
            }
            other => panic!("expected ArtifactUpdated, got {other:?}"),
        }
    }

    /// A `tool_result` whose `tool_use_id` was never seen drops silently —
    /// the translator never invents a phantom artifact id.
    #[test]
    fn unmatched_tool_result_drops() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_ghost","content":"orphaned"}]}}"#;
        // Activity edge (`user` line ⇒ Working) is allowed; the test
        // is about not minting a phantom artifact for an orphan
        // tool_result.
        assert!(non_activity(t.translate(line)).is_empty());
    }

    /// Inserting more than `TRANSLATOR_STATE_MAX_ENTRIES` distinct task
    /// ids must keep the map bounded; the oldest entry must be evicted.
    /// Locks Step 2's bounded-state guarantee.
    #[test]
    fn translator_state_is_bounded_at_cap() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let first_assistant = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_first","name":"Read","input":{"file_path":"/0.txt"}}]}}"#;
        t.translate(first_assistant);

        let overflow = TRANSLATOR_STATE_MAX_ENTRIES + 50;
        for i in 1..=overflow {
            let line = format!(
                r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"toolu_{i}","name":"Read","input":{{"file_path":"/{i}.txt"}}}}]}}}}"#
            );
            t.translate(&line);
        }
        assert!(t.tool_uses.len() <= TRANSLATOR_STATE_MAX_ENTRIES);
        // The first inserted key must have been evicted.
        assert!(
            t.tool_uses.get("toolu_first").is_none(),
            "oldest key should have been evicted under LRU pressure"
        );
        // A recently-inserted key must still resolve.
        let recent = format!("toolu_{overflow}");
        assert!(t.tool_uses.get(&recent).is_some());
    }

    /// LRU contract: a hit on the *oldest* key bumps it to the back, so
    /// the next eviction targets the second-oldest instead.
    #[test]
    fn bounded_map_get_bumps_to_most_recently_used() {
        let mut m = BoundedMap::<String, u32>::with_capacity(3);
        m.insert("a".into(), 1);
        m.insert("b".into(), 2);
        m.insert("c".into(), 3);
        // Touch "a" so it becomes MRU; "b" is now LRU.
        assert_eq!(m.get("a"), Some(1));
        m.insert("d".into(), 4);
        assert_eq!(m.len(), 3);
        assert_eq!(m.get("b"), None, "b should have been evicted");
        assert_eq!(m.get("a"), Some(1));
        assert_eq!(m.get("c"), Some(3));
        assert_eq!(m.get("d"), Some(4));
    }

    /// `tool_result.is_error: true` (Anthropic API spec) flows through
    /// the translator with a `Failed:` prefix on the summary so the rail
    /// can render error and success results distinguishably without an
    /// event-shape change.
    #[test]
    fn tool_result_is_error_prefixes_failed() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t.translate(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_err","name":"Read","input":{"file_path":"/missing.txt"}}]}}"#,
        );
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_err","content":"ENOENT: no such file or directory","is_error":true}]}}"#;
        let out = t.translate(user);
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { summary, .. }) => {
                assert!(
                    summary.starts_with("Failed: "),
                    "expected error prefix, got {summary:?}"
                );
                assert!(summary.contains("ENOENT"));
            }
            other => panic!("expected ArtifactUpdated, got {other:?}"),
        }
    }

    /// A `tool_result` whose only content blocks are non-text
    /// (e.g. images) carries no rail-altitude line. The translator
    /// drops the update rather than emit a blank `ArtifactUpdated`
    /// that would whitespace-overwrite the produced card's summary.
    #[test]
    fn tool_result_with_only_image_drops_update() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t.translate(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_img","name":"Read","input":{"file_path":"/a.png"}}]}}"#,
        );
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_img","content":[{"type":"image","source":{"type":"base64","data":"...","media_type":"image/png"}}]}]}}"#;
        assert!(t.translate(user).is_empty());
    }

    /// A long `tool_result.content` is truncated *with* an ellipsis so a
    /// mid-word cut reads as "more available, drill in" instead of a
    /// rendering bug. Mirrors `core_agents::first_line_truncate`.
    #[test]
    fn tool_result_long_content_appends_ellipsis() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t.translate(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_long","name":"Read","input":{"file_path":"/big.txt"}}]}}"#,
        );
        // 200 chars, well past TOOL_SUMMARY_MAX = 120.
        let body = "a".repeat(200);
        let line = format!(
            r##"{{"type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"toolu_long","content":"{body}"}}]}}}}"##
        );
        let out = t.translate(&line);
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { summary, .. }) => {
                assert!(summary.ends_with('…'));
                assert_eq!(summary.chars().count(), 120);
            }
            other => panic!("expected ArtifactUpdated, got {other:?}"),
        }
    }

    /// Locks the produce → evict → tool_result interaction: when a
    /// `tool_use_id` falls out of the bounded LRU before its matching
    /// `tool_result` arrives, the translator must drop silently rather
    /// than mint a phantom `ArtifactId`. Catches a "fix the orphan"
    /// regression that would silently spawn sibling artifacts.
    #[test]
    fn evicted_tool_use_then_tool_result_drops_silently() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        // Insert the producing tool_use, then push >cap distinct ids so
        // the original is evicted under LRU pressure.
        let producer = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_evicted","name":"Read","input":{"file_path":"/0.txt"}}]}}"#;
        let _ = t.translate(producer);
        for i in 1..=TRANSLATOR_STATE_MAX_ENTRIES {
            let line = format!(
                r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"toolu_pad_{i}","name":"Read","input":{{"file_path":"/{i}.txt"}}}}]}}}}"#
            );
            t.translate(&line);
        }
        assert!(
            t.tool_uses.get("toolu_evicted").is_none(),
            "test setup invariant: producer must have been evicted"
        );
        // Late-arriving tool_result for the evicted id: must drop the
        // substantive output. Activity edge already settled to
        // `Working` from the producer line, so no new edge here.
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_evicted","content":"late result"}]}}"#;
        assert!(non_activity(t.translate(user)).is_empty());
    }

    /// Updating the same `tool_use_id` twice (rare but possible if Claude
    /// repeats the result) targets the same artifact id both times.
    #[test]
    fn artifact_id_is_stable_per_tool_use_id() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let assistant = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_stable","name":"Read","input":{"file_path":"/a.txt"}}]}}"#;
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_stable","content":"ok"}]}}"#;
        let p = match &non_activity(t.translate(assistant))[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactProduced {
                artifact_id, ..
            }) => *artifact_id,
            _ => panic!("expected ArtifactProduced"),
        };
        let u1 = match &non_activity(t.translate(user))[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { artifact_id, .. }) => {
                *artifact_id
            }
            _ => panic!("expected ArtifactUpdated"),
        };
        let u2 = match &non_activity(t.translate(user))[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { artifact_id, .. }) => {
                *artifact_id
            }
            _ => panic!("expected ArtifactUpdated"),
        };
        assert_eq!(p, u1);
        assert_eq!(u1, u2);
    }

    /// T-23B-1 — translator activity transitions. Each (input event →
    /// emitted ActivityChanged) pair, plus the no-op suppression that
    /// keeps the frontend counter from resetting on every stream-json
    /// line in a long burst.
    #[test]
    fn t_23b_1_activity_transitions() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");

        // Boot lines (system/init, system/status) must NOT trigger
        // Working — otherwise the dock flashes "Working… 0:01" before
        // the user has typed anything.
        for boot in [
            r#"{"type":"system","subtype":"init","cwd":"/x"}"#,
            r#"{"type":"system","subtype":"status"}"#,
        ] {
            let activity: Vec<_> = t
                .translate(boot)
                .into_iter()
                .filter(|o| {
                    matches!(
                        o,
                        TranslatorOutput::Event(OrchestratorEvent::ActivityChanged { .. })
                    )
                })
                .collect();
            assert!(
                activity.is_empty(),
                "boot line {boot} unexpectedly transitioned activity"
            );
        }

        // First assistant text → Idle → Working.
        let assistant_text = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#;
        let edge = first_activity(t.translate(assistant_text))
            .expect("first assistant event must transition Idle → Working");
        assert!(matches!(edge, ActivityState::Working));

        // Subsequent assistant lines stay Working — no duplicate edges
        // (would reset the elapsed counter on the frontend).
        let again = first_activity(t.translate(assistant_text));
        assert!(
            again.is_none(),
            "no-op transition should suppress the broadcast"
        );

        // control_request can_use_tool → Working → AwaitingApproval.
        let prompt = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"/x"}}}"#;
        let edge = first_activity(t.translate(prompt))
            .expect("control_request must transition to AwaitingApproval");
        assert!(matches!(edge, ActivityState::AwaitingApproval));

        // After approval resolves, the next assistant line resumes
        // Working — the AwaitingApproval state is one-way until the
        // next stream event lands.
        let edge = first_activity(t.translate(assistant_text))
            .expect("post-approval assistant line must re-arm Working");
        assert!(matches!(edge, ActivityState::Working));

        // result/success → Working → Idle (turn end).
        let result =
            r#"{"type":"result","subtype":"success","total_cost_usd":0.36,"duration_ms":17222}"#;
        let edge = first_activity(t.translate(result)).expect("result must transition to Idle");
        assert!(matches!(edge, ActivityState::Idle));

        // result/error also transitions to Idle.
        let mut t2 = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t2.translate(assistant_text); // arm Working
        let err = r#"{"type":"result","subtype":"error","error":"x"}"#;
        let edge = first_activity(t2.translate(err)).expect("result/error must transition to Idle");
        assert!(matches!(edge, ActivityState::Idle));

        // control_request that is NOT can_use_tool (e.g. interrupt)
        // does NOT trigger AwaitingApproval — only the permission
        // prompt subtype parks the agent.
        let mut t3 = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t3.translate(assistant_text); // Working
        let interrupt =
            r#"{"type":"control_request","request_id":"req-2","request":{"subtype":"interrupt"}}"#;
        let outs = t3.translate(interrupt);
        assert!(
            !outs.iter().any(|o| matches!(
                o,
                TranslatorOutput::Event(OrchestratorEvent::ActivityChanged {
                    state: ActivityState::AwaitingApproval,
                    ..
                })
            )),
            "interrupt control_request should not park the agent on approval"
        );
    }

    /// T-23B subprocess-death case: `flush_idle()` emits a final
    /// `ActivityChanged { Idle }` when the reader detects EOF mid-turn,
    /// and is a no-op when the turn already ended cleanly with
    /// `result/success`.
    #[test]
    fn t_23b_flush_idle_only_emits_when_not_already_idle() {
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        // Mid-turn EOF: assistant text armed Working, then EOF lands.
        let _ = t.translate(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
        );
        let idle = t
            .flush_idle()
            .expect("EOF mid-turn must synthesize a final Idle");
        match idle {
            OrchestratorEvent::ActivityChanged {
                state: ActivityState::Idle,
                ..
            } => {}
            other => panic!("unexpected idle event: {other:?}"),
        }

        // Clean exit: result already transitioned to Idle, so a second
        // flush_idle on the same translator is a no-op.
        let mut t2 = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let _ = t2.translate(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
        );
        let _ = t2.translate(r#"{"type":"result","subtype":"success","total_cost_usd":0.0}"#);
        assert!(t2.flush_idle().is_none());
    }

    /// Helper for the activity-transition test: pull the first
    /// `ActivityChanged` event's state from a translator output, or
    /// `None` if no transition fired.
    fn first_activity(out: Vec<TranslatorOutput>) -> Option<ActivityState> {
        out.into_iter().find_map(|o| match o {
            TranslatorOutput::Event(OrchestratorEvent::ActivityChanged { state, .. }) => {
                Some(state)
            }
            _ => None,
        })
    }

    // ---------- Phase 24 (ADR 0008) ---------------------------------
    //
    // Fixtures for the three §2.2 scenarios in
    // `core-docs/phase-24-pass-through-chat.md`. Each asserts the
    // `AgentTurn*` projection of a coarse stream-json envelope batch.
    // Per-token streaming via `stream_event` lines is layered in by a
    // follow-up consumer; the renderer's per-block accumulator is
    // shape-compatible with both forms.
    // ----------------------------------------------------------------

    fn collect_phase24<'a>(
        translator: &'a mut ClaudeStreamTranslator,
        lines: &[&str],
    ) -> Vec<OrchestratorEvent> {
        let mut out = Vec::new();
        for l in lines {
            for o in translator.translate(l) {
                if let TranslatorOutput::Event(e) = o {
                    out.push(e);
                }
            }
        }
        out
    }

    fn phase24_translator() -> ClaudeStreamTranslator {
        ClaudeStreamTranslator::new_phase24(ws(), tab(), "dir-recon")
    }

    /// Phase 24 §2.2 Scenario A — text-only turn. `system/init` →
    /// `assistant{text}` → `result/success`. Asserts the projection
    /// emits `AgentTurnStarted` (with the captured session id), one
    /// content-block trio for the text, and `AgentTurnEnded{EndTurn}`.
    #[test]
    fn phase24_scenario_a_text_only_turn() {
        let mut t = phase24_translator();
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess_01ABC","cwd":"/x"}"#,
            r#"{"type":"assistant","message":{"role":"assistant","id":"msg_01ABC","model":"claude-opus-4-7","content":[{"type":"text","text":"Hello, world."}],"stop_reason":"end_turn","usage":{"input_tokens":12,"output_tokens":4}}}"#,
            r#"{"type":"result","subtype":"success","total_cost_usd":0.01,"usage":{"input_tokens":12,"output_tokens":4}}"#,
        ];
        let events = collect_phase24(&mut t, &lines);

        // Expected sequence: TurnStarted, BlockStarted{Text},
        // BlockDelta{"Hello, world."}, BlockEnded, TurnEnded{EndTurn}.
        assert!(matches!(
            events[0],
            OrchestratorEvent::AgentTurnStarted { ref turn_id, ref session_id, ref model, .. }
                if turn_id.as_str() == "msg_01ABC"
                    && session_id.as_str() == "sess_01ABC"
                    && model == "claude-opus-4-7"
        ));
        match &events[1] {
            OrchestratorEvent::AgentContentBlockStarted {
                block_index,
                block_kind,
                ..
            } => {
                assert_eq!(*block_index, 0);
                assert!(matches!(block_kind, AgentContentBlockKind::Text));
            }
            other => panic!("expected AgentContentBlockStarted, got {other:?}"),
        }
        match &events[2] {
            OrchestratorEvent::AgentContentBlockDelta { delta, .. } => {
                assert_eq!(delta, "Hello, world.");
            }
            other => panic!("expected AgentContentBlockDelta, got {other:?}"),
        }
        assert!(matches!(
            events[3],
            OrchestratorEvent::AgentContentBlockEnded { .. }
        ));
        assert!(matches!(
            &events[4],
            OrchestratorEvent::AgentTurnEnded {
                stop_reason: AgentStopReason::EndTurn,
                ..
            }
        ));
    }

    /// Phase 24 §2.2 Scenario B — tool-use turn with thinking. Mixed
    /// thinking + text + tool_use blocks at distinct indices, then a
    /// `tool_result` echo on the next user envelope. Asserts (a) per-
    /// block trios at the right block_indices, (b) `AgentToolResult`
    /// correlates against the open turn's tool_use_id.
    #[test]
    fn phase24_scenario_b_tool_use_with_thinking() {
        let mut t = phase24_translator();
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess_01XYZ","cwd":"/x"}"#,
            r##"{"type":"assistant","message":{"role":"assistant","id":"msg_01XYZ","model":"claude-opus-4-7","content":[
                {"type":"thinking","thinking":"I should read the file..."},
                {"type":"text","text":"Let me check that for you."},
                {"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"plan.md"}}
            ],"stop_reason":"tool_use","usage":{"input_tokens":50,"output_tokens":20}}}"##,
            r##"{"type":"user","message":{"role":"user","content":[
                {"type":"tool_result","tool_use_id":"toolu_01","content":"# Plan\n\nNear-term focus..."}
            ]}}"##,
        ];
        let events = collect_phase24(&mut t, &lines);

        // Expected ordering: TurnStarted + 3 block trios (thinking,
        // text, tool_use = 9 events) + AgentToolResult.
        assert!(matches!(
            events[0],
            OrchestratorEvent::AgentTurnStarted { .. }
        ));
        // Block 0 = thinking
        match &events[1] {
            OrchestratorEvent::AgentContentBlockStarted {
                block_index,
                block_kind,
                ..
            } => {
                assert_eq!(*block_index, 0);
                assert!(matches!(block_kind, AgentContentBlockKind::Thinking));
            }
            other => panic!("expected thinking BlockStarted, got {other:?}"),
        }
        // Block 1 = text
        match &events[4] {
            OrchestratorEvent::AgentContentBlockStarted {
                block_index,
                block_kind,
                ..
            } => {
                assert_eq!(*block_index, 1);
                assert!(matches!(block_kind, AgentContentBlockKind::Text));
            }
            other => panic!("expected text BlockStarted, got {other:?}"),
        }
        // Block 2 = tool_use carrying the tool_use_id
        match &events[7] {
            OrchestratorEvent::AgentContentBlockStarted {
                block_index,
                block_kind,
                ..
            } => {
                assert_eq!(*block_index, 2);
                match block_kind {
                    AgentContentBlockKind::ToolUse { name, tool_use_id } => {
                        assert_eq!(name, "Read");
                        assert_eq!(tool_use_id, "toolu_01");
                    }
                    other => panic!("expected ToolUse kind, got {other:?}"),
                }
            }
            other => panic!("expected tool_use BlockStarted, got {other:?}"),
        }
        // Tool result correlates against the open turn.
        match events.last().unwrap() {
            OrchestratorEvent::AgentToolResult {
                tool_use_id,
                content,
                is_error,
                turn_id,
                ..
            } => {
                assert_eq!(tool_use_id, "toolu_01");
                assert!(content.contains("Plan"));
                assert!(!*is_error);
                assert_eq!(turn_id.as_str(), "msg_01XYZ");
            }
            other => panic!("expected AgentToolResult, got {other:?}"),
        }
    }

    /// Phase 24 §2.2 Scenario C — parallel tool_use blocks. Multiple
    /// `tool_use` blocks at distinct `index` values in one assistant
    /// envelope; correlation is by `tool_use_id`, not by index.
    #[test]
    fn phase24_scenario_c_parallel_tool_use_blocks() {
        let mut t = phase24_translator();
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess_01PAR","cwd":"/x"}"#,
            r#"{"type":"assistant","message":{"role":"assistant","id":"msg_01PAR","model":"claude-opus-4-7","content":[
                {"type":"tool_use","id":"toolu_a","name":"Read","input":{"file_path":"a.md"}},
                {"type":"tool_use","id":"toolu_b","name":"Read","input":{"file_path":"b.md"}}
            ],"stop_reason":"tool_use","usage":{"input_tokens":40,"output_tokens":10}}}"#,
            // Tool results arrive in reverse order — correlation must
            // be by id, not array index.
            r##"{"type":"user","message":{"role":"user","content":[
                {"type":"tool_result","tool_use_id":"toolu_b","content":"# B"},
                {"type":"tool_result","tool_use_id":"toolu_a","content":"# A"}
            ]}}"##,
        ];
        let events = collect_phase24(&mut t, &lines);
        let results: Vec<&OrchestratorEvent> = events
            .iter()
            .filter(|e| matches!(e, OrchestratorEvent::AgentToolResult { .. }))
            .collect();
        assert_eq!(
            results.len(),
            2,
            "expected one AgentToolResult per tool_use"
        );
        match results[0] {
            OrchestratorEvent::AgentToolResult {
                tool_use_id,
                content,
                ..
            } => {
                assert_eq!(tool_use_id, "toolu_b");
                assert!(content.contains("B"));
            }
            other => panic!("unexpected: {other:?}"),
        }
        match results[1] {
            OrchestratorEvent::AgentToolResult {
                tool_use_id,
                content,
                ..
            } => {
                assert_eq!(tool_use_id, "toolu_a");
                assert!(content.contains("A"));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    /// Phase 24 §11.0 P2 spike — `result/error_during_execution` (the
    /// SIGINT-interrupted-turn discriminator) closes the open turn with
    /// `stop_reason: Interrupted`. The legacy translator dropped this
    /// envelope on the floor (`translate_result` early-returned on
    /// non-success); the spike found the gap and Phase 24 closes it.
    #[test]
    fn phase24_result_error_during_execution_emits_interrupted() {
        let mut t = phase24_translator();
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess_01INT","cwd":"/x"}"#,
            r#"{"type":"assistant","message":{"role":"assistant","id":"msg_01INT","model":"claude-opus-4-7","content":[{"type":"text","text":"Streaming…"}]}}"#,
            r#"{"type":"result","subtype":"error_during_execution","duration_ms":6778,"is_error":true,"num_turns":2,"stop_reason":null,"total_cost_usd":0}"#,
        ];
        let events = collect_phase24(&mut t, &lines);
        assert!(
            events.iter().any(|e| matches!(
                e,
                OrchestratorEvent::AgentTurnEnded {
                    stop_reason: AgentStopReason::Interrupted,
                    ..
                }
            )),
            "interrupt envelope must close the turn with Interrupted; got {events:#?}"
        );
    }

    /// Phase 24 mode does not emit `ActivityChanged`. The activity
    /// indicator becomes a render-time observable
    /// (subprocess_running && turn_open) computed from the
    /// `AgentTurnStarted` / `AgentTurnEnded` boundaries.
    #[test]
    fn phase24_mode_does_not_emit_activity_changed() {
        let mut t = phase24_translator();
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess_01","cwd":"/x"}"#,
            r#"{"type":"assistant","message":{"role":"assistant","id":"msg_01","model":"claude-opus-4-7","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn"}}"#,
            r#"{"type":"result","subtype":"success","total_cost_usd":0.0}"#,
        ];
        let events = collect_phase24(&mut t, &lines);
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, OrchestratorEvent::ActivityChanged { .. })),
            "phase24 mode must suppress ActivityChanged; got {events:#?}"
        );
    }

    /// Phase 24 mode preserves cost extraction — the cost chip and
    /// `CostTracker` keep working identically. Mode-independent.
    #[test]
    fn phase24_result_success_still_emits_cost() {
        let mut t = phase24_translator();
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess_01"}"#,
            r#"{"type":"assistant","message":{"role":"assistant","id":"msg_01","content":[{"type":"text","text":"hi"}]}}"#,
            r#"{"type":"result","subtype":"success","total_cost_usd":0.36,"duration_ms":1000}"#,
        ];
        let mut saw_cost = false;
        for l in lines {
            for o in t.translate(l) {
                if let TranslatorOutput::Cost(c) = o {
                    assert!((c - 0.36).abs() < 1e-6);
                    saw_cost = true;
                }
            }
        }
        assert!(saw_cost);
    }

    /// Permission prompts are mode-independent: `--permission-prompt-tool
    /// stdio` is one of Phase 24's "must-intercept seams" (§3.1) and
    /// fires identically whether `show_chat_v2` is on or off.
    #[test]
    fn phase24_control_request_emits_permission_prompt() {
        let mut t = phase24_translator();
        let line = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","input":{"file_path":"/tmp/x.txt","content":"hi"},"tool_use_id":"toolu_x"}}"#;
        let outs = t.translate(line);
        assert_eq!(outs.len(), 1);
        assert!(matches!(outs[0], TranslatorOutput::PermissionPrompt { .. }));
    }

    #[test]
    fn representative_fixture_parses_without_panics() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/stream_json/representative-events.jsonl"
        );
        let contents = std::fs::read_to_string(path).expect("fixture file should exist");
        let mut t = ClaudeStreamTranslator::new(ws(), tab(), "dir-recon");
        let mut events = 0;
        let mut rate_limits = 0;
        let mut costs = 0;
        let mut prompts = 0;
        for line in contents.lines().filter(|l| !l.trim().is_empty()) {
            for out in t.translate(line) {
                match out {
                    TranslatorOutput::Event(_) => events += 1,
                    TranslatorOutput::RateLimit(_) => rate_limits += 1,
                    TranslatorOutput::Cost(_) => costs += 1,
                    TranslatorOutput::PermissionPrompt { .. } => prompts += 1,
                }
            }
        }
        // Expect: 1 AgentSpawned (in_process teammate), 1 TaskCompleted, 1
        // TeammateIdle, 1 rate limit, 1 cost. Permission prompts are locked
        // out of this fixture so a regression that injects one is loud.
        assert!(events >= 3, "got {events} events");
        assert_eq!(rate_limits, 1);
        assert_eq!(costs, 1);
        assert_eq!(prompts, 0, "representative fixture should not emit prompts");
    }
}
