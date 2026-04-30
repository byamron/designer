//! `compaction_pressure` — Designer-unique detector.
//!
//! Catches the pattern "the user types `/compact` (Claude Code's
//! built-in slash command) regularly across multiple Designer sessions
//! in a short window." Output kind (Phase B): `context-restructuring` —
//! the recommendation is usually to demote a long CLAUDE.md block to a
//! reference doc, lift conversation-only context into a memory note, or
//! trim a runaway agent transcript so the user no longer needs to
//! manually compact mid-session.
//!
//! Forge has no analog — Forge's analyzer never sees the slash commands
//! the user types into Claude Code. Designer captures them natively as
//! [`EventPayload::MessagePosted`] events. Always-on (not in
//! [`crate::FORGE_OVERLAP_DETECTORS`]).
//!
//! ## Algorithm
//!
//! Single pass over `input.events`:
//!
//! 1. Group `MessagePosted` events by their payload `workspace_id`.
//!    Each workspace is its own session sequence — a project-wide
//!    bundle never merges two workspaces' messages into a shared
//!    session.
//! 2. Within each workspace's stream, segment into **sessions** by an
//!    idle-window heuristic: if the gap between two adjacent
//!    `MessagePosted` events exceeds
//!    [`crate::defaults::COMPACTION_PRESSURE_SESSION_GAP_MINUTES`], the
//!    second message starts a new session. Designer process boundaries
//!    aren't observable as a typed event yet (no `SessionStarted`
//!    payload), so the idle-window proxy is the cheapest correct
//!    definition until a typed boundary lands. When it does, bump
//!    [`CompactionPressureDetector::VERSION`] and switch.
//! 3. A session is **qualifying** when (a) it contains at least one
//!    `MessagePosted` whose body (after a leading-whitespace trim)
//!    starts with the literal `/compact` token and (b) that compact
//!    event falls inside the trailing-7-day window.
//! 4. The trailing window is anchored on the **most recent event in
//!    the input** (not wall-clock now) so the detector is reproducible
//!    from a frozen event log.
//! 5. Emit one [`Finding`] per workspace whose qualifying-session
//!    count inside the window is at least `config.min_sessions`
//!    (default 3 per [`crate::defaults::COMPACTION_PRESSURE_DEFAULTS`]).
//!    Evidence is one [`Anchor::MessageSpan`] per `/compact` message.

use crate::defaults::{COMPACTION_PRESSURE_LOOKBACK_DAYS, COMPACTION_PRESSURE_SESSION_GAP_MINUTES};
use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::{
    Anchor, EventEnvelope, EventPayload, Finding, FindingId, Severity, Timestamp, WorkspaceId,
};
use std::collections::BTreeMap;
use time::Duration;

/// Designer-unique detector. Always runs (not in
/// [`crate::FORGE_OVERLAP_DETECTORS`]).
#[derive(Debug, Default, Clone, Copy)]
pub struct CompactionPressureDetector;

impl CompactionPressureDetector {
    pub const NAME: &'static str = "compaction_pressure";
    pub const VERSION: u32 = 1;
    /// The literal slash command this detector matches on. Defined as a
    /// constant so test fixtures and downstream consumers can compare
    /// against the same string the matcher uses.
    pub const SLASH_COMMAND: &'static str = "/compact";
    /// Confidence floor — at the threshold (3 sessions in a week) the
    /// signal is suggestive but not strong. Each qualifying session
    /// past the floor adds [`Self::CONFIDENCE_STEP`] up to
    /// [`Self::CONFIDENCE_MAX`].
    pub const CONFIDENCE_MIN: f32 = 0.55;
    /// Confidence ceiling — a long compaction streak is strong evidence
    /// of context-shape friction but never definitive (the user may be
    /// running a deliberately context-heavy spike).
    pub const CONFIDENCE_MAX: f32 = 0.85;
    const CONFIDENCE_STEP: f32 = 0.05;
    /// Summary char budget per CONTRIBUTING §"Summary copy".
    const SUMMARY_BUDGET: usize = 100;
}

