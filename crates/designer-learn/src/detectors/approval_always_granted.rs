//! `approval_always_granted` — Designer-unique detector. Catches an
//! approval class (same `tool_name` + same canonical input) that has been
//! granted N or more times with zero denials. Signals an auto-approve
//! hook or a scope-expansion proposal candidate.
//!
//! ## Approval class — canonicalization rule
//!
//! A class key is `(tool_name, canonical_input)` derived from the
//! `ApprovalRequested.gate` and `ApprovalRequested.summary` fields:
//!
//! - **`tool_name`** — taken from the `gate` string. The gate is the
//!   permission identifier emitted by the inbox handler; production
//!   format is `"tool:<ToolName>"` (see
//!   `apps/desktop/src-tauri/src/core_safety.rs` + the safety mock in
//!   `packages/app/src/test/safety.test.tsx`). The canonicalizer strips
//!   the `tool:` prefix when present and lowercases the rest. Gates that
//!   don't carry a `tool:` prefix (legacy / generic gates such as
//!   `"write"`) are used verbatim.
//!
//! - **`canonical_input`** — derived from the `summary` field, which the
//!   permission handler populates with a one-line description of the
//!   tool input. Three rules, picked by the tool name:
//!
//!     1. **`Write`, `Edit`, `MultiEdit`, `NotebookEdit`** — find the
//!        first whitespace-delimited token that looks like a path
//!        (contains `/` or starts with `./`/`../`). Reduce to its parent
//!        directory (`src/foo/bar.txt` → `src/foo/`). Path-less
//!        summaries fall through to rule 3.
//!     2. **`Bash`** — split on whitespace, take the first token (the
//!        verb) plus the first non-flag argument collapsed to a `*`
//!        wildcard (`prettier --write src/index.ts` → `prettier *`).
//!        This matches Forge's `_canonical_bash` sketch and groups
//!        commands by intent rather than by argument.
//!     3. **Otherwise** — lowercase the trimmed summary and clamp to
//!        80 chars. A coarse fallback so e.g. shell-tool variants still
//!        get *some* grouping; Phase B will refine these classes with
//!        LLM synthesis.
//!
//! Phase B re-implements this canonicalization on its side when it
//! synthesizes the proposal. Keep the rule documented here so the two
//! layers don't drift.
//!
//! ## Output
//!
//! - `severity: Notice` (per `APPROVAL_ALWAYS_GRANTED_DEFAULTS`).
//! - `confidence` scales linearly with grant count above the
//!   `min_occurrences` floor, clamped to `[0.6, 0.95]`. Zero-denial is
//!   itself strong signal; the high floor reflects that.
//! - `summary` is **clinical evidence text** per the 21.A1.2 surface
//!   contract: passive voice, describes the pattern, no second-person
//!   address. Phase B's synthesizer composes the user-facing
//!   recommendation; this string only powers the evidence drawer.
//! - `suggested_action: None` — proposal generation lives in Phase B
//!   (kind: `auto-approve-hook` or `scope-expansion`).
//! - One `Anchor::ToolCall` per granted request (capped at 5 to keep
//!   evidence drawers small).
//!
//! ## Forge co-installation
//!
//! Designer-unique. Always runs regardless of `~/.claude/plugins/forge/`
//! presence — Forge can't see Designer's approval gate events.

use std::collections::HashMap;

use async_trait::async_trait;
use designer_core::{Anchor, ApprovalId, EventPayload, Finding, Severity, Timestamp};

use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};

/// Detector handle. Stateless — all aggregation lives inside `analyze`.
#[derive(Debug, Default, Clone, Copy)]
pub struct ApprovalAlwaysGrantedDetector;

impl ApprovalAlwaysGrantedDetector {
    pub const NAME: &'static str = "approval_always_granted";
    pub const VERSION: u32 = 1;

    /// Confidence floor; chosen because zero-denial in N≥5 attempts is
    /// already a strong empirical signal.
    const CONFIDENCE_FLOOR: f32 = 0.60;
    /// Confidence ceiling; reserved for "this approval class has never
    /// been denied across many grants."
    const CONFIDENCE_CEILING: f32 = 0.95;
    /// Each grant beyond the threshold lifts confidence by this step
    /// before clamping. `5 grants → 0.60`, `12 grants → 0.95`.
    const CONFIDENCE_STEP: f32 = 0.05;
    /// Cap on attached `ToolCall` anchors per finding. Keeps the
    /// evidence drawer concise — the count is in the summary, the
    /// anchors are spot-check pointers.
    const MAX_EVIDENCE_ANCHORS: usize = 5;
}

