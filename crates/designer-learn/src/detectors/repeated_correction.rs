//! `repeated_correction` — the loudest Phase A signal.
//!
//! Catches "the user told Claude the same thing more than once across more
//! than one workspace." When at least
//! [`crate::defaults::RULE_DEFAULTS::min_occurrences`] user messages match
//! the same correction phrasing across at least
//! [`crate::defaults::RULE_DEFAULTS::min_sessions`] distinct workspaces,
//! the detector emits one finding citing each occurrence as a
//! [`Anchor::MessageSpan`].
//!
//! Phase A is purely keyword-driven (no POS tagging, no Foundation helper).
//! The pattern catalog is migrated verbatim from Forge's
//! `analyze-transcripts.py` `_STRONG_CORRECTION` / `_MILD_CORRECTION`
//! tables; see [`crate::defaults`] for the citation. `_CONFIRMATORY`
//! openers ("yeah", "ok", "perfect") are subtracted so a confirmation
//! that happens to share a token with a correction (e.g. "yeah, no") is
//! not double-counted.
//!
//! ## Phrasing key
//!
//! Two corrections count as the *same* phrasing when the matched keyword
//! plus the next two alphanumeric tokens collapse to the same lowercase
//! string. That is intentionally narrower than "matches the same
//! keyword" — `"don't use moment.js"` and `"don't use lodash"` share
//! the keyword `don't use` but produce distinct phrasing keys, so the
//! detector won't conflate two unrelated preferences into one finding.
//! It is also wider than "matches verbatim" — leading prose ("Again:
//! ...") and trailing prose ("...because it bundles 70KB") fall outside
//! the window, so the same fix phrased two ways across sessions still
//! collapses to one finding.
//!
//! ## Output kind
//!
//! `feedback-rule` / `claude-md-entry` per the roadmap row for
//! `repeated_correction`. Phase A leaves `suggested_action: None`; Phase
//! B's synthesis pass picks the kind and writes the proposal.
//!
//! ## Summary copy
//!
//! Per the 21.A1.2 CONTRIBUTING addendum: detector summaries are
//! *evidence* text rendered under a proposal in a collapsible drawer,
//! not user-facing prose. This detector emits passive, pattern-focused
//! lines like `"Same correction phrasing observed 4× across 2 sessions"`.
//! No second-person address, no recommendation copy.

use crate::defaults::{
    CONFIRMATION_KEYWORDS, CORRECTION_KEYWORDS_MILD, CORRECTION_KEYWORDS_STRONG,
};
use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::{Actor, Anchor, EventPayload, Finding, FindingId, Severity, WorkspaceId};
use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

/// Per-detector wall-clock budget. Roadmap §"Partial-failure containment":
/// "Each detector runs under `catch_unwind` with a 250 ms
/// `tokio::time::timeout`." The orchestrator already wraps every detector
/// at the runtime level; the inner timeout here is belt-and-braces so a
/// pathological event stream (e.g. a single 10 MB user message that
/// blows up the keyword scan) cannot stall the pipeline even if the
/// outer harness regresses.
const ANALYSIS_BUDGET: Duration = Duration::from_millis(250);

/// Cap evidence anchors per finding. The full occurrence list still
/// drives the count + dedup digest, but only the first N are attached
/// as anchors so a 50-event burst doesn't bloat the event log.
const MAX_EVIDENCE_PER_FINDING: usize = 8;

/// Maximum number of alphanumeric tokens to keep after the matched
/// keyword in the phrasing key. Two captures the *subject* of a
/// correction ("don't use moment.js" → tokens `moment`, `js`) without
/// dragging in trailing prose ("...because it bundles 70KB" / "...stick
/// with date-fns"). Two same-subject corrections phrased differently
/// across sessions collapse to one phrasing key; two different subjects
/// (`moment.js` vs `lodash`) stay distinct.
const PHRASING_TRAILING_TOKENS: usize = 2;

/// Trailing characters to include in the verbatim `quote` stored on
/// each `Anchor::MessageSpan`. Keeps the evidence drawer skim-readable.
const QUOTE_TAIL_CHARS: usize = 60;

#[derive(Debug, Default, Clone, Copy)]
pub struct RepeatedCorrectionDetector;

impl RepeatedCorrectionDetector {
    pub const NAME: &'static str = "repeated_correction";
    pub const VERSION: u32 = 1;
}

