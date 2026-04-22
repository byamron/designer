use async_trait::async_trait;
use designer_local_models::{
    AuditClaim, AuditVerdict, ContextOptimizerInput, FoundationHelper, FoundationLocalOps,
    HelperResult, JobKind, LocalOps, NullHelper, RecapInput,
};
use std::sync::Arc;

/// Helper that returns a fixed text regardless of prompt. Used to verify
/// `FoundationLocalOps` parsing without depending on real-model behavior.
struct FixedHelper(&'static str);

#[async_trait]
impl FoundationHelper for FixedHelper {
    async fn ping(&self) -> HelperResult<String> {
        Ok("fixed".into())
    }
    async fn generate(&self, _job: JobKind, _prompt: &str) -> HelperResult<String> {
        Ok(self.0.into())
    }
}

#[tokio::test]
async fn null_helper_produces_deterministic_fallback() {
    let ops = FoundationLocalOps::new(Arc::new(NullHelper::default()));
    let out = ops
        .context_optimize(ContextOptimizerInput {
            history: vec!["ran tests".into(), "fixed bug".into()],
            focus: "next step".into(),
        })
        .await
        .unwrap();
    assert!(out.summary.contains("unavailable"));
}

#[tokio::test]
async fn audit_parses_known_verdicts() {
    // We can't inject a specific response with the NullHelper, but we can
    // verify the wrapper classifies responses; with the null fallback the
    // verdict will be Inconclusive unless the text starts with a verdict word.
    let ops = FoundationLocalOps::new(Arc::new(NullHelper::default()));
    let verdict = ops
        .audit_claim(AuditClaim {
            claim: "tests pass".into(),
            evidence: vec!["ran cargo test".into()],
        })
        .await
        .unwrap();
    assert_eq!(verdict, AuditVerdict::Inconclusive);
}

#[tokio::test]
async fn audit_trims_trailing_punctuation_and_sentence_wrap() {
    // "Supported." must map to Supported, not Inconclusive. Covers the bug
    // the first-pass implementation had where it only matched the bare word.
    let ops = FoundationLocalOps::new(Arc::new(FixedHelper("Supported.")));
    let v = ops
        .audit_claim(AuditClaim {
            claim: "x".into(),
            evidence: vec![],
        })
        .await
        .unwrap();
    assert_eq!(v, AuditVerdict::Supported);

    let ops2 = FoundationLocalOps::new(Arc::new(FixedHelper("contradicted by evidence")));
    let v2 = ops2
        .audit_claim(AuditClaim {
            claim: "y".into(),
            evidence: vec![],
        })
        .await
        .unwrap();
    assert_eq!(v2, AuditVerdict::Contradicted);

    let ops3 = FoundationLocalOps::new(Arc::new(FixedHelper("maybe")));
    let v3 = ops3
        .audit_claim(AuditClaim {
            claim: "z".into(),
            evidence: vec![],
        })
        .await
        .unwrap();
    assert_eq!(v3, AuditVerdict::Inconclusive);
}

#[tokio::test]
async fn recap_never_panics_on_empty_entries() {
    let ops = FoundationLocalOps::new(Arc::new(NullHelper::default()));
    let out = ops
        .recap(RecapInput {
            since: "2026-04-20".into(),
            entries: vec![],
        })
        .await
        .unwrap();
    assert!(!out.headline.is_empty());
}
