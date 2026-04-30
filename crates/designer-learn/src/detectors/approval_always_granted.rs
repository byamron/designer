//! `approval_always_granted` — Designer-unique detector. Catches an
//! approval class (same `tool_name` + same canonical input) that has been
//! granted N or more times with zero denials. Signals an auto-approve
//! hook or a scope-expansion proposal candidate.
//!
//! ## Approval class — canonicalization rule
//!
//! A class key is `(workspace_id, tool, canonical_input)` derived from
//! the `ApprovalRequested.workspace_id`, `gate`, and `summary` fields.
//! `workspace_id` keeps cross-workspace patterns from merging when the
//! detector runs over a project-wide bundle.
//!
//! - **`tool`** — the lowercased tool name parsed out of the `gate`
//!   string. Production gates take the form `"tool:<ToolName>"` (see
//!   `apps/desktop/src-tauri/src/core_safety.rs` and the safety mock in
//!   `packages/app/src/test/safety.test.tsx`); the canonicalizer strips
//!   the `tool:` prefix when present and lowercases the remainder.
//!   Gates without the prefix (legacy `"write"` style) are used
//!   verbatim. The original cased form is kept alongside for display.
//!
//! - **`canonical_input`** — derived from the `summary` field, which
//!   the inbox handler populates with a one-line description of the
//!   tool input. Three rules, picked by the tool name:
//!
//!     1. **`Write`, `Edit`, `MultiEdit`, `NotebookEdit`** — find the
//!        first whitespace-delimited token that *looks like a path*
//!        (contains `/`, doesn't start with `-`, isn't a URL). Reduce
//!        it to its parent directory (`src/foo/bar.txt` → `src/foo/`).
//!        Path-less summaries fall through to rule 3.
//!     2. **`Bash`** — strip leading `Label:` prefixes (the inbox
//!        handler sometimes prepends `"Bash:"` or similar to the
//!        summary), then take the first token (the verb) plus a `*`
//!        wildcard if any non-flag argument follows
//!        (`prettier --write src/index.ts` → `prettier *`). Groups
//!        commands by intent rather than by argument.
//!     3. **Otherwise** — lowercase the trimmed summary and clamp to
//!        80 characters (counted in `chars`, not bytes). A coarse
//!        fallback so e.g. shell-tool variants still get *some*
//!        grouping; Phase B refines these classes with LLM synthesis.
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
//! - One `Anchor::ToolCall` per granted request, capped at 5 to keep
//!   evidence drawers concise. The anchor cap is independent of the
//!   grant count rendered in the summary.
//! - `window_digest` is keyed on the **class identity** (detector +
//!   tool + canonical input + workspace), not on the (capped) evidence
//!   list — so an open finding for the same class dedupes correctly at
//!   the `core_learn::report_finding` chokepoint as more grants
//!   accumulate.
//!
//! ## Window assumptions
//!
//! The detector assumes `ApprovalGranted`/`ApprovalDenied` events
//! arrive in the same `SessionAnalysisInput.events` slice as their
//! matching `ApprovalRequested`. Resolutions whose request scrolled
//! out of the window are logged at `debug!` and dropped — they would
//! otherwise be unattributable to a class. In practice the production
//! caller passes the full project event log, so orphan resolutions are
//! a calibration signal that the window is too narrow rather than a
//! steady-state condition.
//!
//! `DetectorConfig::min_sessions` is advisory in v1: this detector
//! treats each workspace's stream as one session. If a tuner sets
//! `min_sessions > 1`, the value is ignored and a `debug!` line is
//! emitted; multi-session aggregation is Phase 21.A3 territory.
//!
//! ## Forge co-installation
//!
//! Designer-unique. Always runs regardless of `~/.claude/plugins/forge/`
//! presence — Forge can't see Designer's approval gate events.

use std::collections::HashMap;

use async_trait::async_trait;
use designer_core::{Anchor, ApprovalId, EventPayload, Finding, Severity, Timestamp, WorkspaceId};

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