#[async_trait]
impl Detector for ApprovalAlwaysGrantedDetector {
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
        Ok(run(input, config))
    }

    #[cfg(not(feature = "local-ops"))]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(run(input, config))
    }
}

/// Single-pass aggregation over the event stream.
///
/// Streaming-friendly in shape (one bounded `HashMap` keyed by
/// approval class, plus a request lookup keyed by `ApprovalId`); the
/// trait still hands us a slice today but the loop reads each event
/// once and never goes back. When the trait flips to a stream in a
/// later phase, this body lifts as-is.
fn run(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled {
        return Vec::new();
    }

    // Per-approval lookup so resolution events can find their request.
    let mut requests: HashMap<ApprovalId, RequestRecord> = HashMap::new();
    // Per-class accumulator. The key is the canonical class identity.
    let mut classes: HashMap<ClassKey, ClassAggregate> = HashMap::new();

    for env in &input.events {
        match &env.payload {
            EventPayload::ApprovalRequested {
                approval_id,
                gate,
                summary,
                ..
            } => {
                let key = canonical_class(gate, summary);
                requests.insert(
                    *approval_id,
                    RequestRecord {
                        key: key.clone(),
                        event_id: env.id.to_string(),
                        timestamp: env.timestamp,
                    },
                );
                classes.entry(key).or_default();
            }
            EventPayload::ApprovalGranted { approval_id } => {
                if let Some(rec) = requests.get(approval_id) {
                    let agg = classes.entry(rec.key.clone()).or_default();
                    agg.grants += 1;
                    if agg.grant_event_ids.len()
                        < ApprovalAlwaysGrantedDetector::MAX_EVIDENCE_ANCHORS
                    {
                        agg.grant_event_ids.push(rec.event_id.clone());
                    }
                    let bump = match agg.last_grant_at {
                        None => true,
                        Some(prev) => prev < rec.timestamp,
                    };
                    if bump {
                        agg.last_grant_at = Some(rec.timestamp);
                    }
                }
            }
            EventPayload::ApprovalDenied { approval_id, .. } => {
                if let Some(rec) = requests.get(approval_id) {
                    let agg = classes.entry(rec.key.clone()).or_default();
                    agg.denials += 1;
                }
            }
            _ => {}
        }
    }

    let min_grants = config.min_occurrences.max(1);
    let mut findings: Vec<Finding> = Vec::new();
    let mut keys: Vec<ClassKey> = classes.keys().cloned().collect();
    // Stable order so fixture comparisons aren't `HashMap`-iteration-flaky.
    keys.sort();
    for key in keys {
        let agg = match classes.get(&key) {
            Some(a) => a,
            None => continue,
        };
        if agg.denials != 0 {
            continue;
        }
        if agg.grants < min_grants {
            continue;
        }

        let confidence = scaled_confidence(agg.grants, min_grants);
        let timestamp = agg.last_grant_at.unwrap_or(Timestamp::UNIX_EPOCH);
        let evidence: Vec<Anchor> = agg
            .grant_event_ids
            .iter()
            .map(|event_id| Anchor::ToolCall {
                event_id: event_id.clone(),
                tool_name: key.tool.clone(),
            })
            .collect();
        let evidence_keys: Vec<&str> = agg.grant_event_ids.iter().map(String::as_str).collect();

        findings.push(Finding {
            id: designer_core::FindingId::new(),
            detector_name: ApprovalAlwaysGrantedDetector::NAME.to_string(),
            detector_version: ApprovalAlwaysGrantedDetector::VERSION,
            project_id: input.project_id,
            workspace_id: input.workspace_id,
            timestamp,
            severity: config.impact_override.unwrap_or(Severity::Notice),
            confidence,
            summary: build_summary(&key, agg.grants),
            evidence,
            suggested_action: None,
            window_digest: window_digest(ApprovalAlwaysGrantedDetector::NAME, &evidence_keys),
        });
    }
    findings
}

#[derive(Debug, Clone)]
struct RequestRecord {
    key: ClassKey,
    event_id: String,
    timestamp: Timestamp,
}

