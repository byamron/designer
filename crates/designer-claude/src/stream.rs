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

use crate::orchestrator::OrchestratorEvent;
use designer_core::{AgentId, TaskId, WorkspaceId};
use serde_json::Value;
use std::collections::HashMap;
use tracing::debug;
use uuid::Uuid;

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
}

pub struct ClaudeStreamTranslator {
    workspace_id: WorkspaceId,
    team_name: String,
    tasks: HashMap<String, TaskId>,
    agents: HashMap<String, AgentId>,
}

impl ClaudeStreamTranslator {
    /// `team_name` is what the lead was asked to name the team during
    /// `spawn_team`. Required at construction so agent-id derivation is
    /// unambiguous even for events that arrive before any `config.json` read.
    pub fn new(workspace_id: WorkspaceId, team_name: impl Into<String>) -> Self {
        Self {
            workspace_id,
            team_name: team_name.into(),
            tasks: HashMap::new(),
            agents: HashMap::new(),
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
        match ty {
            "system" => self.translate_system(v),
            "assistant" => self.translate_assistant(v),
            "result" => self.translate_result(v),
            "rate_limit_event" => v
                .get("rate_limit_info")
                .map(|info| vec![TranslatorOutput::RateLimit(info.clone())])
                .unwrap_or_default(),
            // user / stream_event / unknown: drop (partials broadcast is a
            // separate concern; see 120ms coalesce in ADR 0001).
            _ => Vec::new(),
        }
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
        let text = extract_assistant_text(v.get("message"));
        if text.is_empty() {
            return Vec::new();
        }
        // The lead emits these; teammate messages surface via the inbox files.
        vec![TranslatorOutput::Event(OrchestratorEvent::MessagePosted {
            workspace_id: self.workspace_id,
            author_role: "team-lead".into(),
            body: text,
        })]
    }

    fn translate_result(&mut self, v: &Value) -> Vec<TranslatorOutput> {
        let subtype = v.get("subtype").and_then(Value::as_str).unwrap_or("");
        if subtype != "success" {
            return Vec::new();
        }
        v.get("total_cost_usd")
            .and_then(Value::as_f64)
            .map(|c| vec![TranslatorOutput::Cost(c)])
            .unwrap_or_default()
    }

    fn agent_id_for(&mut self, name: &str) -> AgentId {
        if let Some(id) = self.agents.get(name) {
            return *id;
        }
        let ns = *self.workspace_id.as_uuid();
        let id = AgentId::from_uuid(Uuid::new_v5(&ns, name.as_bytes()));
        self.agents.insert(name.to_string(), id);
        id
    }

    fn task_id_for(&mut self, claude_id: &str) -> TaskId {
        if let Some(id) = self.tasks.get(claude_id) {
            return *id;
        }
        let ns = *self.workspace_id.as_uuid();
        let id = TaskId::from_uuid(Uuid::new_v5(&ns, claude_id.as_bytes()));
        self.tasks.insert(claude_id.to_string(), id);
        id
    }
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Extract concatenated text from an assistant message's `content` array.
/// Shape: `{ content: [{type:"text",text:"…"}, {type:"tool_use",…}, …] }`
fn extract_assistant_text(message: Option<&Value>) -> String {
    let Some(msg) = message else {
        return String::new();
    };
    let Some(content) = msg.get("content").and_then(Value::as_array) else {
        return String::new();
    };
    content
        .iter()
        .filter_map(|c| {
            if c.get("type").and_then(Value::as_str) == Some("text") {
                c.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::WorkspaceId;

    fn ws() -> WorkspaceId {
        // Deterministic workspace id so v5 mapping is stable across runs.
        WorkspaceId::from_uuid(Uuid::parse_str("00000000-0000-7000-8000-000000000001").unwrap())
    }

    #[test]
    fn unparseable_line_produces_no_output() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        assert!(t.translate("not json").is_empty());
        assert!(t.translate("").is_empty());
    }

    #[test]
    fn task_started_non_teammate_emits_task_created() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_started","task_id":"t9zu6heo5","description":"Run the tests","task_type":"regular"}"#;
        let out = t.translate(line);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_started","task_id":"t9zu6heo5","description":"researcher: You are the researcher teammate.","task_type":"in_process_teammate"}"#;
        let out = t.translate(line);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_updated","task_id":"bacnr21el","patch":{"status":"completed","end_time":1776871130382}}"#;
        let out = t.translate(line);
        assert_eq!(out.len(), 1);
        assert!(matches!(
            out[0],
            TranslatorOutput::Event(OrchestratorEvent::TaskCompleted { .. })
        ));
    }

    #[test]
    fn task_updated_non_completed_emits_nothing() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_updated","task_id":"x","patch":{"status":"in_progress"}}"#;
        assert!(t.translate(line).is_empty());
    }

    #[test]
    fn task_notification_completed_with_at_summary_emits_idle() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"system","subtype":"task_notification","task_id":"t9zu6heo5","status":"completed","summary":"researcher@dir-recon"}"#;
        let out = t.translate(line);
        assert_eq!(out.len(), 1);
        assert!(matches!(
            out[0],
            TranslatorOutput::Event(OrchestratorEvent::TeammateIdle { .. })
        ));
    }