/// Single-pass aggregation over the event stream. One bounded
/// `HashMap` per active class, plus a per-`ApprovalId` lookup so
/// resolution events can find their request. Each event is read once.
fn run(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled {
        return Vec::new();
    }
    if config.min_sessions > 1 {
        tracing::debug!(
            target: "designer_learn::approval_always_granted",
            min_sessions = config.min_sessions,
            "min_sessions > 1 is advisory in v1; treating as 1"
        );
    }

    let mut requests: HashMap<ApprovalId, RequestRecord> = HashMap::new();
    let mut classes: HashMap<ClassKey, ClassAggregate> = HashMap::new();

    for env in &input.events {
        match &env.payload {
            EventPayload::ApprovalRequested {
                approval_id,
                workspace_id,
                gate,
                summary,
            } => {
                let (canonical_tool, display_tool) = parse_gate_tool(gate);
                let key = ClassKey {
                    workspace_id: *workspace_id,
                    input: canonical_input(&canonical_tool, summary),
                    tool: canonical_tool,
                };
                requests.insert(
                    *approval_id,
                    RequestRecord {
                        key: key.clone(),
                        display_tool,
                        event_id: env.id.to_string(),
                        timestamp: env.timestamp,
                    },
                );
                classes.entry(key).or_default();
            }
            EventPayload::ApprovalGranted { approval_id } => {
                let Some(rec) = requests.get(approval_id) else {
                    log_orphan(*approval_id, "granted");
                    continue;
                };
                let agg = classes.entry(rec.key.clone()).or_default();
                agg.grants += 1;
                if agg.display_tool.is_empty() {
                    agg.display_tool = rec.display_tool.clone();
                }
                if agg.grant_event_ids.len() < ApprovalAlwaysGrantedDetector::MAX_EVIDENCE_ANCHORS {
                    agg.grant_event_ids.push(rec.event_id.clone());
                }
                if agg.last_grant_at.map_or(true, |prev| prev < rec.timestamp) {
                    agg.last_grant_at = Some(rec.timestamp);
                }
            }
            EventPayload::ApprovalDenied { approval_id, .. } => {
                let Some(rec) = requests.get(approval_id) else {
                    log_orphan(*approval_id, "denied");
                    continue;
                };
                classes.entry(rec.key.clone()).or_default().denials += 1;
            }
            _ => {}
        }
    }

    let min_grants = config.min_occurrences.max(1);
    let severity = config.impact_override.unwrap_or(Severity::Notice);
    let mut findings: Vec<Finding> = Vec::new();
    let mut keys: Vec<ClassKey> = classes.keys().cloned().collect();
    // Stable order so fixture comparisons aren't `HashMap`-iteration-flaky.
    keys.sort();
    for key in keys {
        let Some(agg) = classes.get(&key) else {
            continue;
        };
        if agg.denials != 0 || agg.grants < min_grants {
            continue;
        }

        let display_tool = if agg.display_tool.is_empty() {
            display_tool_capitalized(&key.tool)
        } else {
            agg.display_tool.clone()
        };
        let evidence: Vec<Anchor> = agg
            .grant_event_ids
            .iter()
            .map(|event_id| Anchor::ToolCall {
                event_id: event_id.clone(),
                tool_name: display_tool.clone(),
            })
            .collect();

        findings.push(Finding {
            id: designer_core::FindingId::new(),
            detector_name: ApprovalAlwaysGrantedDetector::NAME.to_string(),
            detector_version: ApprovalAlwaysGrantedDetector::VERSION,
            project_id: input.project_id,
            workspace_id: Some(key.workspace_id),
            timestamp: agg.last_grant_at.unwrap_or(Timestamp::UNIX_EPOCH),
            severity,
            confidence: scaled_confidence(agg.grants, min_grants),
            summary: build_summary(&display_tool, &key.input, agg.grants),
            evidence,
            suggested_action: None,
            window_digest: class_digest(&key),
        });
    }
    findings
}

fn log_orphan(approval_id: ApprovalId, kind: &'static str) {
    tracing::debug!(
        target: "designer_learn::approval_always_granted",
        ?approval_id,
        kind,
        "orphan approval resolution: matching request not in window",
    );
}

#[derive(Debug, Clone)]
struct RequestRecord {
    key: ClassKey,
    /// Original-case tool name from the gate (e.g. `"MultiEdit"`),
    /// preserved separately because `key.tool` is lowercased for
    /// hashing.
    display_tool: String,
    event_id: String,
    timestamp: Timestamp,
}

#[derive(Debug, Default)]
struct ClassAggregate {
    grants: u32,
    denials: u32,
    /// Tool name in its original casing, captured from the first
    /// matched request. Used verbatim in the rendered summary.
    display_tool: String,
    grant_event_ids: Vec<String>,
    last_grant_at: Option<Timestamp>,
}

/// Canonical identity for an approval class.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct ClassKey {
    workspace_id: WorkspaceId,
    /// Lowercased tool name. The original casing lives on
    /// `RequestRecord::display_tool` / `ClassAggregate::display_tool`
    /// so summaries can render `"MultiEdit"` rather than `"Multiedit"`.
    tool: String,
    input: String,
}

