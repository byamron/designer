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
use designer_core::{author_roles, AgentId, ArtifactId, ArtifactKind, TaskId, WorkspaceId};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
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
    team_name: String,
    tasks: BoundedMap<String, TaskId>,
    agents: BoundedMap<String, AgentId>,
    /// Maps an assistant `tool_use` block's `id` to the deterministic
    /// `ArtifactId` we minted when emitting its `ArtifactProduced`. The
    /// matching `tool_result` content block (in a later user-typed message)
    /// looks the id up here and emits `ArtifactUpdated` against the same
    /// artifact, so the rail's "Read CLAUDE.md" card gains a result summary
    /// in place rather than spawning a sibling artifact.
    tool_uses: BoundedMap<String, ArtifactId>,
}

impl ClaudeStreamTranslator {
    /// `team_name` is what the lead was asked to name the team during
    /// `spawn_team`. Required at construction so agent-id derivation is
    /// unambiguous even for events that arrive before any `config.json` read.
    pub fn new(workspace_id: WorkspaceId, team_name: impl Into<String>) -> Self {
        Self {
            workspace_id,
            team_name: team_name.into(),
            tasks: BoundedMap::with_capacity(TRANSLATOR_STATE_MAX_ENTRIES),
            agents: BoundedMap::with_capacity(TRANSLATOR_STATE_MAX_ENTRIES),
            tool_uses: BoundedMap::with_capacity(TRANSLATOR_STATE_MAX_ENTRIES),
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
            "user" => self.translate_user(v),
            "result" => self.translate_result(v),
            "rate_limit_event" => v
                .get("rate_limit_info")
                .map(|info| vec![TranslatorOutput::RateLimit(info.clone())])
                .unwrap_or_default(),
            "control_request" => translate_control_request(v),
            // stream_event / unknown: drop (partials broadcast is a separate
            // concern; see 120ms coalesce in ADR 0001).
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

    /// Translate a `user` typed envelope. The `user` line carries the
    /// turn-result echoes that complete the assistant's `tool_use` blocks
    /// (`tool_result` content blocks). Per F5+1 we match those back to the
    /// originating `ArtifactProduced` and emit `ArtifactUpdated` with the
    /// result summary.
    fn translate_user(&mut self, v: &Value) -> Vec<TranslatorOutput> {
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
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello from the lead."}]}}"#;
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
    fn tool_use_block_emits_artifact_produced() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        // Mixed text + tool_use blocks. Expect: 1 ArtifactProduced
        // ("Read CLAUDE.md") + 1 MessagePosted with concatenated text.
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Reading CLAUDE.md."},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/repo/CLAUDE.md"}}]}}"#;
        let out = t.translate(line);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"git status"}}]}}"#;
        let out = t.translate(line);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","input":{"file_path":"/tmp/x.txt","content":"hi"},"tool_use_id":"toolu_x"}}"#;
        let out = t.translate(line);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line =
            r#"{"type":"control_request","request_id":"req-2","request":{"subtype":"interrupt"}}"#;
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
        let mut a = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let mut b = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let id_a = a.agent_id_for("researcher@dir-recon");
        let id_b = b.agent_id_for("researcher@dir-recon");
        assert_eq!(id_a, id_b);
    }

    #[test]
    fn ignores_init_status_empty_user_and_stream_events() {
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

    /// F5+1: an assistant `tool_use` followed (in a later user-typed line)
    /// by the matching `tool_result` block produces one `ArtifactProduced`
    /// then one `ArtifactUpdated` against the *same* artifact id, so the
    /// rail's "Read CLAUDE.md" card gains a result summary in place.
    #[test]
    fn tool_use_followed_by_tool_result_emits_correlated_update() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");

        let assistant = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_corr","name":"Read","input":{"file_path":"/repo/CLAUDE.md"}}]}}"#;
        let produced = t.translate(assistant);
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
        let updated = t.translate(user);
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_ghost","content":"orphaned"}]}}"#;
        assert!(t.translate(line).is_empty());
    }

    /// Inserting more than `TRANSLATOR_STATE_MAX_ENTRIES` distinct task
    /// ids must keep the map bounded; the oldest entry must be evicted.
    /// Locks Step 2's bounded-state guarantee.
    #[test]
    fn translator_state_is_bounded_at_cap() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
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
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
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
        // Late-arriving tool_result for the evicted id: must drop.
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_evicted","content":"late result"}]}}"#;
        assert!(t.translate(user).is_empty());
    }

    /// Updating the same `tool_use_id` twice (rare but possible if Claude
    /// repeats the result) targets the same artifact id both times.
    #[test]
    fn artifact_id_is_stable_per_tool_use_id() {
        let mut t = ClaudeStreamTranslator::new(ws(), "dir-recon");
        let assistant = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_stable","name":"Read","input":{"file_path":"/a.txt"}}]}}"#;
        let user = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_stable","content":"ok"}]}}"#;
        let p = match &t.translate(assistant)[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactProduced {
                artifact_id, ..
            }) => *artifact_id,
            _ => panic!("expected ArtifactProduced"),
        };
        let u1 = match &t.translate(user)[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { artifact_id, .. }) => {
                *artifact_id
            }
            _ => panic!("expected ArtifactUpdated"),
        };
        let u2 = match &t.translate(user)[0] {
            TranslatorOutput::Event(OrchestratorEvent::ArtifactUpdated { artifact_id, .. }) => {
                *artifact_id
            }
            _ => panic!("expected ArtifactUpdated"),
        };
        assert_eq!(p, u1);
        assert_eq!(u1, u2);
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
