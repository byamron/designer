//! Shared test mocks for the desktop crate. Cross-module tests rely on a
//! single source of truth for these doubles so refactors can rename a method
//! once and not chase inline copies through every `tests` module.
//!
//! Today this hosts the counting `LocalOps` mock; future mocks (counting
//! `PermissionHandler`, fake `Updater`, etc.) belong here too rather than as
//! per-test inlines.

use async_trait::async_trait;
use designer_local_models::{
    AuditClaim, AuditVerdict, ContextOptimizerInput, ContextOptimizerOutput, HelperResult,
    LocalOps, RecapInput, RecapOutput, RowSummarizeInput, RowSummarizeOutput,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Counting `LocalOps` mock: every helper method is a no-op except
/// `summarize_row`, which increments a shared counter so callers can assert
/// "exactly N helper round-trips for this code path." Returns a fixed
/// `"summary line"` string so artifact-level assertions can match on it.
pub(crate) struct CountingOps {
    pub summarize_calls: Arc<AtomicUsize>,
    pub summary_line: String,
}

impl CountingOps {
    pub fn new() -> (Arc<Self>, Arc<AtomicUsize>) {
        let counter = Arc::new(AtomicUsize::new(0));
        let ops = Arc::new(Self {
            summarize_calls: counter.clone(),
            summary_line: "summary line".into(),
        });
        (ops, counter)
    }
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
            line: self.summary_line.clone(),
        })
    }
}