/// Returns `(canonical_lowercased, display_original_case)` parsed from a
/// gate string. Production gates take the form `"tool:<ToolName>"`;
/// gates without that prefix are used verbatim.
fn parse_gate_tool(gate: &str) -> (String, String) {
    let display = match gate.split_once(':') {
        Some(("tool", rest)) => rest.trim(),
        _ => gate.trim(),
    };
    (display.to_ascii_lowercase(), display.to_string())
}

fn canonical_input(tool: &str, summary: &str) -> String {
    match tool {
        "write" | "edit" | "multiedit" | "notebookedit" => canonical_path_input(summary),
        "bash" => canonical_bash_input(summary),
        _ => fallback_input(summary),
    }
}

fn canonical_path_input(summary: &str) -> String {
    let path_token = summary.split_whitespace().find(|tok| {
        if tok.starts_with('-') {
            return false;
        }
        if tok.contains("://") {
            return false;
        }
        tok.contains('/')
    });
    let Some(path) = path_token else {
        return fallback_input(summary);
    };
    let trimmed = path.trim_end_matches([',', ';', ':', ')', ']', '"', '\'']);
    match trimmed.rsplit_once('/') {
        Some(("", _)) => "/".to_string(),
        Some((parent, _)) => format!("{parent}/"),
        None => trimmed.to_string(),
    }
}

fn canonical_bash_input(summary: &str) -> String {
    let mut text = summary.trim();
    // Strip leading "Label: <command>" prefixes (possibly nested) so
    // a summary like `"Bash: prettier src/foo.js"` collapses to the
    // real command class, not a `bash:` self-class.
    while let Some((first, rest)) = text.split_once(' ') {
        let stripped_label = first.ends_with(':') && first.len() > 1;
        let next = rest.trim_start();
        if !stripped_label || next.is_empty() {
            break;
        }
        text = next;
    }
    let mut tokens = text.split_whitespace();
    let Some(verb) = tokens.next() else {
        return fallback_input(summary);
    };
    let verb = verb.to_ascii_lowercase();
    let has_arg = tokens.any(|t| !t.starts_with('-'));
    if has_arg {
        format!("{verb} *")
    } else {
        verb
    }
}

