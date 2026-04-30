//! `multi_step_tool_sequence` — Forge-overlap detector. Surfaces the
//! "same N-tool sequence repeated across multiple sessions" pattern,
//! which Phase B's synthesizer turns into a `skill-candidate` (or
//! `agent-candidate`) proposal.
//!
//! ## Overlap with Forge
//!
//! Forge ships an equivalent rule. The detector is registered in
//! [`crate::FORGE_OVERLAP_DETECTORS`] so the AppCore wiring defaults
//! its [`crate::DetectorConfig`] to `DISABLED` whenever
//! `~/.claude/plugins/forge/` is present. Forge's analyzer runs on the
//! plugin transcript; Designer's runs on the workspace event log. The
//! defaults migrate from Forge's `THRESHOLDS["skill"]`
//! (see [`crate::defaults::SKILL_DEFAULTS`]) so co-installed users see
//! consistent calibration if they ever toggle Designer back on.
//!
//! ## Tool-name extraction
//!
//! Designer doesn't yet have a typed `ToolCalled` event variant. The
//! closest signal is the `ArtifactCreated` event with
//! `author_role = author_roles::AGENT` whose `title` is the verb-first
//! card produced by `tool_use_card` in `crates/designer-claude/src/stream.rs`
//! (Phase 13.H F5). The detector parses the leading verb back into a
//! canonical tool identifier:
//!
//! | Title prefix       | Canonical tool |
//! |--------------------|----------------|
//! | `Read …`           | `Read`         |
//! | `Wrote …`          | `Write`        |
//! | `Edited …`         | `Edit`         |
//! | `Searched …`       | `Search`       |
//! | `Ran …`            | `Bash`         |
//! | `Used <Tool> …`    | `<Tool>`       |
//!
//! Other ArtifactCreated kinds (free-form agent messages, recap cards,
//! etc.) are skipped — `extract_tool_name` returns `None`. The mapping
//! is intentionally lossy on the way in (Edit / MultiEdit / NotebookEdit
//! all collapse to `Edit`; Glob / Grep collapse to `Search`) so two
//! sessions invoking the same logical workflow produce identical tuple
//! identities even though the underlying tool variant differed.
//!
//! When the typed tool-call event variant lands (tracked alongside
//! `cost_hot_streak`'s `CLASSIFY_LOOKBACK_LIMIT` note),
//! [`MultiStepToolSequenceDetector::VERSION`] bumps to `2` and this
//! parser is replaced with a direct read of the typed payload. Old
//! findings stay attached to the prior version per `CONTRIBUTING.md` §3.
//!
//! ## Sessions and sequences
//!
//! - **Session.** Each user [`EventPayload::MessagePosted`] starts a new
//!   session. The bundle's pre-message prefix (events before the first
//!   user message, if any) counts as session 0. Non-user messages
//!   (agent / system) do not start a new session.
//! - **Run.** A maximal contiguous sequence of agent tool-use artifacts
//!   inside one session, with no user message between them. Non-tool
//!   events do not break the run — they are passthrough.
//! - **Sequence.** A length-[`SEQUENCE_LEN`] sliding window over a run.
//!   A run of length R yields `R - SEQUENCE_LEN + 1` sequences when
//!   `R >= SEQUENCE_LEN`, else zero.
//!
//! Sequences are bucketed by their tool-name tuple. A finding fires
//! once per tuple that appears in at least `min_sessions` distinct
//! sessions and accumulates `min_occurrences` total occurrences.
//!
//! ## Output
//!
//! - `severity: Notice` (per [`crate::defaults::SKILL_DEFAULTS`] —
//!   `impact_override` is `None`, so the detector picks `Notice` itself).
//! - `confidence` scales with the session-count surplus above
//!   `min_sessions`, clamped to `[0.5, 0.9]`.
//! - `summary` is **clinical evidence text** per the 21.A1.2 surface
//!   contract: passive voice, describes the pattern, no second-person
//!   address.
//! - `evidence` carries one [`Anchor::MessageSpan`] per session that
//!   contained the tuple (anchored at that session's first user
//!   message), plus one [`Anchor::ToolCall`] per identified sequence
//!   run (anchored at the first artifact in the run).
//! - `suggested_action: None` — proposal generation lives in Phase B.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use async_trait::async_trait;
use designer_core::{
    author_roles, Actor, Anchor, EventPayload, Finding, FindingId, Severity, Timestamp,
};

use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};

