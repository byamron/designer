//! Phase 21.A1.2 — proposal primitives.
//!
//! A `Proposal` is what a [`crate::EventPayload::ProposalEmitted`] event
//! carries: a single recommendation synthesized from one or more
//! [`crate::Finding`]s. Findings are evidence; proposals are the unit
//! the user thumbs, accepts, edits, dismisses, or snoozes.
//!
//! Phase 21.A1.2 ships the data shape and the `Hint` kind only — the
//! richer kinds (`ClaudeMdEntry`, `Hook`, `RuleExtraction`, etc.)
//! exist in the enum so the wire shape is stable, but the synthesizer
//! emits `Hint` exclusively. Phase B replaces the stub with real LLM
//! synthesis and turns on the remaining kinds.
//!
//! Proposals are immutable once recorded; their open / accepted /
//! dismissed / snoozed status is derived from
//! [`crate::EventPayload::ProposalResolved`] events — last-write-wins
//! per `proposal_id`.

use crate::finding::Severity;
use crate::ids::{FindingId, ProjectId, ProposalId, WorkspaceId};
use crate::time::Timestamp;
use serde::{Deserialize, Serialize};

/// A single recommendation synthesized from one or more findings.
///
/// `summary` is end-user-facing prose; the source `Finding.summary`
/// lines are *evidence text* rendered behind a "from N observations"
/// disclosure. Phase 21.A1.2's stub synthesizer copies the
/// highest-severity source-finding's summary verbatim — Phase B
/// replaces this with a synthesized headline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    pub id: ProposalId,
    pub project_id: ProjectId,
    /// `None` for project-wide proposals (e.g., aggregated across
    /// workspaces). Mirrors `Finding::workspace_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
    /// Findings that produced this proposal. Order is meaningful — the
    /// first id is the highest-severity source ("primary evidence").
    /// Renderers expand these as the evidence drawer.
    pub source_findings: Vec<FindingId>,
    pub title: String,
    pub summary: String,
    pub severity: Severity,
    pub kind: ProposalKind,
    /// Reserved for kinds that ship a concrete diff. Phase 21.A1.2's
    /// stub leaves this `None`; Phase B's synthesizer populates it
    /// for kinds like `ClaudeMdEntry` / `Hook` / `RuleExtraction`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_diff: Option<String>,
    pub created_at: Timestamp,
}

/// The kinds a proposal can be. Mirrors the §"Proposal kinds" table in
/// `core-docs/roadmap.md`. Phase 21.A1.2 only emits [`ProposalKind::Hint`];
/// the other variants are reserved here so the wire shape doesn't
/// rev when Phase B turns them on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalKind {
    /// "Just a hint" — informational; no auto-edit. Phase 21.A1.2 emits
    /// only this kind. Roadmap kinds without a dedicated reviewer
    /// treatment fall back to this one until Phase B wires them up.
    Hint,
    ClaudeMdEntry,
    FeedbackRule,
    Rule,
    Hook,
    SkillCandidate,
    AgentCandidate,
    ReferenceDoc,
    RuleExtraction,
    Demotion,
    RemovalCandidate,
    ConflictResolution,
    /// Safety-gated. Reviewer must re-type the path to confirm. Phase B.
    ScopeRuleRelaxation,
    /// Safety-gated. Reviewer must dry-run before accepting. Phase B.
    AutoApproveHook,
    ContextTrim,
    ContextRestructuring,
    ModelTierSuggestion,
    TeamCompositionChange,
    RoutingPolicyTune,
    PromptTemplate,
}

/// How the user resolved a proposal. Last-write-wins per
/// `proposal_id` so a snoozed-then-dismissed proposal lands on
/// `Dismissed`. `Snoozed` carries an optional `until` so the snooze
/// surface can compute when to resurface; `None` means the user
/// snoozed without a deadline ("not now").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposalResolution {
    Accepted,
    Edited {
        /// Optional inline-edited diff. The synthesizer's
        /// `suggested_diff` is the baseline; this carries the user's
        /// finalized version. Phase 21.A1.2 does not interpret it
        /// (the `Hint` kind has no diff); the field exists so the
        /// wire shape doesn't rev when Phase B turns on the editable
        /// kinds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
    },
    Dismissed {
        /// Optional free-text reason ("low impact", "wrong scope").
        /// Drives the calibration loop's impact-deflation rule once
        /// Phase B is online.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Snoozed {
        /// RFC3339 timestamp when the proposal should resurface. `None`
        /// means "snooze indefinitely until the user opens the archive
        /// and re-engages."
        #[serde(default, skip_serializing_if = "Option::is_none")]
        until: Option<String>,
    },
}

/// Open / accepted / dismissed / snoozed projection of a proposal.
/// Derived from the latest `ProposalResolved` event for each
/// `proposal_id`; absent events mean `Open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Open,
    Accepted,
    Dismissed,
    Snoozed,
}

impl ProposalResolution {
    /// Cheap discriminant for the projection. `kind()` makes the
    /// `Edited` / `Dismissed` / `Snoozed` distinctions collapse to a
    /// single tier the surface filters on.
    pub fn status(&self) -> ProposalStatus {
        match self {
            ProposalResolution::Accepted => ProposalStatus::Accepted,
            ProposalResolution::Edited { .. } => ProposalStatus::Accepted,
            ProposalResolution::Dismissed { .. } => ProposalStatus::Dismissed,
            ProposalResolution::Snoozed { .. } => ProposalStatus::Snoozed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proposal_serde_round_trip() {
        let p = Proposal {
            id: ProposalId::new(),
            project_id: ProjectId::new(),
            workspace_id: None,
            source_findings: vec![FindingId::new(), FindingId::new()],
            title: "Repeated correction".into(),
            summary: "User corrected the same pattern 3x.".into(),
            severity: Severity::Notice,
            kind: ProposalKind::Hint,
            suggested_diff: None,
            created_at: Timestamp::UNIX_EPOCH,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: Proposal = serde_json::from_str(&json).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn proposal_kind_serde_is_snake_case() {
        let json = serde_json::to_string(&ProposalKind::Hint).unwrap();
        assert_eq!(json, "\"hint\"");
        let back: ProposalKind = serde_json::from_str("\"claude_md_entry\"").unwrap();
        assert_eq!(back, ProposalKind::ClaudeMdEntry);
    }

    #[test]
    fn resolution_status_collapses_edited_into_accepted() {
        assert_eq!(
            ProposalResolution::Accepted.status(),
            ProposalStatus::Accepted
        );
        assert_eq!(
            ProposalResolution::Edited { diff: None }.status(),
            ProposalStatus::Accepted
        );
        assert_eq!(
            ProposalResolution::Dismissed { reason: None }.status(),
            ProposalStatus::Dismissed
        );
        assert_eq!(
            ProposalResolution::Snoozed { until: None }.status(),
            ProposalStatus::Snoozed
        );
    }

    #[test]
    fn resolution_serde_carries_inner_payload() {
        let r = ProposalResolution::Dismissed {
            reason: Some("low impact".into()),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"low impact\""));
        let back: ProposalResolution = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }
}
