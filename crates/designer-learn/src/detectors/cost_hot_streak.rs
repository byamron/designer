//! `cost_hot_streak` — Designer-unique detector.
//!
//! Catches a token-spend outlier on a recurring task class against the
//! project's rolling baseline. Output kind (Phase B):
//! `model-tier-suggestion` ("this class of task is expensive — consider
//! a cheaper model").
//!
//! Forge has no analog — it never sees `CostRecorded` events. Designer
//! owns the cost-tracker stream natively, so this detector always runs
//! (no [`crate::FORGE_OVERLAP_DETECTORS`] entry).
//!
//! ## Algorithm
//!
//! Streaming pass over `input.events` with a bounded rolling window
//! capped at [`COST_HOT_STREAK_WINDOW`] entries. For each
//! [`EventPayload::CostRecorded`] event, derive its task class, compute
//! rolling p90 (nearest-rank), and emit a [`Finding`] when **all** of:
//! the window has at least [`COST_HOT_STREAK_MIN_BASELINE`] entries; the
//! same class has appeared at least
//! [`COST_HOT_STREAK_MIN_CLASS_OCCURRENCES`] times in the window; and the
//! new cost exceeds [`COST_HOT_STREAK_RATIO`] × p90.
//!
//! ## Task class
//!
//! A two-tuple of [`BodyTier`] × [`ToolTier`] derived from the most
//! recent [`EventPayload::MessagePosted`] preceding the `CostRecorded`,
//! within [`CLASSIFY_LOOKBACK_LIMIT`] events. Costs without a preceding
//! message are uncategorized — they still feed the rolling baseline but
//! never trigger.
//!
//! Tool-churn is a proxy for the "tool_use count tier" called out in the
//! roadmap: typed tool-call events don't yet have an [`EventPayload`]
//! variant (see `session_input.rs` module note), so this detector counts
//! intermediate non-cost, non-message events. The detector's
//! [`CostHotStreakDetector::VERSION`] bumps when typed tool events land;
//! old findings stay attached to the prior version per CONTRIBUTING §3.