/// Designer's implementation of the Forge `skill-candidate` /
/// `agent-candidate` detector for repeated tool sequences.
#[derive(Debug, Default, Clone, Copy)]
pub struct MultiStepToolSequenceDetector;

impl MultiStepToolSequenceDetector {
    pub const NAME: &'static str = "multi_step_tool_sequence";
    pub const VERSION: u32 = 1;

    /// Minimum tool-call window length per the roadmap spec
    /// ("Same 3+ tool-call sequence in same order").
    pub const SEQUENCE_LEN: usize = 3;
    /// Minimum confidence — even at the threshold the pattern is real
    /// signal (3 identical sequences across 3 sessions is rare by
    /// chance); the floor reflects that.
    const CONFIDENCE_FLOOR: f32 = 0.5;
    /// Confidence ceiling — repeated occurrences strengthen the signal
    /// but never make it certain (the user could be drilling on the
    /// same task in three back-to-back sessions for unrelated reasons).
    const CONFIDENCE_CEILING: f32 = 0.9;
    /// Each session above the threshold lifts confidence by this step
    /// before clamping.
    const CONFIDENCE_STEP: f32 = 0.05;
    /// Summary char budget per the 21.A1.2 "Summary copy" addendum.
    const SUMMARY_BUDGET: usize = 100;
    /// Char budget for the first-user-message quote stored on each
    /// `MessageSpan` anchor. Long bodies are truncated; the anchor's
    /// `quote` is for re-finding via string search after edits, not for
    /// rendering verbatim.
    const QUOTE_BUDGET: usize = 80;
}

#[async_trait]
impl Detector for MultiStepToolSequenceDetector {
    fn name(&self) -> &'static str {
        Self::NAME
    }
    fn version(&self) -> u32 {
        Self::VERSION
    }

    #[cfg(feature = "local-ops")]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
        _ops: Option<&dyn designer_local_models::LocalOps>,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(detect(input, config))
    }

    #[cfg(not(feature = "local-ops"))]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(detect(input, config))
    }
}

/// Maps a verb-first tool-use card title back to a canonical tool
/// identifier. `None` means the artifact isn't a tool-use card and
/// should not participate in sequence aggregation.
fn extract_tool_name(title: &str) -> Option<String> {
    let mut parts = title.split_whitespace();
    let first = parts.next()?;
    match first {
        "Read" => Some("Read".to_string()),
        "Wrote" => Some("Write".to_string()),
        "Edited" => Some("Edit".to_string()),
        "Searched" => Some("Search".to_string()),
        "Ran" => Some("Bash".to_string()),
        "Used" => parts.next().map(|tool| tool.to_string()),
        _ => None,
    }
}

/// One tool-use entry within a run, captured for evidence emission.
#[derive(Debug, Clone)]
struct RunEntry {
    tool: String,
    event_id: String,
}

/// First-user-message anchor data for one session. `None` for the
/// pre-message session (events that precede the workspace's first user
/// turn).
#[derive(Debug, Clone, Default)]
struct SessionInfo {
    first_user_message: Option<MessageAnchorData>,
}

#[derive(Debug, Clone)]
struct MessageAnchorData {
    message_id: String,
    quote: String,
}

/// Aggregation per tuple identity.
#[derive(Debug, Default)]
struct TupleEvidence {
    /// Set of session indices in which this tuple appeared. `BTreeSet`
    /// for stable evidence emission order.
    sessions: BTreeSet<usize>,
    /// Total occurrences (one per matched sliding window).
    total_count: u32,
    /// First-artifact event id of each identified sequence run.
    /// `BTreeMap<session_idx, Vec<event_id>>` to keep evidence grouped
    /// by session in deterministic order.
    runs_by_session: BTreeMap<usize, Vec<String>>,
}

impl TupleEvidence {
    fn record(&mut self, session_idx: usize, anchor_event_id: String) {
        self.sessions.insert(session_idx);
        self.total_count = self.total_count.saturating_add(1);
        self.runs_by_session
            .entry(session_idx)
            .or_default()
            .push(anchor_event_id);
    }
}