#[async_trait]
impl Detector for CompactionPressureDetector {
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

/// Returns true when `body` is a typed `/compact` slash command: the
/// `/compact` literal at the head (post leading-whitespace trim),
/// terminated by EOF or whitespace so `/compactify` and `/compact-foo`
/// don't match.
fn is_compact_command(body: &str) -> bool {
    let trimmed = body.trim_start();
    let Some(after) = trimmed.strip_prefix(CompactionPressureDetector::SLASH_COMMAND) else {
        return false;
    };
    after.is_empty() || after.starts_with(char::is_whitespace)
}

#[derive(Default)]
struct WorkspaceState<'a> {
    /// `/compact` events from sessions that have already qualified
    /// (closed with at least one `/compact` inside the lookback window).
    qualifying_compacts: Vec<&'a EventEnvelope>,
    /// Number of qualifying sessions closed so far for this workspace.
    qualifying_sessions: u32,
    /// Buffered `/compact` events from the currently-open session.
    pending_compacts: Vec<&'a EventEnvelope>,
    /// Last `MessagePosted` timestamp seen for this workspace; used to
    /// detect the next session boundary.
    last_message_ts: Option<Timestamp>,
}

impl<'a> WorkspaceState<'a> {
    fn close_session(&mut self) {
        if !self.pending_compacts.is_empty() {
            self.qualifying_sessions += 1;
            self.qualifying_compacts.append(&mut self.pending_compacts);
        } else {
            self.pending_compacts.clear();
        }
    }
}

fn detect(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled || config.max_findings_per_session == 0 {
        return Vec::new();
    }
    let Some(latest_ts) = input.events.iter().map(|e| e.timestamp).max() else {
        return Vec::new();
    };
    let window_start = latest_ts - Duration::days(COMPACTION_PRESSURE_LOOKBACK_DAYS);
    let session_gap = Duration::minutes(COMPACTION_PRESSURE_SESSION_GAP_MINUTES);

    // Group `MessagePosted` events by workspace. BTreeMap keeps the
    // iteration order deterministic across runs (UUIDs sort
    // lexicographically), so the test fixtures don't have to dance with
    // HashMap's randomized order.
    let mut by_ws: BTreeMap<WorkspaceId, Vec<&EventEnvelope>> = BTreeMap::new();
    for env in &input.events {
        if let EventPayload::MessagePosted { workspace_id, .. } = &env.payload {
            by_ws.entry(*workspace_id).or_default().push(env);
        }
    }

    let cap = config.max_findings_per_session as usize;
    let mut findings: Vec<Finding> = Vec::new();

    for (_ws, mut messages) in by_ws {
        messages.sort_by_key(|e| (e.timestamp, e.sequence));

        let mut state = WorkspaceState::default();
        for env in messages {
            if let Some(prev_ts) = state.last_message_ts {
                if env.timestamp - prev_ts > session_gap {
                    state.close_session();
                }
            }
            state.last_message_ts = Some(env.timestamp);

            if env.timestamp < window_start {
                continue;
            }
            let EventPayload::MessagePosted { body, .. } = &env.payload else {
                continue;
            };
            if is_compact_command(body) {
                state.pending_compacts.push(env);
            }
        }
        state.close_session();

        if state.qualifying_sessions >= config.min_sessions {
            findings.push(build_finding(input, &state, latest_ts, config));
            if findings.len() >= cap {
                break;
            }
        }
    }

    findings
}

