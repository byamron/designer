//! `scope_false_positive` — Designer-unique detector for the pattern
//! "ScopeDenied for a path the user then immediately approved or widened
//! scope to allow." Reads `ScopeDenied` events (Designer's gate log;
//! invisible to plugin tooling) and pairs each canonical denial path with
//! a subsequent `ApprovalRequested` + `ApprovalGranted` whose summary
//! references the same path.
//!
//! Output evidence text (the `Finding::summary` field) follows the
//! "Summary copy" convention added to `CONTRIBUTING.md` in 21.A1.2: it
//! describes the observation in passive voice without addressing the
//! user, and stays under ~100 chars. Phase B's synthesis pass turns the
//! observation into the user-facing recommendation; this detector only
//! produces clean evidence under a `scope-rule-relaxation` proposal.
//!
//! ## Threshold scope
//!
//! Reads `config.min_occurrences` (default 3 per
//! [`crate::defaults::SCOPE_FALSE_POSITIVE_DEFAULTS`]). The companion
//! `config.min_sessions` knob is **not** consumed in Phase A — the
//! `SessionAnalysisInput` bundle does not yet expose per-session
//! boundaries, and the default ships with `min_sessions: 1` so the
//! observable behavior matches the configured policy. If the bundle
//! gains a session-split view, bump `VERSION` and start filtering on it.

use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::{
    Anchor, ApprovalId, EventId, EventPayload, Finding, FindingId, Severity, Timestamp,
};
use std::collections::HashMap;
use std::path::Path;

/// Designer-unique detector. Always runs (not in `FORGE_OVERLAP_DETECTORS`).
#[derive(Debug, Default, Clone, Copy)]
pub struct ScopeFalsePositiveDetector;

impl ScopeFalsePositiveDetector {
    pub const NAME: &'static str = "scope_false_positive";
    pub const VERSION: u32 = 1;
    /// `Anchor::ToolCall.tool_name` value for the denial events. Tests
    /// and downstream consumers can match against this constant instead
    /// of the literal string.
    pub const TOOL_NAME_DENIAL: &'static str = "ScopeDenied";
    /// `Anchor::ToolCall.tool_name` value for the user-override events.
    pub const TOOL_NAME_OVERRIDE: &'static str = "ApprovalGranted";
    /// Confidence floor — a single override after the threshold of
    /// denials is suggestive but the user may have made a one-off
    /// mistake. Roadmap §"21.A2 / scope_false_positive" pins this floor.
    pub const CONFIDENCE_MIN: f32 = 0.5;
    /// Confidence ceiling — repeated overrides strengthen the signal but
    /// never make it certain; the rule may still be the right default
    /// and the user could be widening scope in error.
    pub const CONFIDENCE_MAX: f32 = 0.85;
    /// Each additional denial above `min_occurrences` adds this much to
    /// confidence, capped by `CONFIDENCE_MAX`.
    const CONFIDENCE_STEP: f32 = 0.05;
    /// Summary char budget per the "Summary copy" addendum.
    const SUMMARY_BUDGET: usize = 100;
}