fn fallback_input(summary: &str) -> String {
    let normalized = summary.trim().to_ascii_lowercase();
    if normalized.chars().count() > 80 {
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

fn build_summary(display_tool: &str, input: &str, grants: u32) -> String {
    let display_input = if input.is_empty() {
        "(no input)"
    } else {
        input
    };
    let raw = format!(
        "ApprovalRequested for {display_tool}({display_input}) granted {grants}\u{00d7}, 0 denials",
    );
    if raw.chars().count() <= 100 {
        raw
    } else {
        let mut out: String = raw.chars().take(99).collect();
        out.push('\u{2026}');
        out
    }
}

fn display_tool_capitalized(lower: &str) -> String {
    let mut chars = lower.chars();
    match chars.next() {
        Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

fn class_digest(key: &ClassKey) -> String {
    let composite = format!("{}\x1f{}\x1f{}", key.workspace_id, key.tool, key.input);
    window_digest(ApprovalAlwaysGrantedDetector::NAME, &[composite.as_str()])
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
    fn parse_gate_tool_returns_lowercased_and_display_pair() {
        assert_eq!(
            parse_gate_tool("tool:MultiEdit"),
            ("multiedit".into(), "MultiEdit".into())
        );
        assert_eq!(parse_gate_tool("tool:Bash"), ("bash".into(), "Bash".into()));
        // Legacy gate without the `tool:` prefix is passed through.
        assert_eq!(parse_gate_tool("write"), ("write".into(), "write".into()));
        assert_eq!(parse_gate_tool("WRITE"), ("write".into(), "WRITE".into()));
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
    fn canonical_path_input_skips_flag_args_and_urls() {
        // Flag values that happen to contain `/` must not be treated as
        // the path; the real path token follows.
        assert_eq!(
            canonical_path_input("Write --backup=/tmp/old src/lib.rs"),
            "src/"
        );
        // URLs are not paths.
        assert_eq!(
            canonical_path_input("Write https://example.com src/lib.rs"),
            "src/"
        );
        // Path-less summary falls back to the lowercased trimmed text.
        assert_eq!(canonical_path_input("Write"), "write");
    }

    #[test]
    fn canonical_bash_input_collapses_args_to_wildcard() {
        assert_eq!(
            canonical_bash_input("prettier --write src/index.ts"),
            "prettier *"
        );
        assert_eq!(canonical_bash_input("eslint"), "eslint");
        // Label-prefixed summaries should not turn into a `bash *` class
        // — strip the label and canonicalize the real command.
        assert_eq!(
            canonical_bash_input("Bash: prettier src/foo.js"),
            "prettier *"
        );
        assert_eq!(canonical_bash_input("Run: cargo test"), "cargo *");
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
        assert_eq!(f.workspace_id, Some(ws));
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
        for i in 0..5 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws, "tool:Bash", "prettier src/index.ts"),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
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
    async fn same_verb_different_args_merge_into_one_class() {
        // `prettier src/a.ts` and `prettier src/b.ts` are both
        // `(Bash, "prettier *")` — they should aggregate.
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let inputs = [
            "prettier src/a.ts",
            "prettier src/b.ts",
            "prettier --write src/c.ts",
            "prettier docs/d.md",
            "prettier scripts/e.js",
        ];
        for (i, summary) in inputs.iter().enumerate() {
            let id = ApprovalId::new();
            events.push(env((i * 2) as u64, req(id, ws, "tool:Bash", summary), ws));
            events.push(env((i * 2 + 1) as u64, granted(id), ws));
        }
        let findings = run_detector(events).await;
        assert_eq!(findings.len(), 1, "args should not split the class");
        assert!(findings[0].summary.contains("granted 5"));
    }

    #[tokio::test]
    async fn cross_workspace_classes_do_not_merge() {
        let ws_a = WorkspaceId::new();
        let ws_b = WorkspaceId::new();
        let mut events = Vec::new();
        // 3 grants in workspace A.
        for i in 0..3 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(id, ws_a, "tool:Bash", "prettier src/a.ts"),
                ws_a,
            ));
            events.push(env(i * 2 + 1, granted(id), ws_a));
        }
        // 3 grants in workspace B.
        for i in 0..3 {
            let id = ApprovalId::new();
            events.push(env(
                100 + i * 2,
                req(id, ws_b, "tool:Bash", "prettier src/b.ts"),
                ws_b,
            ));
            events.push(env(101 + i * 2, granted(id), ws_b));
        }
        // Neither workspace hits the 5-grant threshold individually, so
        // no findings should emit. (Pre-fix, the project-wide bundle
        // would have rolled them up to 6 and triggered a false positive.)
        let findings = run_detector(events).await;
        assert!(
            findings.is_empty(),
            "got cross-workspace bleed: {findings:?}"
        );
    }

    #[tokio::test]
    async fn tool_casing_preserved_in_summary() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..5 {
            let id = ApprovalId::new();
            events.push(env(
                i * 2,
                req(
                    id,
                    ws,
                    "tool:MultiEdit",
                    &format!("MultiEdit src/foo/{i}.ts"),
                ),
                ws,
            ));
            events.push(env(i * 2 + 1, granted(id), ws));
        }
        let findings = run_detector(events).await;
        assert_eq!(findings.len(), 1);
        assert!(
            findings[0].summary.contains("MultiEdit("),
            "tool casing lost: {}",
            findings[0].summary,
        );
    }

    #[tokio::test]
    async fn many_grants_cap_evidence_but_lift_confidence() {
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..20 {
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
        assert_eq!(
            f.evidence.len(),
            ApprovalAlwaysGrantedDetector::MAX_EVIDENCE_ANCHORS
        );
        assert!(f.summary.contains("granted 20"));
        assert!((f.confidence - 0.95).abs() < 1e-6);
    }

    #[tokio::test]
    async fn class_digest_is_stable_for_same_class() {
        // Two runs over the same class must produce the same
        // `window_digest` — that's what the chokepoint dedup relies on.
        let ws = WorkspaceId::new();
        let make_events = || {
            let mut events = Vec::new();
            for i in 0..6 {
                let id = ApprovalId::new();
                events.push(env(
                    i * 2,
                    req(id, ws, "tool:Bash", "prettier src/index.ts"),
                    ws,
                ));
                events.push(env(i * 2 + 1, granted(id), ws));
            }
            events
        };
        let f1 = run_detector(make_events()).await;
        let f2 = run_detector(make_events()).await;
        assert_eq!(f1.len(), 1);
        assert_eq!(f2.len(), 1);
        assert_eq!(f1[0].window_digest, f2[0].window_digest);
    }

    #[tokio::test]
    async fn orphan_resolution_is_dropped_safely() {
        // A grant whose request scrolled out of the window must not
        // count toward any class — otherwise the "always granted"
        // signal can come from incomplete history.
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let orphan_id = ApprovalId::new();
        events.push(env(0, granted(orphan_id), ws));
        for i in 0..4 {
            let id = ApprovalId::new();
            events.push(env(
                1 + i * 2,
                req(id, ws, "tool:Bash", "prettier src/index.ts"),
                ws,
            ));
            events.push(env(2 + i * 2, granted(id), ws));
        }
        let findings = run_detector(events).await;
        assert!(findings.is_empty(), "orphan grant should not pad the count");
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