fn detect(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled || config.max_findings_per_session == 0 {
        return Vec::new();
    }

    // Sessions[0] is the pre-message bucket; subsequent indices align
    // with each user message in arrival order.
    let mut sessions: Vec<SessionInfo> = vec![SessionInfo::default()];
    let mut current_run: Vec<RunEntry> = Vec::new();
    let mut tuples: HashMap<Vec<String>, TupleEvidence> = HashMap::new();

    for env in &input.events {
        match &env.payload {
            EventPayload::MessagePosted {
                author: Actor::User,
                body,
                ..
            } => {
                flush_run(&mut current_run, sessions.len() - 1, &mut tuples);
                sessions.push(SessionInfo {
                    first_user_message: Some(MessageAnchorData {
                        message_id: env.id.to_string(),
                        quote: quote_snippet(body),
                    }),
                });
            }
            EventPayload::ArtifactCreated {
                author_role: Some(role),
                title,
                ..
            } if role == author_roles::AGENT => {
                if let Some(tool) = extract_tool_name(title) {
                    current_run.push(RunEntry {
                        tool,
                        event_id: env.id.to_string(),
                    });
                }
            }
            _ => {}
        }
    }
    flush_run(&mut current_run, sessions.len() - 1, &mut tuples);

    let min_sessions = config.min_sessions.max(1) as usize;
    let min_occurrences = config.min_occurrences.max(1);
    let cap = config.max_findings_per_session as usize;
    let last_ts = input
        .events
        .last()
        .map(|e| e.timestamp)
        .unwrap_or(Timestamp::UNIX_EPOCH);

    // Stable iteration: tuples are sorted lexicographically so two runs
    // over the same input produce findings in the same order.
    let mut sorted_tuples: Vec<(Vec<String>, TupleEvidence)> = tuples.into_iter().collect();
    sorted_tuples.sort_by(|a, b| a.0.cmp(&b.0));

    sorted_tuples
        .into_iter()
        .filter(|(_, ev)| ev.sessions.len() >= min_sessions && ev.total_count >= min_occurrences)
        .take(cap)
        .map(|(tuple, evidence)| build_finding(input, config, &tuple, evidence, &sessions, last_ts))
        .collect()
}

/// Emit every length-`SEQUENCE_LEN` sliding window from `run` into
/// `tuples`, then clear the run. `session_idx` is the session that
/// owns this run (the most recent user message's index, or 0 for the
/// pre-message bucket).
fn flush_run(
    run: &mut Vec<RunEntry>,
    session_idx: usize,
    tuples: &mut HashMap<Vec<String>, TupleEvidence>,
) {
    let len = MultiStepToolSequenceDetector::SEQUENCE_LEN;
    if run.len() >= len {
        for window_start in 0..=run.len() - len {
            let tuple: Vec<String> = run[window_start..window_start + len]
                .iter()
                .map(|e| e.tool.clone())
                .collect();
            let anchor_event = run[window_start].event_id.clone();
            tuples
                .entry(tuple)
                .or_default()
                .record(session_idx, anchor_event);
        }
    }
    run.clear();
}

fn build_finding(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
    tuple: &[String],
    evidence: TupleEvidence,
    sessions: &[SessionInfo],
    last_ts: Timestamp,
) -> Finding {
    let session_count = evidence.sessions.len() as u32;
    let above = session_count.saturating_sub(config.min_sessions.max(1)) as f32;
    let confidence = (MultiStepToolSequenceDetector::CONFIDENCE_FLOOR
        + MultiStepToolSequenceDetector::CONFIDENCE_STEP * above)
        .clamp(
            MultiStepToolSequenceDetector::CONFIDENCE_FLOOR,
            MultiStepToolSequenceDetector::CONFIDENCE_CEILING,
        );

    let mut anchors: Vec<Anchor> = Vec::new();
    let mut digest_keys: Vec<String> = Vec::new();
    digest_keys.push(format!("tuple:{}", tuple.join(">")));

    // One MessageSpan per session that contained the tuple (anchored
    // at that session's first user message), plus one ToolCall per
    // identified sequence run.
    for session_idx in &evidence.sessions {
        if let Some(anchor) = sessions
            .get(*session_idx)
            .and_then(|s| s.first_user_message.as_ref())
        {
            anchors.push(Anchor::MessageSpan {
                message_id: anchor.message_id.clone(),
                quote: anchor.quote.clone(),
                char_range: None,
            });
            digest_keys.push(format!("session_msg:{}", anchor.message_id));
        }
        if let Some(run_ids) = evidence.runs_by_session.get(session_idx) {
            for event_id in run_ids {
                anchors.push(Anchor::ToolCall {
                    event_id: event_id.clone(),
                    tool_name: tuple.join(" → "),
                });
                digest_keys.push(format!("run:{event_id}"));
            }
        }
    }

    let key_refs: Vec<&str> = digest_keys.iter().map(String::as_str).collect();
    let digest = window_digest(MultiStepToolSequenceDetector::NAME, &key_refs);

    Finding {
        id: FindingId::new(),
        detector_name: MultiStepToolSequenceDetector::NAME.to_string(),
        detector_version: MultiStepToolSequenceDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: last_ts,
        severity: config.impact_override.unwrap_or(Severity::Notice),
        confidence,
        summary: build_summary(tuple, evidence.total_count, session_count),
        evidence: anchors,
        suggested_action: None,
        window_digest: digest,
    }
}

