//! Shared test mocks for the desktop crate. Cross-module tests reach for
//! these doubles instead of redefining inline copies in every `tests` module.

use async_trait::async_trait;
use designer_local_models::{
    AuditClaim, AuditVerdict, ContextOptimizerInput, ContextOptimizerOutput, HelperResult,
    LocalOps, RecapInput, RecapOutput, RowSummarizeInput, RowSummarizeOutput,
};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Counting `LocalOps` mock: every helper method is a no-op except
/// `summarize_row`, which increments `summarize_calls` so callers can assert
/// "exactly N helper round-trips for this code path." Returns a fixed
/// `"summary line"` string so artifact-level assertions can match on it.
#[derive(Default)]
pub(crate) struct CountingOps {
    pub summarize_calls: AtomicUsize,
}

#[async_trait]
impl LocalOps for CountingOps {
    async fn context_optimize(
        &self,
        _input: ContextOptimizerInput,
    ) -> HelperResult<ContextOptimizerOutput> {
        Ok(ContextOptimizerOutput {
            summary: String::new(),
            key_facts: vec![],
        })
    }
    async fn recap(&self, _input: RecapInput) -> HelperResult<RecapOutput> {
        Ok(RecapOutput {
            headline: String::new(),
            bullets: vec![],
        })
    }
    async fn audit_claim(&self, _input: AuditClaim) -> HelperResult<AuditVerdict> {
        Ok(AuditVerdict::Inconclusive)
    }
    async fn summarize_row(&self, _input: RowSummarizeInput) -> HelperResult<RowSummarizeOutput> {
        self.summarize_calls.fetch_add(1, Ordering::SeqCst);
        Ok(RowSummarizeOutput {
            line: "summary line".into(),
        })
    }
}
