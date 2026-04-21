//! Typed local-model jobs. Each job is a small structured prompt + structured
//! parse. This keeps the Swift helper dumb (it just runs prompts) and the
//! Rust side honest (inputs/outputs are typed, not free-text).

use crate::protocol::JobKind;
use crate::runner::{FoundationHelper, HelperResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextOptimizerInput {
    pub history: Vec<String>,
    pub focus: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextOptimizerOutput {
    pub summary: String,
    pub key_facts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecapInput {
    pub since: String,
    pub entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecapOutput {
    pub headline: String,
    pub bullets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditClaim {
    pub claim: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditVerdict {
    Supported,
    Contradicted,
    Inconclusive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowSummarizeInput {
    pub row_kind: String,
    pub state: String,
    pub latest_activity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowSummarizeOutput {
    pub line: String,
}

#[async_trait]
pub trait LocalOps: Send + Sync {
    async fn context_optimize(
        &self,
        input: ContextOptimizerInput,
    ) -> HelperResult<ContextOptimizerOutput>;
    async fn recap(&self, input: RecapInput) -> HelperResult<RecapOutput>;
    async fn audit_claim(&self, input: AuditClaim) -> HelperResult<AuditVerdict>;
    async fn summarize_row(&self, input: RowSummarizeInput) -> HelperResult<RowSummarizeOutput>;
}

/// Default `LocalOps` implementation: wraps a `FoundationHelper` and produces
/// typed outputs by constructing deterministic prompts and parsing JSON
/// responses. Non-JSON responses degrade to lossy text reuse.
pub struct FoundationLocalOps<H: FoundationHelper> {
    helper: Arc<H>,
}

impl<H: FoundationHelper> FoundationLocalOps<H> {
    pub fn new(helper: Arc<H>) -> Self {
        Self { helper }
    }
}

fn prompt_context_optimize(input: &ContextOptimizerInput) -> String {
    format!(
        "Summarize this context for the next Claude session.\nFocus: {}\n\nHistory:\n- {}\n\nReturn JSON {{\"summary\":\"...\",\"key_facts\":[\"...\"]}}",
        input.focus,
        input.history.join("\n- ")
    )
}

fn prompt_recap(input: &RecapInput) -> String {
    format!(
        "Write a morning recap for events since {}. Produce a headline + three bullets.\n\nEvents:\n- {}\n\nReturn JSON {{\"headline\":\"...\",\"bullets\":[\"...\"]}}",
        input.since,
        input.entries.join("\n- ")
    )
}

fn prompt_audit(input: &AuditClaim) -> String {
    format!(
        "Given the claim and evidence, return exactly one of: supported, contradicted, inconclusive.\n\nClaim: {}\nEvidence:\n- {}",
        input.claim,
        input.evidence.join("\n- ")
    )
}

fn prompt_summarize(input: &RowSummarizeInput) -> String {
    format!(
        "One-line status for a {} in state {}. {}.",
        input.row_kind,
        input.state,
        input
            .latest_activity
            .as_deref()
            .unwrap_or("No recent activity")
    )
}

#[async_trait]
impl<H: FoundationHelper + 'static> LocalOps for FoundationLocalOps<H> {
    async fn context_optimize(
        &self,
        input: ContextOptimizerInput,
    ) -> HelperResult<ContextOptimizerOutput> {
        let text = self
            .helper
            .generate(JobKind::ContextOptimize, &prompt_context_optimize(&input))
            .await?;
        // Be forgiving: try JSON first, then fall back to text reuse.
        if let Ok(parsed) = serde_json::from_str::<ContextOptimizerOutput>(&text) {
            Ok(parsed)
        } else {
            Ok(ContextOptimizerOutput {
                summary: text,
                key_facts: vec![],
            })
        }
    }

    async fn recap(&self, input: RecapInput) -> HelperResult<RecapOutput> {
        let text = self.helper.generate(JobKind::Recap, &prompt_recap(&input)).await?;
        if let Ok(parsed) = serde_json::from_str::<RecapOutput>(&text) {
            Ok(parsed)
        } else {
            Ok(RecapOutput {
                headline: text.lines().next().unwrap_or("Recap").to_string(),
                bullets: text.lines().skip(1).take(5).map(str::to_string).collect(),
            })
        }
    }

    async fn audit_claim(&self, input: AuditClaim) -> HelperResult<AuditVerdict> {
        let text = self.helper.generate(JobKind::AuditClaim, &prompt_audit(&input)).await?;
        Ok(match text.trim().to_lowercase().as_str() {
            "supported" => AuditVerdict::Supported,
            "contradicted" => AuditVerdict::Contradicted,
            _ => AuditVerdict::Inconclusive,
        })
    }

    async fn summarize_row(&self, input: RowSummarizeInput) -> HelperResult<RowSummarizeOutput> {
        let text = self
            .helper
            .generate(JobKind::SummarizeRow, &prompt_summarize(&input))
            .await?;
        Ok(RowSummarizeOutput {
            line: text.lines().next().unwrap_or(&text).to_string(),
        })
    }
}
