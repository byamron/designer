//! `repeated_prompt_opening` — Forge-overlap skill-candidate detector.
//!
//! Catches the pattern "the user starts every session by typing roughly
//! the same thing." When at least
//! [`crate::defaults::SKILL_DEFAULTS::min_occurrences`] session-opening
//! user messages cluster together by Jaccard similarity over their
//! token sets, the detector emits one [`Finding`] per cluster citing
//! each opener as an [`Anchor::MessageSpan`].
//!
//! ## Session-break heuristic
//!
//! Designer's [`SessionAnalysisInput`] does not yet expose explicit
//! session boundaries. The other Phase 21.A2 detectors converge on a
//! workspace-as-session mapping (see `repeated_correction.rs` — its
//! `min_sessions` gate counts distinct `WorkspaceId`s; the cost detector
//! uses a rolling event window unrelated to sessions). This detector
//! follows suit: each `WorkspaceId` observed in the event stream is one
//! "session", and the *first* user [`EventPayload::MessagePosted`] in
//! that workspace is its opener. Workspaces without a user message in
//! the bundle are skipped.
//!
//! ## Jaccard similarity
//!
//! Token-set similarity over lowercased, punctuation-stripped words.
//! `tokens(a) ∩ tokens(b) / tokens(a) ∪ tokens(b)`. Two openers count as
//! a match when the ratio is ≥
//! [`crate::defaults::REPEATED_PROMPT_OPENING_JACCARD_MIN`]. Empty token
//! sets (whitespace-only openers) never match.
//!
//! ## Clustering
//!
//! Greedy connected-components: a new opener is added to the *first*
//! existing cluster that contains at least one member sharing ≥0.5
//! Jaccard with it. If no cluster matches, the opener seeds a new one.
//! Clusters with at least `min_occurrences` openers spanning at least
//! `min_sessions` distinct workspaces produce one finding apiece.
//!
//! ## Output kind
//!
//! `skill-candidate` per `core-docs/roadmap.md`. Phase A leaves
//! `suggested_action: None`; Phase B's synthesis pass shapes the
//! proposal copy.
//!
//! ## Forge co-installation
//!
//! Listed in [`crate::FORGE_OVERLAP_DETECTORS`] (Forge ships
//! `find_repeated_prompts` in `analyze-transcripts.py`). AppCore wiring
//! defaults the config to [`DetectorConfig::DISABLED`] when Forge is
//! co-installed; the detector logic stays correct so the user can
//! re-enable it explicitly.

use crate::defaults::REPEATED_PROMPT_OPENING_JACCARD_MIN;
use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::{Actor, Anchor, EventPayload, Finding, FindingId, Severity, WorkspaceId};
use std::collections::{BTreeSet, HashSet};

/// Cap evidence anchors per finding. Mirrors the cap used by
/// `repeated_correction` so a runaway burst doesn't bloat the event
/// log.
const MAX_EVIDENCE_PER_FINDING: usize = 8;

/// Trailing-character budget when storing the opener verbatim on each
/// `Anchor::MessageSpan`. Long openers truncate to this many characters
/// so the evidence drawer stays skim-readable.
const QUOTE_MAX_CHARS: usize = 240;

#[derive(Debug, Default, Clone, Copy)]
pub struct RepeatedPromptOpeningDetector;

impl RepeatedPromptOpeningDetector {
    pub const NAME: &'static str = "repeated_prompt_opening";
    pub const VERSION: u32 = 1;
}

#[derive(Debug, Clone)]
struct Opener {
    event_id: String,
    workspace_id: WorkspaceId,
    quote: String,
    char_range: (u32, u32),
    tokens: HashSet<String>,
}