#[derive(Debug, Clone)]
struct Occurrence {
    event_id: String,
    workspace_id: WorkspaceId,
    quote: String,
    char_range: (u32, u32),
}

#[async_trait]
impl Detector for RepeatedCorrectionDetector {
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
        run_with_timeout(input, config).await
    }

    #[cfg(not(feature = "local-ops"))]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError> {
        run_with_timeout(input, config).await
    }
}

async fn run_with_timeout(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
) -> Result<Vec<Finding>, DetectorError> {
    match tokio::time::timeout(ANALYSIS_BUDGET, async { analyze_inner(input, config) }).await {
        Ok(result) => result,
        Err(_) => Err(DetectorError::Other(format!(
            "{} exceeded {}ms analysis budget",
            RepeatedCorrectionDetector::NAME,
            ANALYSIS_BUDGET.as_millis()
        ))),
    }
}

fn analyze_inner(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
) -> Result<Vec<Finding>, DetectorError> {
    if !config.enabled {
        return Ok(Vec::new());
    }

    // BTreeMap so the per-phrasing iteration order is deterministic. The
    // detector output (and therefore the fixture) becomes stable across
    // runs even though the underlying event stream is not insertion-
    // ordered by phrasing.
    let mut by_phrasing: BTreeMap<String, Vec<Occurrence>> = BTreeMap::new();

    for env in &input.events {
        if let EventPayload::MessagePosted {
            workspace_id,
            author,
            body,
        } = &env.payload
        {
            if !matches!(author, Actor::User) {
                continue;
            }
            let Some((phrasing, occurrence)) =
                match_correction(env.id.to_string(), *workspace_id, body)
            else {
                continue;
            };
            by_phrasing.entry(phrasing).or_default().push(occurrence);
        }
    }

    let mut findings = Vec::new();
    let max = config.max_findings_per_session as usize;

    for (_phrasing, occs) in by_phrasing {
        if findings.len() >= max {
            break;
        }
        let count = occs.len() as u32;
        let distinct_workspaces: u32 = occs
            .iter()
            .map(|o| o.workspace_id)
            .collect::<HashSet<_>>()
            .len() as u32;

        if count < config.min_occurrences || distinct_workspaces < config.min_sessions {
            continue;
        }

        findings.push(build_finding(
            input,
            config,
            count,
            distinct_workspaces,
            &occs,
        ));
    }

    Ok(findings)
}

/// Inspect a single user message body. Returns `(phrasing_key, occurrence)`
/// when the message looks like a correction, `None` otherwise. The
/// confirmation-keyword guard suppresses pure agreement openers
/// ("yeah", "perfect") even when they happen to contain a mild keyword.
fn match_correction(
    event_id: String,
    workspace_id: WorkspaceId,
    body: &str,
) -> Option<(String, Occurrence)> {
    let lower = body.to_lowercase();

    // Strong corrections always count, even if the message also opens with
    // a confirmation token ("yeah, but actually that's wrong"). Mild-only
    // matches are suppressed when the head of the message is a confirmatory
    // opener with no strong correction present.
    let strong = first_match(&lower, CORRECTION_KEYWORDS_STRONG);

    let (start, len) = if let Some(hit) = strong {
        hit
    } else {
        if starts_with_confirmation(&lower) {
            return None;
        }
        let mild_hits: Vec<(usize, usize)> = CORRECTION_KEYWORDS_MILD
            .iter()
            .filter_map(|kw| lower.find(kw).map(|p| (p, kw.len())))
            .collect();

        // A single mild keyword on its own (e.g. "no.") is too noisy on
        // its own — Forge requires either a strong keyword or two mild
        // keywords. Match Forge's gate.
        if mild_hits.len() < 2 {
            return None;
        }
        // Anchor the phrasing key on the earliest mild match so the same
        // correction phrased two ways in different sessions still
        // collapses to one phrasing where possible.
        mild_hits.into_iter().min_by_key(|(p, _)| *p)?
    };

    let phrasing = phrasing_key(&lower, start, len);
    let quote = extract_quote(body, start, len);
    let char_start = u32::try_from(start).unwrap_or(u32::MAX);
    let char_end = char_start.saturating_add(u32::try_from(len).unwrap_or(0));

    Some((
        phrasing,
        Occurrence {
            event_id,
            workspace_id,
            quote,
            char_range: (char_start, char_end),
        },
    ))
}

