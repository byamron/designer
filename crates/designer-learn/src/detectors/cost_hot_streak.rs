//! `cost_hot_streak` — Designer-unique detector.
//!
//! Catches a token-spend outlier on a recurring task class against the
//! project's rolling baseline. Output kind (Phase B): `model-tier-suggestion`
//! ("this class of task is expensive — consider a cheaper model").
//!
//! ## Why Designer-unique
//!
//! Forge has no analog: it never sees `CostRecorded` events. Designer owns
//! the cost-tracker stream natively, so this detector always runs (no
//! [`crate::FORGE_OVERLAP_DETECTORS`] entry).
//!
//! ## Algorithm
//!
//! Streaming pass over `input.events`:
//!
//! 1. For each [`EventPayload::CostRecorded`] event, derive its **task
//!    class** from the sibling event surface (see below).
//! 2. Compute the rolling p90 of `dollars_cents` over the
//!    [`COST_HOT_STREAK_WINDOW`]-bounded prior window (nearest-rank).
//! 3. Emit a [`Finding`] when **all** of the following hold:
//!    - the window has at least [`COST_HOT_STREAK_MIN_BASELINE`] entries
//!      (otherwise the p90 is meaningless);
//!    - the same task class has appeared at least
//!      [`COST_HOT_STREAK_MIN_CLASS_OCCURRENCES`] times in the window
//!      (otherwise this is a one-off, not a hot streak);
//!    - the new cost exceeds [`COST_HOT_STREAK_RATIO`] × p90.
//! 4. Push the new event into the rolling window, evicting the oldest
//!    entry when the cap is hit. State is bounded by `COST_HOT_STREAK_WINDOW`
//!    entries; nothing else is retained across iterations.
//!
//! ## Task class
//!
//! "Task class" is a deterministic two-tuple derived from the most recent
//! [`EventPayload::MessagePosted`] preceding the `CostRecorded` event:
//!
//! - **Body length tier** of that message body, in `chars()`:
//!   `short` (<200), `medium` (200–1000), `long` (>1000).
//! - **Tool-churn tier** = number of intermediate non-cost, non-message
//!   events between that message and this `CostRecorded`:
//!   `low` (0–2), `medium` (3–7), `high` (8+).
//!
//! Encoded as `<body_tier>:<tool_tier>` (e.g., `long:medium`). The
//! tool-churn tier is a proxy for the "tool_use count tier" called out in
//! the roadmap: typed tool-call events don't yet have an
//! [`EventPayload`] variant (see `session_input.rs` module note), so this
//! detector counts intermediate non-cost, non-message events — bash and
//! file edits show up here once the typed events land. The detector's
//! [`CostHotStreakDetector::VERSION`] will bump when that happens; old
//! findings stay attached to the prior version per CONTRIBUTING §3.
//!
//! Lookback for the preceding `MessagePosted` is capped at
//! [`CLASSIFY_LOOKBACK_LIMIT`] events to keep classification O(1)
//! per event in the worst case. A `CostRecorded` with no
//! `MessagePosted` in that window is tagged `unclassified` — it still
//! contributes to the rolling baseline but is never the trigger.
//!
//! ## Severity
//!
//! [`Severity::Info`]. Model-tier hints are informational, not
//! safety-perimeter signal — per CONTRIBUTING §"Severity calibration".
//!
//! ## Confidence
//!
//! Linear in `cost / p90` ratio above the trigger threshold, clamped to
//! `[0.4, 0.8]`. Ratio of 1.5 (the trigger floor) → 0.4. Ratio of 3.0+ → 0.8.

use crate::{Detector, DetectorConfig, DetectorError, SessionAnalysisInput};
use async_trait::async_trait;
use designer_core::{Anchor, EventEnvelope, EventPayload, Finding, FindingId, Severity};
use std::collections::VecDeque;

/// Hard cap on the rolling window. State stays bounded regardless of
/// how many events are streamed through.
pub const COST_HOT_STREAK_WINDOW: usize = 50;

/// Minimum entries in the rolling window before any emission.
/// Below this, the p90 is dominated by the first few samples and
/// flagging is noise.
pub const COST_HOT_STREAK_MIN_BASELINE: usize = 10;

/// Minimum prior occurrences of the same task class in the window
/// before the detector treats it as recurring.
pub const COST_HOT_STREAK_MIN_CLASS_OCCURRENCES: usize = 3;

/// Trigger ratio over rolling p90.
pub const COST_HOT_STREAK_RATIO: f64 = 1.5;

/// Maximum events the classifier walks back to find a preceding
/// `MessagePosted`. Caps worst-case O(N) classification at O(K) per
/// `CostRecorded`.
pub const CLASSIFY_LOOKBACK_LIMIT: usize = 100;

const CLASS_UNCLASSIFIED: &str = "unclassified";

/// The detector itself. Stateless across `analyze` calls — the rolling
/// window is local to each invocation, scoped to `input.events`.
#[derive(Debug, Default, Clone, Copy)]
pub struct CostHotStreakDetector;

impl CostHotStreakDetector {
    pub const NAME: &'static str = "cost_hot_streak";
    pub const VERSION: u32 = 1;
}

#[derive(Debug, Clone)]
struct WindowEntry {
    cents: u64,
    class: String,
}

fn body_tier(char_len: usize) -> &'static str {
    if char_len < 200 {
        "short"
    } else if char_len <= 1000 {
        "medium"
    } else {
        "long"
    }
}

fn tool_tier(churn: usize) -> &'static str {
    if churn <= 2 {
        "low"
    } else if churn <= 7 {
        "medium"
    } else {
        "high"
    }
}