#[async_trait]
impl Detector for RepeatedPromptOpeningDetector {
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

fn detect(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled || config.max_findings_per_session == 0 {
        return Vec::new();
    }

    let openers = collect_openers(input);
    if openers.is_empty() {
        return Vec::new();
    }

    let clusters = cluster_openers(&openers, REPEATED_PROMPT_OPENING_JACCARD_MIN);

    let cap = config.max_findings_per_session as usize;
    let mut findings = Vec::new();
    for cluster in clusters {
        if findings.len() >= cap {
            break;
        }
        let count = cluster.len() as u32;
        let distinct_workspaces: u32 = cluster
            .iter()
            .map(|o| o.workspace_id)
            .collect::<BTreeSet<_>>()
            .len() as u32;
        if count < config.min_occurrences || distinct_workspaces < config.min_sessions {
            continue;
        }
        findings.push(build_finding(input, config, &cluster, distinct_workspaces));
    }
    findings
}

/// First user [`EventPayload::MessagePosted`] per `WorkspaceId`, in the
/// order workspaces are first observed in the event stream. A workspace
/// without any user message in the bundle is not represented.
fn collect_openers(input: &SessionAnalysisInput) -> Vec<Opener> {
    let mut seen: HashSet<WorkspaceId> = HashSet::new();
    let mut openers = Vec::new();
    for env in &input.events {
        let EventPayload::MessagePosted {
            workspace_id,
            author,
            body,
        } = &env.payload
        else {
            continue;
        };
        if !matches!(author, Actor::User) {
            continue;
        }
        if !seen.insert(*workspace_id) {
            continue;
        }
        let tokens = tokenize(body);
        if tokens.is_empty() {
            // Whitespace-only or punctuation-only opener. Skip — it
            // cannot match anything via Jaccard.
            continue;
        }
        let quote = truncate_quote(body);
        let char_range = (
            0u32,
            u32::try_from(quote.chars().count()).unwrap_or(u32::MAX),
        );
        openers.push(Opener {
            event_id: env.id.to_string(),
            workspace_id: *workspace_id,
            quote,
            char_range,
            tokens,
        });
    }
    openers
}

/// Lowercased, punctuation-stripped word tokens. Matches the spec in
/// `core-docs/roadmap.md` §"Phase 21.A2 / repeated_prompt_opening" —
/// no stopword filtering (Forge does, but Designer's threshold is
/// stricter to compensate, so the simpler tokenizer earns its keep).
fn tokenize(body: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut cur = String::new();
    for ch in body.chars() {
        if ch.is_alphanumeric() {
            cur.extend(ch.to_lowercase());
        } else if !cur.is_empty() {
            tokens.insert(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        tokens.insert(cur);
    }
    tokens
}

fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let intersection = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        return 0.0;
    }
    intersection as f32 / union as f32
}

/// Greedy connected-components cluster over the opener list. Each new
/// opener joins the first cluster where any existing member shares
/// Jaccard ≥ `floor` with it; otherwise it seeds its own cluster.
fn cluster_openers(openers: &[Opener], floor: f32) -> Vec<Vec<Opener>> {
    let mut clusters: Vec<Vec<Opener>> = Vec::new();
    for opener in openers {
        let mut placed = false;
        for cluster in &mut clusters {
            if cluster
                .iter()
                .any(|other| jaccard(&opener.tokens, &other.tokens) >= floor)
            {
                cluster.push(opener.clone());
                placed = true;
                break;
            }
        }
        if !placed {
            clusters.push(vec![opener.clone()]);
        }
    }
    clusters
}

fn truncate_quote(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= QUOTE_MAX_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(QUOTE_MAX_CHARS - 1).collect();
    out.push('\u{2026}');
    out
}

fn confidence_score(count: u32, min_occurrences: u32) -> f32 {
    let above = count.saturating_sub(min_occurrences);
    let raw = 0.5_f32 + (above as f32) * 0.10;
    raw.clamp(0.5, 0.95)
}

/// Evidence-text headline (per CONTRIBUTING §7). Passive voice, no
/// second person, describes the pattern not the action.
fn summary_line(count: u32, distinct_workspaces: u32) -> String {
    format!("Similar opening prompt observed in {count} sessions across {distinct_workspaces} workspaces")
}

fn build_finding(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
    cluster: &[Opener],
    distinct_workspaces: u32,
) -> Finding {
    let count = cluster.len() as u32;

    let evidence: Vec<Anchor> = cluster
        .iter()
        .take(MAX_EVIDENCE_PER_FINDING)
        .map(|o| Anchor::MessageSpan {
            message_id: o.event_id.clone(),
            quote: o.quote.clone(),
            char_range: Some(o.char_range),
        })
        .collect();

    let evidence_keys: Vec<&str> = cluster.iter().map(|o| o.event_id.as_str()).collect();
    let window_digest = window_digest(RepeatedPromptOpeningDetector::NAME, &evidence_keys);

    Finding {
        id: FindingId::new(),
        detector_name: RepeatedPromptOpeningDetector::NAME.into(),
        detector_version: RepeatedPromptOpeningDetector::VERSION,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::SKILL_DEFAULTS;
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

    #[test]
    fn tokenize_strips_punctuation_and_lowercases() {
        let tokens = tokenize("Hello, World! Foo-bar.");
        assert!(tokens.contains("hello"));
        assert!(tokens.contains("world"));
        assert!(tokens.contains("foo"));
        assert!(tokens.contains("bar"));
        assert_eq!(tokens.len(), 4);
    }

    #[test]
    fn jaccard_identical_sets_is_one() {
        let a: HashSet<String> = ["foo", "bar"].iter().map(|s| s.to_string()).collect();
        let b: HashSet<String> = ["foo", "bar"].iter().map(|s| s.to_string()).collect();
        assert!((jaccard(&a, &b) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn jaccard_empty_sets_is_zero() {
        let a: HashSet<String> = HashSet::new();
        let b: HashSet<String> = ["foo"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard(&a, &b), 0.0);
    }

    #[test]
    fn jaccard_disjoint_sets_is_zero() {
        let a: HashSet<String> = ["foo", "bar"].iter().map(|s| s.to_string()).collect();
        let b: HashSet<String> = ["baz", "qux"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard(&a, &b), 0.0);
    }

    #[test]
    fn confidence_clamps_into_band() {
        assert_eq!(confidence_score(4, 4), 0.5);
        assert!((confidence_score(9, 4) - 0.95).abs() < f32::EPSILON);
        assert_eq!(confidence_score(2, 4), 0.5);
    }

    #[test]
    fn summary_is_passive_and_pattern_focused() {
        let s = summary_line(4, 4);
        assert!(s.starts_with("Similar opening prompt"));
        assert!(!s.to_lowercase().contains(" you "));
    }

    #[tokio::test]
    async fn fires_on_four_paraphrased_openers() {
        let workspaces: Vec<WorkspaceId> = (0..4).map(|_| WorkspaceId::new()).collect();
        let openers = [
            "review the diff for the recent pull request",
            "please review the diff for this pull request",
            "review the recent pull request diff",
            "look at the pull request diff and review it",
        ];
        let events: Vec<EventEnvelope> = workspaces
            .iter()
            .zip(openers.iter())
            .enumerate()
            .map(|(i, (ws, body))| user_msg(i as u64 + 1, *ws, body))
            .collect();
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = SKILL_DEFAULTS;
        let detector = RepeatedPromptOpeningDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(f.detector_name, RepeatedPromptOpeningDetector::NAME);
        assert_eq!(f.severity, Severity::Notice);
        assert_eq!(f.evidence.len(), 4);
        assert!(f.summary.contains('4'));
    }

    #[tokio::test]
    async fn does_not_fire_on_distinct_openers() {
        let workspaces: Vec<WorkspaceId> = (0..4).map(|_| WorkspaceId::new()).collect();
        let openers = [
            "review the diff for the recent pull request",
            "explain how event sourcing handles compaction",
            "draft a plan for migrating away from moment.js",
            "build a Tauri command that exposes detector findings",
        ];
        let events: Vec<EventEnvelope> = workspaces
            .iter()
            .zip(openers.iter())
            .enumerate()
            .map(|(i, (ws, body))| user_msg(i as u64 + 1, *ws, body))
            .collect();
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = SKILL_DEFAULTS;
        let detector = RepeatedPromptOpeningDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn does_not_fire_below_threshold() {
        let workspaces: Vec<WorkspaceId> = (0..3).map(|_| WorkspaceId::new()).collect();
        let body = "review the diff for the recent pull request";
        let events: Vec<EventEnvelope> = workspaces
            .iter()
            .enumerate()
            .map(|(i, ws)| user_msg(i as u64 + 1, *ws, body))
            .collect();
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = SKILL_DEFAULTS;
        let detector = RepeatedPromptOpeningDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn only_first_user_message_per_workspace_is_an_opener() {
        let ws_a = WorkspaceId::new();
        let ws_b = WorkspaceId::new();
        // Workspace A: opener is the first message. The follow-ups
        // must not contribute a second "session" worth of evidence.
        let events = vec![
            user_msg(1, ws_a, "fix the bug in the auth handler"),
            user_msg(2, ws_a, "review the diff for the recent pull request"),
            user_msg(3, ws_a, "review the diff for the recent pull request"),
            user_msg(4, ws_a, "review the diff for the recent pull request"),
            user_msg(5, ws_b, "review the diff for the recent pull request"),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = SKILL_DEFAULTS;
        let detector = RepeatedPromptOpeningDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        // Two openers total (one per workspace), and they're not
        // similar to each other (the first opener is the bug-fix one).
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn returns_empty_when_disabled() {
        let workspaces: Vec<WorkspaceId> = (0..4).map(|_| WorkspaceId::new()).collect();
        let body = "review the diff for the recent pull request";
        let events: Vec<EventEnvelope> = workspaces
            .iter()
            .enumerate()
            .map(|(i, ws)| user_msg(i as u64 + 1, *ws, body))
            .collect();
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        let cfg = DetectorConfig::DISABLED;
        let detector = RepeatedPromptOpeningDetector;

        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();

        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn ignores_non_user_messages_when_picking_opener() {
        let ws = WorkspaceId::new();
        let mut events = vec![EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: 1,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::system(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload: EventPayload::MessagePosted {
                workspace_id: ws,
                author: Actor::system(),
                body: "review the diff for the recent pull request".into(),
            },
        }];
        events.push(user_msg(2, ws, "fix the bug in the auth handler"));
        let openers = collect_openers(
            &SessionAnalysisInput::builder(ProjectId::new())
                .events(events)
                .build(),
        );
        assert_eq!(openers.len(), 1);
        assert!(openers[0].quote.starts_with("fix the bug"));
    }
}