fn first_match(haystack: &str, needles: &[&str]) -> Option<(usize, usize)> {
    needles
        .iter()
        .filter_map(|kw| haystack.find(kw).map(|p| (p, kw.len())))
        .min_by_key(|(p, _)| *p)
}

fn starts_with_confirmation(lower: &str) -> bool {
    let head = lower.trim_start();
    CONFIRMATION_KEYWORDS.iter().any(|kw| head.starts_with(kw))
}

/// Normalize the matched window into a stable phrasing key. Strategy:
/// keep the keyword (alphanumeric-tokenized) plus the next
/// `PHRASING_TRAILING_TOKENS` alphanumeric tokens after it. This ignores
/// position-of-keyword variation ("don't use X" vs "again: don't use X")
/// and trailing-prose variation ("X anywhere" vs "X — switch to Y") so
/// the same correction phrased two ways across sessions collapses to one
/// finding, while corrections about *different* subjects stay separate.
fn phrasing_key(lower: &str, start: usize, len: usize) -> String {
    let keyword = safe_slice(lower, start, start.saturating_add(len));
    let keyword_tokens = collect_tokens(keyword, usize::MAX);

    let after_start = start.saturating_add(len);
    let after = safe_slice(lower, after_start, lower.len());
    let trailing_tokens = collect_tokens(after, PHRASING_TRAILING_TOKENS);

    let mut all = keyword_tokens;
    all.extend(trailing_tokens);
    all.join(" ")
}

fn collect_tokens(s: &str, max: usize) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            cur.push(ch);
        } else if !cur.is_empty() {
            tokens.push(std::mem::take(&mut cur));
            if tokens.len() >= max {
                return tokens;
            }
        }
    }
    if !cur.is_empty() && tokens.len() < max {
        tokens.push(cur);
    }
    tokens
}

fn extract_quote(body: &str, start: usize, len: usize) -> String {
    let end = start
        .saturating_add(len)
        .saturating_add(QUOTE_TAIL_CHARS)
        .min(body.len());
    safe_slice(body, start, end).trim().to_string()
}

/// `&str[start..end]` with character-boundary fallback. Keyword indices
/// are byte indices into a lowercased copy that matches the original
/// byte-for-byte for ASCII, but a non-ASCII body can produce a `start`
/// or `end` that lands inside a multi-byte char. Snap outward to the
/// nearest boundary instead of panicking.
fn safe_slice(s: &str, mut start: usize, mut end: usize) -> &str {
    while start > 0 && !s.is_char_boundary(start) {
        start -= 1;
    }
    while end < s.len() && !s.is_char_boundary(end) {
        end += 1;
    }
    if end > s.len() {
        end = s.len();
    }
    if start > end {
        start = end;
    }
    &s[start..end]
}

fn build_finding(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
    count: u32,
    distinct_workspaces: u32,
    occs: &[Occurrence],
) -> Finding {
    let evidence: Vec<Anchor> = occs
        .iter()
        .take(MAX_EVIDENCE_PER_FINDING)
        .map(|o| Anchor::MessageSpan {
            message_id: o.event_id.clone(),
            quote: o.quote.clone(),
            char_range: Some(o.char_range),
        })
        .collect();

    let evidence_keys: Vec<&str> = occs.iter().map(|o| o.event_id.as_str()).collect();
    let window_digest = window_digest(RepeatedCorrectionDetector::NAME, &evidence_keys);

    Finding {
        id: FindingId::new(),
        detector_name: RepeatedCorrectionDetector::NAME.into(),
        detector_version: RepeatedCorrectionDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: time::OffsetDateTime::now_utc(),
        severity: config.impact_override.unwrap_or(Severity::Notice),
        confidence: confidence_score(count, config.min_occurrences),
        summary: summary_line(count, distinct_workspaces),
        evidence,
        suggested_action: None,
        window_digest,
    }
}

fn confidence_score(count: u32, min_occurrences: u32) -> f32 {
    let above_threshold = count.saturating_sub(min_occurrences);
    let raw = 0.5_f32 + (above_threshold as f32) * 0.10;
    raw.clamp(0.5, 0.95)
}