#[async_trait]
impl Detector for ScopeFalsePositiveDetector {
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

#[derive(Default)]
struct PathEvidence {
    denial_event_ids: Vec<EventId>,
    last_denial_ts: Option<Timestamp>,
    override_event_ids: Vec<EventId>,
}

fn detect(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled || config.max_findings_per_session == 0 {
        return Vec::new();
    }

    let mut by_path: HashMap<String, PathEvidence> = HashMap::new();
    // ApprovalRequested → ApprovalGranted is correlated by `approval_id`.
    // Entries live until the matching `Granted` (counted as a user
    // override) or `Denied` (dropped — a denied approval is not a
    // false-positive signal). Orphaned requests stay in the map for
    // the rest of the pass; the analysis window is bounded by the
    // caller, so this is O(events) memory.
    let mut pending_approvals: HashMap<ApprovalId, String> = HashMap::new();

    for env in &input.events {
        match &env.payload {
            EventPayload::ScopeDenied { path, .. } => {
                let entry = by_path.entry(canonicalize_in_spirit(path)).or_default();
                entry.denial_event_ids.push(env.id);
                entry.last_denial_ts = Some(env.timestamp);
            }
            EventPayload::ApprovalRequested {
                approval_id,
                summary,
                ..
            } => {
                // Skip the summary allocation when no denial has been
                // observed yet — the granted-arm scan will find nothing
                // to credit, so the summary is dead weight in the map.
                if by_path.is_empty() {
                    continue;
                }
                pending_approvals.insert(*approval_id, summary.clone());
            }
            EventPayload::ApprovalGranted { approval_id } => {
                if let Some(summary) = pending_approvals.remove(approval_id) {
                    for (canonical, evidence) in by_path.iter_mut() {
                        if summary_mentions_path(&summary, canonical) {
                            evidence.override_event_ids.push(env.id);
                        }
                    }
                }
            }
            EventPayload::ApprovalDenied { approval_id, .. } => {
                pending_approvals.remove(approval_id);
            }
            _ => {}
        }
    }

    // Drain the map so `build_finding` can consume the evidence without
    // re-cloning. Sort gives deterministic emission order across runs.
    let mut entries: Vec<(String, PathEvidence)> = by_path.into_iter().collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let cap = config.max_findings_per_session as usize;
    entries
        .into_iter()
        .filter(|(_, ev)| {
            (ev.denial_event_ids.len() as u32) >= config.min_occurrences
                && !ev.override_event_ids.is_empty()
        })
        .take(cap)
        .map(|(canonical, evidence)| build_finding(input, config, &canonical, evidence))
        .collect()
}

fn build_finding(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
    canonical: &str,
    evidence: PathEvidence,
) -> Finding {
    let denial_count = evidence.denial_event_ids.len() as u32;
    let above = denial_count.saturating_sub(config.min_occurrences) as f32;
    let confidence = (ScopeFalsePositiveDetector::CONFIDENCE_MIN
        + ScopeFalsePositiveDetector::CONFIDENCE_STEP * above)
        .clamp(
            ScopeFalsePositiveDetector::CONFIDENCE_MIN,
            ScopeFalsePositiveDetector::CONFIDENCE_MAX,
        );

    let denial_strs: Vec<String> = evidence
        .denial_event_ids
        .iter()
        .map(EventId::to_string)
        .collect();
    let override_strs: Vec<String> = evidence
        .override_event_ids
        .iter()
        .map(EventId::to_string)
        .collect();

    let mut anchors: Vec<Anchor> = Vec::with_capacity(1 + denial_strs.len() + override_strs.len());
    anchors.push(Anchor::FilePath {
        path: canonical.to_string(),
        line_range: None,
    });
    anchors.extend(denial_strs.iter().map(|id| Anchor::ToolCall {
        event_id: id.clone(),
        tool_name: ScopeFalsePositiveDetector::TOOL_NAME_DENIAL.into(),
    }));
    anchors.extend(override_strs.iter().map(|id| Anchor::ToolCall {
        event_id: id.clone(),
        tool_name: ScopeFalsePositiveDetector::TOOL_NAME_OVERRIDE.into(),
    }));

    let key_refs: Vec<&str> = denial_strs
        .iter()
        .chain(override_strs.iter())
        .map(String::as_str)
        .collect();
    let digest = window_digest(ScopeFalsePositiveDetector::NAME, &key_refs);

    Finding {
        id: FindingId::new(),
        detector_name: ScopeFalsePositiveDetector::NAME.to_string(),
        detector_version: ScopeFalsePositiveDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: evidence
            .last_denial_ts
            .or_else(|| input.events.last().map(|e| e.timestamp))
            .unwrap_or(Timestamp::UNIX_EPOCH),
        severity: config.impact_override.unwrap_or(Severity::Notice),
        confidence,
        summary: trim_summary(format!(
            "ScopeDenied for {canonical} observed {denial_count}\u{00d7}, then user-approved override"
        )),
        evidence: anchors,
        suggested_action: None,
        window_digest: digest,
    }
}

/// Lexical canonicalization, sibling to Phase 13.I's filesystem
/// `canonicalize()` but pure-string: strip empty and `.` components,
/// resolve `..` against the running stack, drop trailing slashes. Does
/// **not** touch the filesystem — events may reference paths that don't
/// exist on the analysis host.
fn canonicalize_in_spirit(p: &Path) -> String {
    let s = p.to_string_lossy();
    let absolute = s.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in s.split('/').filter(|x| !x.is_empty() && *x != ".") {
        if part == ".." {
            let last_is_parent = matches!(parts.last(), Some(&seg) if seg == "..");
            if !parts.is_empty() && !last_is_parent {
                parts.pop();
            } else if !absolute {
                parts.push("..");
            }
        } else {
            parts.push(part);
        }
    }
    let body = parts.join("/");
    match (absolute, body.is_empty()) {
        (true, true) => "/".into(),
        (true, false) => format!("/{body}"),
        (false, true) => ".".into(),
        (false, false) => body,
    }
}

/// Path-in-summary match used to credit an approval grant against a
/// previously denied path. Substring match on the canonical form covers
/// the common case ("Allow write to src/foo/bar.rs"). For glob denials
/// (`src/foo/*`, `src/foo/**`) the trailing wildcard is stripped so a
/// concrete-path approval (`src/foo/bar.rs`) still credits the rule.
fn summary_mentions_path(summary: &str, canonical: &str) -> bool {
    if canonical.is_empty() {
        return false;
    }
    if summary.contains(canonical) {
        return true;
    }
    let prefix = canonical.trim_end_matches("/**").trim_end_matches("/*");
    if prefix.is_empty() || prefix == canonical {
        return false;
    }
    summary.contains(prefix)
}

fn trim_summary(summary: String) -> String {
    if summary.chars().count() <= ScopeFalsePositiveDetector::SUMMARY_BUDGET {
        return summary;
    }
    let mut out: String = summary
        .chars()
        .take(ScopeFalsePositiveDetector::SUMMARY_BUDGET - 1)
        .collect();
    out.push('\u{2026}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::SCOPE_FALSE_POSITIVE_DEFAULTS;
    use designer_core::{
        Actor, ApprovalId, EventEnvelope, EventId, ProjectId, StreamId, Timestamp, WorkspaceId,
    };
    use std::path::PathBuf;

    fn env(payload: EventPayload, ws: WorkspaceId, sequence: u64) -> EventEnvelope {
        EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        }
    }

    #[test]
    fn canonicalize_strips_dot_and_trailing_slash() {
        assert_eq!(canonicalize_in_spirit(Path::new("src/foo/")), "src/foo");
        assert_eq!(
            canonicalize_in_spirit(Path::new("./src/foo/bar.rs")),
            "src/foo/bar.rs"
        );
        assert_eq!(
            canonicalize_in_spirit(Path::new("src/foo/../bar")),
            "src/bar"
        );
        assert_eq!(canonicalize_in_spirit(Path::new("/abs/x/./y")), "/abs/x/y");
        assert_eq!(canonicalize_in_spirit(Path::new("../up")), "../up");
    }

    #[test]
    fn summary_mentions_path_handles_glob_prefix() {
        assert!(summary_mentions_path(
            "Allow write to src/foo/bar.rs",
            "src/foo/bar.rs"
        ));
        // Glob denial; concrete approval path mentioned in summary.
        assert!(summary_mentions_path(
            "Allow write to src/foo/bar.rs",
            "src/foo/*"
        ));
        assert!(summary_mentions_path(
            "Allow src/foo/sub/x.rs",
            "src/foo/**"
        ));
        assert!(!summary_mentions_path("approve unrelated path", "src/foo"));
    }

    #[tokio::test]
    async fn fires_on_three_denials_followed_by_overrides() {
        let ws = WorkspaceId::new();
        let path = PathBuf::from("src/foo/bar.rs");
        let mut events = Vec::new();
        let mut seq = 1u64;
        for _ in 0..3 {
            events.push(env(
                EventPayload::ScopeDenied {
                    workspace_id: ws,
                    path: path.clone(),
                    reason: "outside scope".into(),
                },
                ws,
                seq,
            ));
            seq += 1;
            let approval_id = ApprovalId::new();
            events.push(env(
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id: ws,
                    gate: "scope:write".into(),
                    summary: "Allow write to src/foo/bar.rs".into(),
                },
                ws,
                seq,
            ));
            seq += 1;
            events.push(env(EventPayload::ApprovalGranted { approval_id }, ws, seq));
            seq += 1;
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let cfg = SCOPE_FALSE_POSITIVE_DEFAULTS;
        let detector = ScopeFalsePositiveDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(f.detector_name, ScopeFalsePositiveDetector::NAME);
        assert_eq!(f.detector_version, 1);
        assert_eq!(f.severity, Severity::Notice);
        assert!(f.confidence >= ScopeFalsePositiveDetector::CONFIDENCE_MIN);
        assert!(f.confidence <= ScopeFalsePositiveDetector::CONFIDENCE_MAX);
        assert!(
            f.summary.contains("src/foo/bar.rs"),
            "summary missing path: {}",
            f.summary
        );
        assert!(
            f.summary.contains("ScopeDenied"),
            "summary missing observation kind: {}",
            f.summary
        );
        assert!(
            !f.summary.to_lowercase().contains(" you "),
            "no second-person"
        );
        assert!(f.summary.chars().count() <= 100);
        // FilePath anchor + 3 ScopeDenied + 3 ApprovalGranted anchors.
        assert_eq!(f.evidence.len(), 1 + 3 + 3);
    }

    #[tokio::test]
    async fn quiet_when_no_user_override_follows() {
        let ws = WorkspaceId::new();
        let path = PathBuf::from("src/foo/bar.rs");
        let mut events = Vec::new();
        for seq in 1..=3 {
            events.push(env(
                EventPayload::ScopeDenied {
                    workspace_id: ws,
                    path: path.clone(),
                    reason: "outside scope".into(),
                },
                ws,
                seq,
            ));
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let cfg = SCOPE_FALSE_POSITIVE_DEFAULTS;
        let detector = ScopeFalsePositiveDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert!(findings.is_empty(), "negative case should emit nothing");
    }

    #[tokio::test]
    async fn quiet_when_below_min_occurrences() {
        let ws = WorkspaceId::new();
        let path = PathBuf::from("src/foo/bar.rs");
        let approval_id = ApprovalId::new();
        let events = vec![
            env(
                EventPayload::ScopeDenied {
                    workspace_id: ws,
                    path: path.clone(),
                    reason: "outside scope".into(),
                },
                ws,
                1,
            ),
            env(
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id: ws,
                    gate: "scope:write".into(),
                    summary: "Allow write to src/foo/bar.rs".into(),
                },
                ws,
                2,
            ),
            env(EventPayload::ApprovalGranted { approval_id }, ws, 3),
        ];
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let cfg = SCOPE_FALSE_POSITIVE_DEFAULTS;
        let detector = ScopeFalsePositiveDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert!(
            findings.is_empty(),
            "1 denial < threshold should emit nothing"
        );
    }

    #[tokio::test]
    async fn glob_denial_credited_by_concrete_approval() {
        let ws = WorkspaceId::new();
        // Three denials on a glob; user grants approvals for concrete
        // paths matching the prefix. The detector should still credit
        // the rule.
        let mut events = Vec::new();
        let mut seq = 1u64;
        for concrete in ["src/foo/a.rs", "src/foo/b.rs", "src/foo/c.rs"] {
            events.push(env(
                EventPayload::ScopeDenied {
                    workspace_id: ws,
                    path: PathBuf::from("src/foo/*"),
                    reason: "outside scope".into(),
                },
                ws,
                seq,
            ));
            seq += 1;
            let approval_id = ApprovalId::new();
            events.push(env(
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id: ws,
                    gate: "scope:write".into(),
                    summary: format!("Allow write to {concrete}"),
                },
                ws,
                seq,
            ));
            seq += 1;
            events.push(env(EventPayload::ApprovalGranted { approval_id }, ws, seq));
            seq += 1;
        }
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .workspace(ws)
            .events(events)
            .build();
        let cfg = SCOPE_FALSE_POSITIVE_DEFAULTS;
        let detector = ScopeFalsePositiveDetector;
        #[cfg(feature = "local-ops")]
        let findings = detector.analyze(&input, &cfg, None).await.unwrap();
        #[cfg(not(feature = "local-ops"))]
        let findings = detector.analyze(&input, &cfg).await.unwrap();
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("src/foo/*"));
    }
}