#[derive(Debug, Default)]
struct ClassAggregate {
    grants: u32,
    denials: u32,
    grant_event_ids: Vec<String>,
    last_grant_at: Option<Timestamp>,
}

/// Canonical identity for an approval class. `tool` is the lowercased
/// tool name (gate stripped of its `tool:` prefix when present);
/// `input` is the canonicalized argument shape.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct ClassKey {
    tool: String,
    input: String,
}

fn canonical_class(gate: &str, summary: &str) -> ClassKey {
    let tool = match gate.split_once(':') {
        Some(("tool", rest)) => rest.trim().to_ascii_lowercase(),
        _ => gate.trim().to_ascii_lowercase(),
    };
    let input = canonical_input(&tool, summary);
    ClassKey { tool, input }
}

fn canonical_input(tool: &str, summary: &str) -> String {
    match tool {
        "write" | "edit" | "multiedit" | "notebookedit" => canonical_path_input(summary),
        "bash" => canonical_bash_input(summary),
        _ => fallback_input(summary),
    }
}

fn canonical_path_input(summary: &str) -> String {
    let path_token = summary
        .split_whitespace()
        .find(|tok| tok.contains('/') || tok.starts_with("./") || tok.starts_with("../"));
    match path_token {
        Some(path) => {
            let trimmed = path.trim_end_matches(&[',', ';', ':', ')', ']', '"', '\''][..]);
            match trimmed.rsplit_once('/') {
                Some((parent, _)) if !parent.is_empty() => format!("{parent}/"),
                Some(_) => "/".to_string(),
                None => trimmed.to_string(),
            }
        }
        None => fallback_input(summary),
    }
}

fn canonical_bash_input(summary: &str) -> String {
    let mut tokens = summary.split_whitespace();
    let verb = match tokens.next() {
        Some(t) => t.trim_end_matches(':').to_ascii_lowercase(),
        None => return fallback_input(summary),
    };
    let has_arg = tokens.any(|t| !t.starts_with('-'));
    if has_arg {
        format!("{verb} *")
    } else {
        verb
    }
}

fn fallback_input(summary: &str) -> String {
    let normalized: String = summary.trim().to_ascii_lowercase();
    if normalized.len() > 80 {
        normalized.chars().take(80).collect()
    } else {
        normalized
    }
}

fn scaled_confidence(grants: u32, min_grants: u32) -> f32 {
    let extra = grants.saturating_sub(min_grants) as f32;
    let raw = ApprovalAlwaysGrantedDetector::CONFIDENCE_FLOOR
        + extra * ApprovalAlwaysGrantedDetector::CONFIDENCE_STEP;
    raw.clamp(
        ApprovalAlwaysGrantedDetector::CONFIDENCE_FLOOR,
        ApprovalAlwaysGrantedDetector::CONFIDENCE_CEILING,
    )
}

fn build_summary(key: &ClassKey, grants: u32) -> String {
    let display_input = if key.input.is_empty() {
        "(no input)"
    } else {
        key.input.as_str()
    };
    let raw = format!(
        "ApprovalRequested for {tool}({input}) granted {grants}\u{00d7}, 0 denials",
        tool = display_tool(&key.tool),
        input = display_input,
        grants = grants,
    );
    if raw.chars().count() <= 100 {
        raw
    } else {
        let mut out: String = raw.chars().take(99).collect();
        out.push('\u{2026}');
        out
    }
}