/// Evidence-text headline (per the 21.A1.2 summary-copy rule). Passive
/// voice; no second person; describes the pattern, not the action.
fn summary_line(count: u32, distinct_workspaces: u32) -> String {
    format!("Same correction phrasing observed {count}× across {distinct_workspaces} sessions")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::RULE_DEFAULTS;
    use designer_core::{
        Actor, EventEnvelope, EventId, EventPayload, ProjectId, StreamId, Timestamp, WorkspaceId,
    };

    fn user_msg(seq: u64, ws: WorkspaceId, body: &str) -> EventEnvelope {
        EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: seq,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload: EventPayload::MessagePosted {
                workspace_id: ws,
                author: Actor::user(),
                body: body.into(),
            },
        }
    }

    #[tokio::test]
    async fn fires_on_three_occurrences_across_two_workspaces() {
        let ws_a = WorkspaceId::new();
        let ws_b = WorkspaceId::new();
        let events = vec![
            user_msg(1, ws_a, "Don't use moment.js — pick date-fns instead."),
            user_msg(2, ws_a, "Again: don't use moment.js, that bundles 70KB."),
            user_msg(3, ws_b, "don't use moment.js anywhere in this repo."),
        ];

        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = RULE_DEFAULTS;
        let detector = RepeatedCorrectionDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert_eq!(findings.len(), 1, "expected one finding for one phrasing");
        let f = &findings[0];
        assert_eq!(f.detector_name, RepeatedCorrectionDetector::NAME);
        assert_eq!(f.severity, Severity::Notice);
        assert!(f.summary.contains("3"));
        assert!(f.summary.contains("2 sessions"));
        assert!(
            (0.5..=0.95).contains(&f.confidence),
            "confidence out of range: {}",
            f.confidence
        );
        assert_eq!(f.evidence.len(), 3);
    }

    #[tokio::test]
    async fn does_not_fire_below_threshold() {
        let ws = WorkspaceId::new();
        let events = vec![
            user_msg(1, ws, "Don't use moment.js — pick date-fns instead."),
            user_msg(2, ws, "Again: don't use moment.js, that bundles 70KB."),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = RULE_DEFAULTS;
        let detector = RepeatedCorrectionDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(
            findings.is_empty(),
            "two occurrences in one workspace should not fire"
        );
    }

    #[tokio::test]
    async fn does_not_collapse_distinct_phrasings() {
        let ws_a = WorkspaceId::new();
        let ws_b = WorkspaceId::new();
        let events = vec![
            user_msg(1, ws_a, "don't use moment.js anywhere"),
            user_msg(2, ws_a, "don't use lodash anywhere"),
            user_msg(3, ws_b, "don't use react-router anywhere"),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = RULE_DEFAULTS;
        let detector = RepeatedCorrectionDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(
            findings.is_empty(),
            "three different libraries shouldn't roll up into one finding"
        );
    }

    #[tokio::test]
    async fn ignores_confirmation_only_messages() {
        let ws_a = WorkspaceId::new();
        let ws_b = WorkspaceId::new();
        let events = vec![
            user_msg(1, ws_a, "Yeah, looks good — ship it"),
            user_msg(2, ws_b, "Perfect, lgtm"),
            user_msg(3, ws_a, "Thanks, that works"),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = RULE_DEFAULTS;
        let detector = RepeatedCorrectionDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn returns_empty_when_disabled() {
        let ws = WorkspaceId::new();
        let events = vec![
            user_msg(1, ws, "don't use moment.js"),
            user_msg(2, ws, "don't use moment.js"),
            user_msg(3, ws, "don't use moment.js"),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = DetectorConfig::DISABLED;
        let detector = RepeatedCorrectionDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(findings.is_empty());
    }

    #[test]
    fn confidence_clamps_into_band() {
        assert_eq!(confidence_score(3, 3), 0.5);
        assert!((confidence_score(8, 3) - 0.95).abs() < f32::EPSILON);
        assert!((confidence_score(50, 3) - 0.95).abs() < f32::EPSILON);
        assert_eq!(confidence_score(2, 3), 0.5); // saturates at floor
    }

    #[test]
    fn summary_is_clinical_and_passive() {
        let s = summary_line(4, 2);
        assert!(s.starts_with("Same correction phrasing"));
        // No second-person pronoun in the evidence text.
        assert!(!s.to_lowercase().contains("you"));
    }
}
