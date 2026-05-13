//! Phase 24 (ADR 0008) — dual-shape event helpers.
//!
//! Under the original chat-domain vocabulary, agent activity flowed
//! through `MessagePosted { author_role: AGENT }` for text and
//! `ArtifactCreated { kind: Report, author_role: AGENT }` for tool
//! calls. The Phase 24 pass-through projection (ADR 0008) emits an
//! additive `AgentTurn*` family instead: `AgentTurnStarted` /
//! `AgentContentBlockStarted` / `AgentContentBlockDelta` /
//! `AgentContentBlockEnded` / `AgentToolResult` / `AgentTurnEnded`. The
//! legacy variants stay in the schema (deprecated, additive-only per
//! ADR 0002 addendum) so historical event logs still deserialize; new
//! conversations under `show_chat_v2` emit the new family natively.
//!
//! Detectors that inspect agent-side activity (today only
//! `multi_step_tool_sequence` — see Phase 24 §11.1 step 11 history
//! entry for why) need to recognize both shapes without code-level
//! branching at the call sites. This module provides the predicates.
//!
//! Spec §4.1 wording said "all four detectors gain an additional
//! pattern arm." Verification during Step 11 implementation showed
//! that's over-stated: `repeated_correction`, `repeated_prompt_opening`,
//! and `compaction_pressure` only inspect user-authored events, which
//! remain `MessagePosted { author: User }` under both chat-v1 and
//! chat-v2 per the Step 4 contract. Only `multi_step_tool_sequence`
//! has an agent-side pattern arm and therefore needs this helper.

use designer_core::{AgentContentBlockKind, EventEnvelope, EventPayload};

/// Pre-Phase-24 author-role tag for agent-emitted `ArtifactCreated`
/// events. Mirrors `designer_core::author_roles::AGENT` so this module
/// doesn't reach across crates for one string constant.
const LEGACY_AGENT_AUTHOR_ROLE: &str = "agent";

