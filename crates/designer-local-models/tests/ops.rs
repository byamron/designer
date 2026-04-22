use designer_local_models::{
    AuditClaim, AuditVerdict, ContextOptimizerInput, FoundationLocalOps, LocalOps, NullHelper,
    RecapInput,
};
use std::sync::Arc;

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
    assert!(out.summary.contains("offline"));
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