fn build_finding(
    input: &SessionAnalysisInput,
    state: &WorkspaceState<'_>,
    latest_ts: Timestamp,
    config: &DetectorConfig,
) -> Finding {
    let total_compacts = state.qualifying_compacts.len() as u32;
    let above = state
        .qualifying_sessions
        .saturating_sub(config.min_sessions) as f32;
    let confidence = (CompactionPressureDetector::CONFIDENCE_MIN
        + CompactionPressureDetector::CONFIDENCE_STEP * above)
        .clamp(
            CompactionPressureDetector::CONFIDENCE_MIN,
            CompactionPressureDetector::CONFIDENCE_MAX,
        );

    let evidence: Vec<Anchor> = state
        .qualifying_compacts
        .iter()
        .map(|env| build_anchor(env))
        .collect();

    let evidence_keys: Vec<String> = state
        .qualifying_compacts
        .iter()
        .map(|env| env.id.to_string())
        .collect();
    let key_refs: Vec<&str> = evidence_keys.iter().map(String::as_str).collect();
    let digest = window_digest(CompactionPressureDetector::NAME, &key_refs);

    Finding {
        id: FindingId::new(),
        detector_name: CompactionPressureDetector::NAME.to_string(),
        detector_version: CompactionPressureDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: latest_ts,
        severity: config.impact_override.unwrap_or(Severity::Notice),
        confidence,
        summary: trim_summary(format!(
            "/compact invoked across {sessions} sessions in {days} days ({total} occurrences)",
            sessions = state.qualifying_sessions,
            days = COMPACTION_PRESSURE_LOOKBACK_DAYS,
            total = total_compacts,
        )),
        evidence,
        suggested_action: None,
        window_digest: digest,
    }
}

/// Build a `MessageSpan` anchor pointing at the `/compact` token inside
/// the message body. The `quote` is the full slash-command-and-args
/// substring so a stale `char_range` can be re-found by string search
/// after a downstream message edit.
fn build_anchor(env: &EventEnvelope) -> Anchor {
    let (quote, char_range) = match &env.payload {
        EventPayload::MessagePosted { body, .. } => slash_command_span(body),
        _ => (CompactionPressureDetector::SLASH_COMMAND.to_string(), None),
    };
    Anchor::MessageSpan {
        message_id: env.id.to_string(),
        quote,
        char_range,
    }
}

/// Locate the `/compact` token inside `body` and return the verbatim
/// quote (the slash-command + any trailing args on the same line) plus
/// its `(start, end)` character offsets. `None` for the range when the
/// token isn't found (defensive — `is_compact_command` already gated
/// the caller).
fn slash_command_span(body: &str) -> (String, Option<(u32, u32)>) {
    let trimmed = body.trim_start();
    let leading = body.chars().count() - trimmed.chars().count();
    let token_chars = CompactionPressureDetector::SLASH_COMMAND.chars().count();
    // Capture the slash command + any args on the same line for context.
    let line_end = trimmed.find('\n').unwrap_or(trimmed.len());
    let quote = trimmed[..line_end].to_string();
    let quote_chars = quote.chars().count();
    let start = leading as u32;
    let end = (leading + quote_chars.max(token_chars)) as u32;
    (quote, Some((start, end)))
}