fn build_summary(tuple: &[String], total: u32, sessions: u32) -> String {
    let chain = tuple.join(" → ");
    let raw = format!("Tool sequence {chain} repeated {total}\u{00d7} across {sessions} sessions",);
    if raw.chars().count() <= MultiStepToolSequenceDetector::SUMMARY_BUDGET {
        return raw;
    }
    let mut out: String = raw
        .chars()
        .take(MultiStepToolSequenceDetector::SUMMARY_BUDGET - 1)
        .collect();
    out.push('\u{2026}');
    out
}

/// Truncates a message body to the anchor quote budget on a char
/// boundary. The quote is stored verbatim so a stale `char_range` can
/// be re-located by string search after the message is edited.
fn quote_snippet(body: &str) -> String {
    let budget = MultiStepToolSequenceDetector::QUOTE_BUDGET;
    if body.chars().count() <= budget {
        return body.to_string();
    }
    let mut out: String = body.chars().take(budget - 1).collect();
    out.push('\u{2026}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::SKILL_DEFAULTS;
    use crate::SessionAnalysisInput;
    use designer_core::{
        Actor, EventEnvelope, EventId, EventPayload, ProjectId, StreamId, Timestamp, WorkspaceId,
    };

    fn env(seq: u64, payload: EventPayload, ws: WorkspaceId) -> EventEnvelope {
        EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: seq,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    fn user_message(seq: u64, ws: WorkspaceId, body: &str) -> EventEnvelope {
        env(
            seq,
            EventPayload::MessagePosted {
                workspace_id: ws,
                author: Actor::user(),
                body: body.into(),
            },
            ws,
        )
    }

    fn tool_artifact(seq: u64, ws: WorkspaceId, title: &str) -> EventEnvelope {
        env(
            seq,
            EventPayload::ArtifactCreated {
                artifact_id: designer_core::ArtifactId::new(),
                workspace_id: ws,
                artifact_kind: designer_core::ArtifactKind::Report,
                title: title.into(),
                summary: String::new(),
                payload: designer_core::PayloadRef::inline(""),
                author_role: Some(author_roles::AGENT.into()),
            },
            ws,
        )
    }

    #[test]
    fn extract_tool_name_handles_known_verbs() {
        assert_eq!(extract_tool_name("Read CLAUDE.md"), Some("Read".into()));
        assert_eq!(extract_tool_name("Wrote x.txt"), Some("Write".into()));
        assert_eq!(extract_tool_name("Edited foo.rs"), Some("Edit".into()));
        assert_eq!(extract_tool_name("Searched files"), Some("Search".into()));
        assert_eq!(
            extract_tool_name("Searched for \"foo\""),
            Some("Search".into())
        );
        assert_eq!(extract_tool_name("Ran git status"), Some("Bash".into()));
        assert_eq!(extract_tool_name("Used WebFetch"), Some("WebFetch".into()));
        // No match for non-tool titles.
        assert_eq!(extract_tool_name("Recap of workspace"), None);
        assert_eq!(extract_tool_name(""), None);
        // "Used" with nothing after it is treated as no tool name.
        assert_eq!(extract_tool_name("Used"), None);
    }

    #[test]
    fn build_summary_stays_inside_budget() {
        let tuple = vec!["Read".into(), "Edit".into(), "Bash".into()];
        let s = build_summary(&tuple, 4, 3);
        assert!(s.contains("Read \u{2192} Edit \u{2192} Bash"));
        assert!(s.contains("repeated 4"));
        assert!(s.contains("3 sessions"));
        assert!(s.chars().count() <= 100);
    }

    #[test]
    fn quote_snippet_truncates_long_bodies() {
        let body = "x".repeat(200);
        let q = quote_snippet(&body);
        assert!(q.chars().count() <= 80);
        assert!(q.ends_with('\u{2026}'));
    }

    #[tokio::test]
    async fn three_sessions_with_same_sequence_emits_one_finding() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let mut seq = 0u64;
        // 4 sessions × 1 (Read, Edit, Bash) sequence each — 4 occurrences,
        // 4 distinct sessions, well above SKILL_DEFAULTS' 4/3 threshold.
        for i in 0..4 {
            seq += 1;
            events.push(user_message(seq, ws, &format!("session {i}")));
            for title in ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"] {
                seq += 1;
                events.push(tool_artifact(seq, ws, title));
            }
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let detector = MultiStepToolSequenceDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector
            .analyze(&input, &SKILL_DEFAULTS, None)
            .await
            .unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &SKILL_DEFAULTS).await.unwrap();
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(f.detector_name, "multi_step_tool_sequence");
        assert_eq!(f.detector_version, 1);
        assert_eq!(f.severity, Severity::Notice);
        assert!(f.summary.contains("Read"));
        assert!(f.summary.contains("Edit"));
        assert!(f.summary.contains("Bash"));
        assert!(f.suggested_action.is_none());
        // 4 MessageSpan + 4 ToolCall anchors.
        assert_eq!(f.evidence.len(), 8);
    }

    #[tokio::test]
    async fn user_message_breaks_a_run() {
        // Two tools, then user message, then one tool — no length-3 run.
        let ws = WorkspaceId::new();
        let events = vec![
            user_message(1, ws, "go"),
            tool_artifact(2, ws, "Read CLAUDE.md"),
            tool_artifact(3, ws, "Edited foo.rs"),
            user_message(4, ws, "wait"),
            tool_artifact(5, ws, "Ran cargo test"),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let detector = MultiStepToolSequenceDetector;
        let cfg = DetectorConfig {
            min_occurrences: 1,
            min_sessions: 1,
            ..DetectorConfig::default()
        };
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn under_threshold_emits_nothing() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let mut seq = 0u64;
        // Only 2 sessions with the same tuple — below SKILL_DEFAULTS' 3 sessions.
        for i in 0..2 {
            seq += 1;
            events.push(user_message(seq, ws, &format!("session {i}")));
            for title in ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"] {
                seq += 1;
                events.push(tool_artifact(seq, ws, title));
            }
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let detector = MultiStepToolSequenceDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector
            .analyze(&input, &SKILL_DEFAULTS, None)
            .await
            .unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &SKILL_DEFAULTS).await.unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn distinct_sequences_do_not_aggregate() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let mut seq = 0u64;
        let tuples = [
            ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"],
            ["Wrote x.txt", "Read y.txt", "Edited z.rs"],
            ["Searched files", "Used WebFetch", "Read result.md"],
            ["Ran git status", "Read file.rs", "Wrote file.rs"],
        ];
        for (i, tuple) in tuples.iter().enumerate() {
            seq += 1;
            events.push(user_message(seq, ws, &format!("session {i}")));
            for title in tuple {
                seq += 1;
                events.push(tool_artifact(seq, ws, title));
            }
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let detector = MultiStepToolSequenceDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector
            .analyze(&input, &SKILL_DEFAULTS, None)
            .await
            .unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &SKILL_DEFAULTS).await.unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn disabled_config_returns_empty() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let mut seq = 0u64;
        for _ in 0..5 {
            seq += 1;
            events.push(user_message(seq, ws, "go"));
            for title in ["Read CLAUDE.md", "Edited foo.rs", "Ran cargo test"] {
                seq += 1;
                events.push(tool_artifact(seq, ws, title));
            }
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let detector = MultiStepToolSequenceDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector
            .analyze(&input, &DetectorConfig::DISABLED, None)
            .await
            .unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector
            .analyze(&input, &DetectorConfig::DISABLED)
            .await
            .unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn agent_messages_do_not_break_a_run() {
        // Agent MessagePosted between tools should not count as a session boundary.
        let ws = WorkspaceId::new();
        let agent_msg = env(
            10,
            EventPayload::MessagePosted {
                workspace_id: ws,
                author: Actor::agent("lead", "workspace-lead"),
                body: "thinking out loud".into(),
            },
            ws,
        );
        let mut events = vec![user_message(1, ws, "go")];
        events.push(tool_artifact(2, ws, "Read a.md"));
        events.push(agent_msg);
        events.push(tool_artifact(3, ws, "Edited a.md"));
        events.push(tool_artifact(4, ws, "Ran cargo fmt"));
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let detector = MultiStepToolSequenceDetector;
        let cfg = DetectorConfig {
            min_occurrences: 1,
            min_sessions: 1,
            ..DetectorConfig::default()
        };
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        // One length-3 window survives because the agent message did not break the run.
        assert_eq!(findings.len(), 1);
    }
}