fn display_tool(lower: &str) -> String {
    if lower.is_empty() {
        return lower.to_string();
    }
    let mut chars = lower.chars();
    let first = chars
        .next()
        .map(|c| c.to_ascii_uppercase())
        .unwrap_or_default();
    let rest: String = chars.collect();
    format!("{first}{rest}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SessionAnalysisInput;
    use designer_core::{
        Actor, ApprovalId, EventEnvelope, EventId, ProjectId, StreamId, WorkspaceId,
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

    fn req(approval_id: ApprovalId, ws: WorkspaceId, gate: &str, summary: &str) -> EventPayload {
        EventPayload::ApprovalRequested {
            approval_id,
            workspace_id: ws,
            gate: gate.into(),
            summary: summary.into(),
        }
    }

    fn granted(id: ApprovalId) -> EventPayload {
        EventPayload::ApprovalGranted { approval_id: id }
    }

    fn denied(id: ApprovalId) -> EventPayload {
        EventPayload::ApprovalDenied {
            approval_id: id,
            reason: None,
        }
    }

    async fn run_detector(events: Vec<EventEnvelope>) -> Vec<Finding> {
        let detector = ApprovalAlwaysGrantedDetector;
        let cfg = crate::defaults::APPROVAL_ALWAYS_GRANTED_DEFAULTS;
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        #[cfg(feature = "local-ops")]
        {
            detector.analyze(&input, &cfg, None).await.unwrap()
        }
        #[cfg(not(feature = "local-ops"))]
        {
            detector.analyze(&input, &cfg).await.unwrap()
        }
    }

    #[test]
    fn canonical_class_strips_tool_prefix_and_lowercases() {
        let key = canonical_class("tool:Write", "Write src/foo/bar.rs");
        assert_eq!(key.tool, "write");
        assert_eq!(key.input, "src/foo/");
    }

    #[test]
    fn canonical_class_uses_gate_verbatim_when_no_prefix() {
        let key = canonical_class("write", "first approval");
        assert_eq!(key.tool, "write");
    }

    #[test]
    fn canonical_path_input_collapses_to_parent_dir() {
        assert_eq!(
            canonical_path_input("Write packages/app/src/Component.tsx"),
            "packages/app/src/"
        );
        assert_eq!(canonical_path_input("Edit foo/bar"), "foo/");
        assert_eq!(canonical_path_input("Write /etc/passwd"), "/etc/");
    }

    #[test]
    fn canonical_bash_input_collapses_args_to_wildcard() {
        assert_eq!(
            canonical_bash_input("prettier --write src/index.ts"),
            "prettier *"
        );
        assert_eq!(canonical_bash_input("eslint"), "eslint");
        assert_eq!(canonical_bash_input("bash: prettier src/foo.js"), "bash *");
    }

    #[test]
    fn scaled_confidence_floor_and_ceiling() {
        assert!((scaled_confidence(5, 5) - 0.60).abs() < 1e-6);
        assert!((scaled_confidence(12, 5) - 0.95).abs() < 1e-6);
        assert!(scaled_confidence(2, 5) >= 0.60);
        assert!(scaled_confidence(50, 5) <= 0.95);
    }

    #[tokio::test]
    async fn five_grants_zero_denials_emits_one_finding() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..5 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws, "tool:Bash", "prettier src/index.ts"),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
        let findings = run_detector(events).await;
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(f.detector_name, "approval_always_granted");
        assert_eq!(f.detector_version, 1);
        assert_eq!(f.severity, Severity::Notice);
        assert!(f.summary.contains("Bash"));
        assert!(f.summary.contains("prettier *"));
        assert!(f.summary.contains("granted 5"));
        assert!(f.summary.contains("0 denials"));
        assert!(!f.summary.contains("you"));
        assert!(f.confidence >= 0.60 && f.confidence <= 0.95);
        assert_eq!(f.evidence.len(), 5);
        assert!(f.suggested_action.is_none());
    }

    #[tokio::test]
    async fn one_denial_in_class_suppresses_finding() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..5 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws, "tool:Write", "Write src/lib.rs"),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
        // One same-class denial at the end.
        let id = ApprovalId::new();
        events.push(env(
            100,
            req(id, ws, "tool:Write", "Write src/other.rs"),
            ws,
        ));
        events.push(env(101, denied(id), ws));
        let findings = run_detector(events).await;
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn under_threshold_emits_nothing() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..4 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws, "tool:Write", "Write src/lib.rs"),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
        let findings = run_detector(events).await;
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn distinct_classes_aggregate_independently() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        // 5 grants of class A.
        for i in 0..5 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws, "tool:Bash", "prettier src/index.ts"),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
        // 3 grants of class B (under threshold).
        for i in 0..3 {
            let id = ApprovalId::new();
            events.push(env(
                100 + i * 2,
                req(id, ws, "tool:Bash", "eslint src/foo.ts"),
                ws,
            ));
            events.push(env(101 + i * 2, granted(id), ws));
        }
        let findings = run_detector(events).await;
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("prettier *"));
    }

    #[tokio::test]
    async fn disabled_config_returns_empty() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..6 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws, "tool:Write", "Write src/lib.rs"),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
        let detector = ApprovalAlwaysGrantedDetector;
        let cfg = DetectorConfig::DISABLED;
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .events(events)
            .build();
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert!(findings.is_empty());
    }
}