    #[test]
    fn rate_limit_event_surfaces_raw_info() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1776884400,"rateLimitType":"five_hour"}}"#;
        let out = t.translate(line);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line =
            r#"{"type":"result","subtype":"success","total_cost_usd":0.36,"duration_ms":17222}"#;
        let out = t.translate(line);
        assert_eq!(out.len(), 1);
        match &out[0] {
            TranslatorOutput::Cost(c) => assert!((c - 0.36).abs() < 1e-6),
            other => panic!("unexpected output: {other:?}"),
        }
    }

    #[test]
    fn assistant_text_emits_message_posted() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello from the lead."},{"type":"tool_use","name":"Task","input":{}}]}}"#;
        let out = t.translate(line);
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
    fn agent_id_is_deterministic_across_invocations() {
        let mut a = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let mut b = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let id_a = a.agent_id_for("researcher@dir-recon");
        let id_b = b.agent_id_for("researcher@dir-recon");
        assert_eq!(id_a, id_b);
    }

    #[test]
    fn ignores_init_status_user_and_stream_events() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let lines = [
            r#"{"type":"system","subtype":"init","cwd":"/x"}"#,
            r#"{"type":"system","subtype":"status"}"#,
            r#"{"type":"user","message":{}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta"}}"#,
            r#"{"type":"system","subtype":"hook_started","hook_id":"h1"}"#,
        ];
        for line in lines {
            assert!(t.translate(line).is_empty(), "expected empty for {line}");
        }
    }

    #[test]
    fn representative_fixture_parses_without_panics() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/stream_json/representative-events.jsonl"
        );
        let contents = std::fs::read_to_string(path).expect("fixture file should exist");
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let mut events = 0;
        let mut rate_limits = 0;
        let mut costs = 0;
        for line in contents.lines().filter(|l| !l.trim().is_empty()) {
            for out in t.translate(line) {
                match out {
                    TranslatorOutput::Event(_) => events += 1,
                    TranslatorOutput::RateLimit(_) => rate_limits += 1,
                    TranslatorOutput::Cost(_) => costs += 1,
                }
            }
        }
        // representative-events.jsonl is one example of each event type. We
        // expect at least: 1 AgentSpawned (task_started + in_process_teammate),
        // 1 TaskCompleted (task_updated completed), 1 TeammateIdle
        // (task_notification completed w/ @ summary), 1 MessagePosted
        // (assistant), 1 rate limit, 1 cost.
        assert!(events >= 3, "got {events} events");
        assert_eq!(rate_limits, 1);
        assert_eq!(costs, 1);
    }
}