use crate::{Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::{Anchor, EventEnvelope, EventPayload, Finding, FindingId, Severity};
use std::collections::VecDeque;
use std::fmt;

pub(crate) const COST_HOT_STREAK_WINDOW: usize = 50;
pub(crate) const COST_HOT_STREAK_MIN_BASELINE: usize = 10;
pub(crate) const COST_HOT_STREAK_MIN_CLASS_OCCURRENCES: usize = 3;
pub(crate) const COST_HOT_STREAK_RATIO: f64 = 1.5;
pub(crate) const CLASSIFY_LOOKBACK_LIMIT: usize = 100;

#[derive(Debug, Default, Clone, Copy)]
pub struct CostHotStreakDetector;

impl CostHotStreakDetector {
    pub const NAME: &'static str = "cost_hot_streak";
    pub const VERSION: u32 = 1;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BodyTier {
    Short,  // <200 chars
    Medium, // 200..=1000 chars
    Long,   // >1000 chars
}

impl BodyTier {
    fn from_chars(n: usize) -> Self {
        if n < 200 {
            Self::Short
        } else if n <= 1000 {
            Self::Medium
        } else {
            Self::Long
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Short => "short",
            Self::Medium => "medium",
            Self::Long => "long",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolTier {
    Low,    // 0..=2 intermediate events
    Medium, // 3..=7
    High,   // 8+
}

impl ToolTier {
    fn from_count(churn: usize) -> Self {
        if churn <= 2 {
            Self::Low
        } else if churn <= 7 {
            Self::Medium
        } else {
            Self::High
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TaskClass {
    body: BodyTier,
    tool: ToolTier,
}

impl fmt::Display for TaskClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.body.as_str(), self.tool.as_str())
    }
}

#[derive(Debug, Clone, Copy)]
struct WindowEntry {
    cents: u64,
    class: Option<TaskClass>,
}

/// Walk backwards from `idx` looking for the most recent `MessagePosted`
/// within the lookback budget. `None` when no preceding message exists
/// in the window.
fn classify_at(events: &[EventEnvelope], idx: usize) -> Option<TaskClass> {
    let mut churn = 0usize;
    let mut steps = 0usize;
    let mut i = idx;
    while i > 0 && steps < CLASSIFY_LOOKBACK_LIMIT {
        i -= 1;
        steps += 1;
        match &events[i].payload {
            EventPayload::MessagePosted { body, .. } => {
                return Some(TaskClass {
                    body: BodyTier::from_chars(body.chars().count()),
                    tool: ToolTier::from_count(churn),
                });
            }
            // CostRecorded events are observations, not work — neither a
            // boundary nor part of the churn count, so multiple costs may
            // share a single task class.
            EventPayload::CostRecorded { .. } => {}
            _ => churn += 1,
        }
    }
    None
}

/// Nearest-rank p90 over the window's `cents` values. `None` when empty.
fn p90_cents(window: &VecDeque<WindowEntry>) -> Option<f64> {
    if window.is_empty() {
        return None;
    }
    let mut sorted: Vec<u64> = window.iter().map(|e| e.cents).collect();
    sorted.sort_unstable();
    let n = sorted.len();
    let rank = ((0.90_f64 * n as f64).ceil() as usize)
        .saturating_sub(1)
        .min(n - 1);
    Some(sorted[rank] as f64)
}

fn confidence_for_ratio(ratio: f64) -> f32 {
    let raw = 0.4 + ((ratio - COST_HOT_STREAK_RATIO) / COST_HOT_STREAK_RATIO) * 0.4;
    raw.clamp(0.4, 0.8) as f32
}

fn class_count(window: &VecDeque<WindowEntry>, class: TaskClass) -> usize {
    window.iter().filter(|e| e.class == Some(class)).count()
}

fn build_finding(
    input: &SessionAnalysisInput,
    env: &EventEnvelope,
    cents: u64,
    class: TaskClass,
    p90: f64,
    window_len: usize,
    severity: Severity,
) -> Finding {
    let cost = cents as f64;
    let ratio = cost / p90;
    let summary = format!(
        "Task class '{}' cost ${:.2}, {:.1}× rolling p90 of ${:.2} over last {} events",
        class,
        cost / 100.0,
        ratio,
        p90 / 100.0,
        window_len,
    );

    let trigger_key = format!("trigger:{}", env.id);
    let class_key = format!("class:{}", class);
    let p90_key = format!("p90_cents:{}", p90 as u64);
    let cost_key = format!("cost_cents:{}", cents);
    let digest_keys = [
        trigger_key.as_str(),
        class_key.as_str(),
        p90_key.as_str(),
        cost_key.as_str(),
    ];

    Finding {
        id: FindingId::new(),
        detector_name: CostHotStreakDetector::NAME.to_string(),
        detector_version: CostHotStreakDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: env.timestamp,
        severity,
        confidence: confidence_for_ratio(ratio),
        summary,
        // `Anchor::ToolCall` is the closest fit per CONTRIBUTING — there
        // is no generic "event in stream" variant, and adding one is an
        // ADR-level decision. The renderer reads `tool_name` as a label.
        evidence: vec![Anchor::ToolCall {
            event_id: env.id.to_string(),
            tool_name: "cost_recorded".into(),
        }],
        suggested_action: None,
        window_digest: crate::window_digest(CostHotStreakDetector::NAME, &digest_keys),
    }
}

/// Returns `Some(Finding)` when the new cost trips every gate, else
/// `None`. Pure read of the existing window — caller pushes the new
/// entry afterwards regardless.
fn try_emit(
    input: &SessionAnalysisInput,
    env: &EventEnvelope,
    cents: u64,
    class: Option<TaskClass>,
    window: &VecDeque<WindowEntry>,
    severity: Severity,
) -> Option<Finding> {
    let class = class?;
    if window.len() < COST_HOT_STREAK_MIN_BASELINE {
        return None;
    }
    if class_count(window, class) < COST_HOT_STREAK_MIN_CLASS_OCCURRENCES {
        return None;
    }
    let p90 = p90_cents(window)?;
    if p90 <= 0.0 || (cents as f64) <= COST_HOT_STREAK_RATIO * p90 {
        return None;
    }
    Some(build_finding(
        input,
        env,
        cents,
        class,
        p90,
        window.len(),
        severity,
    ))
}

fn run(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
) -> Result<Vec<Finding>, DetectorError> {
    if !config.enabled {
        return Ok(Vec::new());
    }

    let severity = config.impact_override.unwrap_or(Severity::Info);
    let mut window: VecDeque<WindowEntry> = VecDeque::with_capacity(COST_HOT_STREAK_WINDOW);
    let mut findings: Vec<Finding> = Vec::new();

    for (idx, env) in input.events.iter().enumerate() {
        let EventPayload::CostRecorded { dollars_cents, .. } = &env.payload else {
            continue;
        };
        let cents = *dollars_cents;
        let class = classify_at(&input.events, idx);

        if let Some(finding) = try_emit(input, env, cents, class, &window, severity) {
            findings.push(finding);
        }

        if window.len() >= COST_HOT_STREAK_WINDOW {
            window.pop_front();
        }
        window.push_back(WindowEntry { cents, class });
    }

    Ok(findings)
}

#[async_trait]
impl Detector for CostHotStreakDetector {
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
        run(input, config)
    }

    #[cfg(not(feature = "local-ops"))]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError> {
        run(input, config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn message(seq: u64, ws: WorkspaceId, body_len: usize) -> EventEnvelope {
        env(
            seq,
            EventPayload::MessagePosted {
                workspace_id: ws,
                author: Actor::user(),
                body: "x".repeat(body_len),
            },
            ws,
        )
    }

    fn cost(seq: u64, ws: WorkspaceId, cents: u64) -> EventEnvelope {
        env(
            seq,
            EventPayload::CostRecorded {
                workspace_id: ws,
                tokens_input: 1000,
                tokens_output: 500,
                dollars_cents: cents,
            },
            ws,
        )
    }

    #[test]
    fn body_tier_buckets() {
        assert_eq!(BodyTier::from_chars(0), BodyTier::Short);
        assert_eq!(BodyTier::from_chars(199), BodyTier::Short);
        assert_eq!(BodyTier::from_chars(200), BodyTier::Medium);
        assert_eq!(BodyTier::from_chars(1000), BodyTier::Medium);
        assert_eq!(BodyTier::from_chars(1001), BodyTier::Long);
    }

    #[test]
    fn tool_tier_buckets() {
        assert_eq!(ToolTier::from_count(0), ToolTier::Low);
        assert_eq!(ToolTier::from_count(2), ToolTier::Low);
        assert_eq!(ToolTier::from_count(3), ToolTier::Medium);
        assert_eq!(ToolTier::from_count(7), ToolTier::Medium);
        assert_eq!(ToolTier::from_count(8), ToolTier::High);
    }

    #[test]
    fn task_class_displays_as_body_colon_tool() {
        let c = TaskClass {
            body: BodyTier::Long,
            tool: ToolTier::Low,
        };
        assert_eq!(c.to_string(), "long:low");
    }

    #[test]
    fn confidence_clamps_to_band() {
        assert!((confidence_for_ratio(1.5) - 0.4).abs() < 1e-6);
        assert!((confidence_for_ratio(3.0) - 0.8).abs() < 1e-6);
        // ratio above the upper end clamps to 0.8.
        assert!((confidence_for_ratio(10.0) - 0.8).abs() < 1e-6);
        // ratio below the trigger floor clamps to 0.4 (defensive — `try_emit`
        // never calls into here for sub-threshold ratios).
        assert!((confidence_for_ratio(1.0) - 0.4).abs() < 1e-6);
    }

    #[test]
    fn p90_nearest_rank_picks_top_decile() {
        let mut win: VecDeque<WindowEntry> = VecDeque::new();
        for c in 1..=10u64 {
            win.push_back(WindowEntry {
                cents: c,
                class: None,
            });
        }
        // ceil(0.9 * 10) - 1 = 8 → 9th-smallest = 9.
        assert_eq!(p90_cents(&win), Some(9.0));
    }

    #[tokio::test]
    async fn no_findings_below_baseline_size() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..5 {
            events.push(message(i * 2 + 1, ws, 1500));
            events.push(cost(i * 2 + 2, ws, 100));
        }
        events.push(message(11, ws, 1500));
        events.push(cost(12, ws, 1000)); // huge spike, but no baseline yet

        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let findings = run(&input, &DetectorConfig::default()).unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn unclassified_cost_never_triggers() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        // Cost with no preceding MessagePosted at all.
        let events = vec![cost(1, ws, 250)];
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let findings = run(&input, &DetectorConfig::default()).unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn disabled_config_emits_nothing() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        for i in 0..15 {
            events.push(message(i * 2 + 1, ws, 1500));
            events.push(cost(i * 2 + 2, ws, 100));
        }
        events.push(message(31, ws, 1500));
        events.push(cost(32, ws, 1000));

        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let cfg = DetectorConfig {
            enabled: false,
            ..DetectorConfig::default()
        };
        let findings = run(&input, &cfg).unwrap();
        assert!(findings.is_empty());
    }

    #[tokio::test]
    async fn analyze_does_not_panic_past_window_cap() {
        // Eviction-path smoke test — the detector's deque is private,
        // so we just push more events than the cap and check the run
        // completes cleanly.
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        let n = COST_HOT_STREAK_WINDOW + 20;
        let mut seq = 0u64;
        for _ in 0..n {
            seq += 1;
            events.push(message(seq, ws, 1500));
            seq += 1;
            events.push(cost(seq, ws, 100));
        }
        let input = SessionAnalysisInput::builder(project)
            .workspace(ws)
            .events(events)
            .build();
        let _ = run(&input, &DetectorConfig::default()).unwrap();
    }
}