fn trim_summary(summary: String) -> String {
    if summary.chars().count() <= CompactionPressureDetector::SUMMARY_BUDGET {
        return summary;
    }
    let mut out: String = summary
        .chars()
        .take(CompactionPressureDetector::SUMMARY_BUDGET - 1)
        .collect();
    out.push('\u{2026}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::COMPACTION_PRESSURE_DEFAULTS;
    use designer_core::{
        Actor, EventEnvelope, EventId, EventPayload, ProjectId, StreamId, Timestamp, WorkspaceId,
    };

    fn envelope(seq: u64, ts: Timestamp, payload: EventPayload, ws: WorkspaceId) -> EventEnvelope {
        EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: seq,
            timestamp: ts,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    fn message(seq: u64, ts: Timestamp, ws: WorkspaceId, body: &str) -> EventEnvelope {
        envelope(
            seq,
            ts,
            EventPayload::MessagePosted {
                workspace_id: ws,
                author: Actor::user(),
                body: body.to_string(),
            },
            ws,
        )
    }

    #[test]
    fn is_compact_command_matches_only_exact_token() {
        assert!(is_compact_command("/compact"));
        assert!(is_compact_command("/compact please"));
        assert!(is_compact_command("  /compact"));
        assert!(is_compact_command("/compact\n"));
        assert!(!is_compact_command("/compactify"));
        assert!(!is_compact_command("/compact-now"));
        assert!(!is_compact_command("look at /compact"));
        assert!(!is_compact_command(""));
    }

    #[test]
    fn slash_command_span_pins_offsets_after_leading_whitespace() {
        let (quote, range) = slash_command_span("  /compact please");
        assert_eq!(quote, "/compact please");
        assert_eq!(range, Some((2, 17)));
    }

    #[tokio::test]
    async fn empty_input_yields_nothing() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(vec![])
            .build();
        let findings = detect(&input, &COMPACTION_PRESSURE_DEFAULTS);
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn three_sessions_in_window_emit_one_finding() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let day = Duration::days(1);
        let base = Timestamp::UNIX_EPOCH + Duration::days(30);
        let events = vec![
            message(1, base, ws, "/compact"),
            message(2, base + day, ws, "/compact please"),
            message(3, base + day * 2, ws, "/compact"),
        ];
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let findings = detect(&input, &COMPACTION_PRESSURE_DEFAULTS);
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(f.detector_name, CompactionPressureDetector::NAME);
        assert_eq!(f.severity, Severity::Notice);
        assert_eq!(f.evidence.len(), 3);
    }

    #[tokio::test]
    async fn two_sessions_does_not_fire() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let day = Duration::days(1);
        let base = Timestamp::UNIX_EPOCH + Duration::days(30);
        let events = vec![
            message(1, base, ws, "/compact"),
            message(2, base + day, ws, "/compact"),
        ];
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let findings = detect(&input, &COMPACTION_PRESSURE_DEFAULTS);
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn three_compacts_in_one_session_does_not_fire() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        // All three messages within the 60-min idle gap → one session.
        let base = Timestamp::UNIX_EPOCH + Duration::days(30);
        let step = Duration::minutes(5);
        let events = vec![
            message(1, base, ws, "/compact"),
            message(2, base + step, ws, "/compact"),
            message(3, base + step * 2, ws, "/compact"),
        ];
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let findings = detect(&input, &COMPACTION_PRESSURE_DEFAULTS);
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn compacts_outside_window_are_ignored() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let base = Timestamp::UNIX_EPOCH + Duration::days(30);
        let day = Duration::days(1);
        let events = vec![
            // Three old `/compact` sessions, all >7 days before the latest event.
            message(1, base, ws, "/compact"),
            message(2, base + day, ws, "/compact"),
            message(3, base + day * 2, ws, "/compact"),
            // A non-compact message anchors the trailing window 14 days
            // after the last `/compact`.
            message(4, base + Duration::days(20), ws, "hello"),
        ];
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let findings = detect(&input, &COMPACTION_PRESSURE_DEFAULTS);
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn disabled_config_emits_nothing() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let day = Duration::days(1);
        let base = Timestamp::UNIX_EPOCH + Duration::days(30);
        let events = vec![
            message(1, base, ws, "/compact"),
            message(2, base + day, ws, "/compact"),
            message(3, base + day * 2, ws, "/compact"),
        ];
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let cfg = DetectorConfig {
            enabled: false,
            ..COMPACTION_PRESSURE_DEFAULTS
        };
        assert!(detect(&input, &cfg).is_empty());
    }

    #[tokio::test]
    async fn separate_workspaces_do_not_share_sessions() {
        let project = ProjectId::new();
        let ws_a = WorkspaceId::new();
        let ws_b = WorkspaceId::new();
        let day = Duration::days(1);
        let base = Timestamp::UNIX_EPOCH + Duration::days(30);
        // Two sessions in workspace A and one in workspace B; if the
        // detector cross-merged streams it would incorrectly fire on A
        // (3 total). Per-workspace grouping → no finding for either.
        let events = vec![
            message(1, base, ws_a, "/compact"),
            message(2, base + day, ws_a, "/compact"),
            message(3, base + day * 2, ws_b, "/compact"),
        ];
        let input = SessionAnalysisInput::builder(project)
            .events(events)
            .build();
        let findings = detect(&input, &COMPACTION_PRESSURE_DEFAULTS);
        assert!(findings.is_empty());
    }
}