/// Walk backwards from `idx` looking for the most recent `MessagePosted`.
/// Returns the task class, or `None` when no preceding message exists
/// within `CLASSIFY_LOOKBACK_LIMIT` events.
fn classify_at(events: &[EventEnvelope], idx: usize) -> Option<String> {
    let mut churn = 0usize;
    let mut steps = 0usize;
    let mut i = idx;
    while i > 0 && steps < CLASSIFY_LOOKBACK_LIMIT {
        i -= 1;
        steps += 1;
        match &events[i].payload {
            EventPayload::MessagePosted { body, .. } => {
                let body_t = body_tier(body.chars().count());
                let tool_t = tool_tier(churn);
                return Some(format!("{}:{}", body_t, tool_t));
            }
            // CostRecorded events don't count toward churn (they're
            // observations, not work) and don't act as a boundary —
            // multiple costs may share one task class.
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

fn run(
    input: &SessionAnalysisInput,
    config: &DetectorConfig,
) -> Result<Vec<Finding>, DetectorError> {
    if !config.enabled {
        return Ok(Vec::new());
    }

    let mut window: VecDeque<WindowEntry> = VecDeque::with_capacity(COST_HOT_STREAK_WINDOW);
    let mut findings: Vec<Finding> = Vec::new();

    for (idx, env) in input.events.iter().enumerate() {
        let EventPayload::CostRecorded { dollars_cents, .. } = &env.payload else {
            continue;
        };

        let class =
            classify_at(&input.events, idx).unwrap_or_else(|| CLASS_UNCLASSIFIED.to_string());
        let is_classified = class != CLASS_UNCLASSIFIED;

        if is_classified && window.len() >= COST_HOT_STREAK_MIN_BASELINE {
            let class_count = window.iter().filter(|e| e.class == class).count();
            if class_count >= COST_HOT_STREAK_MIN_CLASS_OCCURRENCES {
                if let Some(p90) = p90_cents(&window) {
                    let cost = *dollars_cents as f64;
                    if p90 > 0.0 && cost > COST_HOT_STREAK_RATIO * p90 {
                        let ratio = cost / p90;
                        let confidence = confidence_for_ratio(ratio);
                        let summary = format!(
                            "Task class '{}' cost ${:.2}, {:.1}× rolling p90 of ${:.2} over last {} events",
                            class,
                            cost / 100.0,
                            ratio,
                            p90 / 100.0,
                            window.len(),
                        );

                        let trigger_key = format!("trigger:{}", env.id);
                        let class_key = format!("class:{}", class);
                        let p90_key = format!("p90_cents:{}", p90 as u64);
                        let cost_key = format!("cost_cents:{}", *dollars_cents);
                        let digest_keys = [
                            trigger_key.as_str(),
                            class_key.as_str(),
                            p90_key.as_str(),
                            cost_key.as_str(),
                        ];
                        let window_digest =
                            crate::window_digest(CostHotStreakDetector::NAME, &digest_keys);

                        let evidence = vec![Anchor::ToolCall {
                            event_id: env.id.to_string(),
                            tool_name: "cost_recorded".into(),
                        }];

                        let severity = config.impact_override.unwrap_or(Severity::Info);

                        findings.push(Finding {
                            id: FindingId::new(),
                            detector_name: CostHotStreakDetector::NAME.to_string(),
                            detector_version: CostHotStreakDetector::VERSION,
                            project_id: input.project_id,
                            workspace_id: input.workspace_id,
                            timestamp: env.timestamp,
                            severity,
                            confidence,
                            summary,
                            evidence,
                            suggested_action: None,
                            window_digest,
                        });
                    }
                }
            }
        }

        // Always push: classified or not, the cost contributes to the
        // baseline. Window stays bounded by `COST_HOT_STREAK_WINDOW`.
        if window.len() >= COST_HOT_STREAK_WINDOW {
            window.pop_front();
        }
        window.push_back(WindowEntry {
            cents: *dollars_cents,
            class,
        });
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
        assert_eq!(body_tier(0), "short");
        assert_eq!(body_tier(199), "short");
        assert_eq!(body_tier(200), "medium");
        assert_eq!(body_tier(1000), "medium");
        assert_eq!(body_tier(1001), "long");
    }

    #[test]
    fn tool_tier_buckets() {
        assert_eq!(tool_tier(0), "low");
        assert_eq!(tool_tier(2), "low");
        assert_eq!(tool_tier(3), "medium");
        assert_eq!(tool_tier(7), "medium");
        assert_eq!(tool_tier(8), "high");
    }

    #[test]
    fn confidence_clamps_to_band() {
        assert!((confidence_for_ratio(1.5) - 0.4).abs() < 1e-6);
        assert!((confidence_for_ratio(3.0) - 0.8).abs() < 1e-6);
        assert!((confidence_for_ratio(10.0) - 0.8).abs() < 1e-6); // clamp
        assert!((confidence_for_ratio(1.0) - 0.4).abs() < 1e-6); // floor (below threshold but called anyway)
    }

    #[test]
    fn p90_nearest_rank_picks_top_decile() {
        let mut win: VecDeque<WindowEntry> = VecDeque::new();
        for c in 1..=10u64 {
            win.push_back(WindowEntry {
                cents: c,
                class: "x".into(),
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
        // 5 (message, cost) pairs — below MIN_BASELINE.
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
    async fn classify_handles_no_preceding_message() {
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
    async fn rolling_window_stays_bounded() {
        let project = ProjectId::new();
        let ws = WorkspaceId::new();
        let mut events = Vec::new();
        // Push more events than the window cap; the detector must not
        // grow state past COST_HOT_STREAK_WINDOW. We can't observe the
        // deque directly, so this just exercises the eviction path.
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