/// If `env` represents an agent tool-use start under either event
/// vocabulary, return the canonical tool name. Returns `None` for any
/// other event (including agent text / thinking blocks, user messages,
/// tool results, and non-agent `ArtifactCreated` events).
///
/// Two shapes are recognized:
///
/// 1. **Legacy (chat-v1):** `EventPayload::ArtifactCreated` with
///    `author_role == "agent"` and a title that the caller-supplied
///    `title_to_tool` parser maps to a tool name (e.g. `"Used Read"`
///    → `"Read"`). The title parser is detector-specific; pass it as
///    a closure so this helper doesn't pin the parsing rules.
///
/// 2. **Chat-v2:** `EventPayload::AgentContentBlockStarted` with
///    `block_kind: ToolUse { name, .. }`. The tool name is read
///    directly from the typed field; no parsing required.
///
/// The closure form keeps the legacy title-parser inside the detector
/// (where the tool-name canonicalization rules live) while letting
/// this helper own the dual-shape dispatch.
pub fn agent_tool_use_name<'a, F>(env: &'a EventEnvelope, title_to_tool: F) -> Option<&'a str>
where
    F: FnOnce(&'a str) -> Option<&'a str>,
{
    match &env.payload {
        EventPayload::ArtifactCreated {
            author_role: Some(role),
            title,
            ..
        } if role == LEGACY_AGENT_AUTHOR_ROLE => title_to_tool(title),
        EventPayload::AgentContentBlockStarted {
            block_kind: AgentContentBlockKind::ToolUse { name, .. },
            ..
        } => Some(name.as_str()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::{
        Actor, AgentContentBlockKind, ArtifactId, ArtifactKind, ClaudeMessageId, EventEnvelope,
        EventId, EventPayload, PayloadRef, ProjectId, StreamId, TabId, Timestamp, WorkspaceId,
    };

    fn id() -> EventId {
        EventId::new()
    }

    fn legacy_tool_artifact(title: &str) -> EventEnvelope {
        EventEnvelope {
            id: id(),
            stream: StreamId::Project(ProjectId::new()),
            sequence: 1,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::agent("team-lead", "agent"),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload: EventPayload::ArtifactCreated {
                artifact_id: ArtifactId::new(),
                workspace_id: WorkspaceId::new(),
                artifact_kind: ArtifactKind::Report,
                title: title.to_string(),
                summary: String::new(),
                payload: PayloadRef::inline(""),
                author_role: Some("agent".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        }
    }

    fn chat_v2_tool_use_start(name: &str) -> EventEnvelope {
        EventEnvelope {
            id: id(),
            stream: StreamId::Project(ProjectId::new()),
            sequence: 1,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::agent("team-lead", "assistant"),
            version: 2,
            causation_id: None,
            correlation_id: None,
            payload: EventPayload::AgentContentBlockStarted {
                workspace_id: WorkspaceId::new(),
                tab_id: TabId::new(),
                turn_id: ClaudeMessageId::new("msg_01ABC"),
                block_index: 0,
                block_kind: AgentContentBlockKind::ToolUse {
                    name: name.to_string(),
                    tool_use_id: "toolu_01".into(),
                },
            },
        }
    }

    fn chat_v2_text_block_start() -> EventEnvelope {
        EventEnvelope {
            id: id(),
            stream: StreamId::Project(ProjectId::new()),
            sequence: 1,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::agent("team-lead", "assistant"),
            version: 2,
            causation_id: None,
            correlation_id: None,
            payload: EventPayload::AgentContentBlockStarted {
                workspace_id: WorkspaceId::new(),
                tab_id: TabId::new(),
                turn_id: ClaudeMessageId::new("msg_01ABC"),
                block_index: 0,
                block_kind: AgentContentBlockKind::Text,
            },
        }
    }

    fn user_message() -> EventEnvelope {
        EventEnvelope {
            id: id(),
            stream: StreamId::Project(ProjectId::new()),
            sequence: 1,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::User,
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload: EventPayload::MessagePosted {
                workspace_id: WorkspaceId::new(),
                author: Actor::User,
                body: "hello".into(),
                tab_id: None,
            },
        }
    }

    // Title parser used by `multi_step_tool_sequence` — the same shape
    // a real caller would pass. Keeping it inline here lets the helper
    // module be tested without depending on the detector module.
    fn parse_title(title: &str) -> Option<&str> {
        let mut parts = title.split_whitespace();
        match parts.next()? {
            "Used" => parts.next(),
            "Read" => Some("Read"),
            _ => None,
        }
    }

    #[test]
    fn legacy_used_title_extracts_tool_name() {
        let env = legacy_tool_artifact("Used WebFetch");
        assert_eq!(agent_tool_use_name(&env, parse_title), Some("WebFetch"));
    }

    #[test]
    fn legacy_read_title_extracts_tool_name() {
        let env = legacy_tool_artifact("Read CLAUDE.md");
        assert_eq!(agent_tool_use_name(&env, parse_title), Some("Read"));
    }

    #[test]
    fn legacy_non_tool_title_returns_none() {
        let env = legacy_tool_artifact("Recap of workspace");
        assert_eq!(agent_tool_use_name(&env, parse_title), None);
    }

    #[test]
    fn chat_v2_tool_use_block_returns_tool_name() {
        let env = chat_v2_tool_use_start("WebFetch");
        // Title parser is never called for chat-v2; pass a panicking
        // closure to prove it.
        assert_eq!(
            agent_tool_use_name(&env, |_| panic!("title parser unused for chat-v2")),
            Some("WebFetch")
        );
    }

    #[test]
    fn chat_v2_text_block_returns_none() {
        let env = chat_v2_text_block_start();
        assert_eq!(agent_tool_use_name(&env, parse_title), None);
    }

    #[test]
    fn user_message_returns_none() {
        let env = user_message();
        assert_eq!(agent_tool_use_name(&env, parse_title), None);
    }
}
