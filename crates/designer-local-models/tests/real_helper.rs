//! Round-trip the real Swift helper on dev machines with Apple Intelligence.
//!
//! This test does NOT use `#[ignore]`. Instead it gates on the presence of
//! `DESIGNER_HELPER_BINARY` and whether the pointed-to file actually exists.
//! On machines without the binary (CI, non-AI-capable Macs, anything missing
//! the Swift build) each test is a silent pass-through — no red CI, no manual
//! `-- --ignored` needed.
//!
//! To run on a capable dev machine:
//!
//!   ./scripts/build-helper.sh
//!   DESIGNER_HELPER_BINARY="$PWD/helpers/foundation/.build/release/designer-foundation-helper" \
//!     cargo test --package designer-local-models --test real_helper

use designer_local_models::{
    AuditClaim, ContextOptimizerInput, FoundationHelper, FoundationLocalOps, JobKind, LocalOps,
    RecapInput, RowSummarizeInput, SwiftFoundationHelper,
};
use std::path::PathBuf;
use std::sync::Arc;

fn binary() -> Option<PathBuf> {
    let raw = std::env::var("DESIGNER_HELPER_BINARY").ok()?;
    let path = PathBuf::from(raw);
    if path.is_file() {
        Some(path)
    } else {
        eprintln!(
            "DESIGNER_HELPER_BINARY set but not found: {} (skipping real-helper test)",
            path.display()
        );
        None
    }
}

#[tokio::test]
async fn ping_reports_version_and_model() {
    let Some(path) = binary() else {
        eprintln!("DESIGNER_HELPER_BINARY unset; skipping");
        return;
    };
    let helper = Arc::new(SwiftFoundationHelper::new(path));
    let pretty = helper.ping().await.expect("ping");
    assert!(!pretty.is_empty());
    let health = helper.health();
    assert!(health.version.is_some());
    assert!(health.model.is_some());
}

#[tokio::test]
async fn context_optimize_returns_non_fallback_text() {
    let Some(path) = binary() else {
        eprintln!("DESIGNER_HELPER_BINARY unset; skipping");
        return;
    };
    let helper = Arc::new(SwiftFoundationHelper::new(path));
    let ops = FoundationLocalOps::new(helper);
    let out = ops
        .context_optimize(ContextOptimizerInput {
            history: vec!["set up repo".into(), "shipped Phase 11".into()],
            focus: "phase 12b".into(),
        })
        .await
        .expect("context_optimize");
    // The NullHelper fallback would contain "offline"; real helper should not.
    assert!(!out.summary.contains("[offline"));
}

#[tokio::test]
async fn recap_produces_output() {
    let Some(path) = binary() else {
        eprintln!("DESIGNER_HELPER_BINARY unset; skipping");
        return;
    };
    let helper = Arc::new(SwiftFoundationHelper::new(path));
    let ops = FoundationLocalOps::new(helper);
    let out = ops
        .recap(RecapInput {
            since: "2026-04-20".into(),
            entries: vec!["workspace.created".into(), "task.completed".into()],
        })
        .await
        .expect("recap");
    assert!(!out.headline.is_empty());
}

#[tokio::test]
async fn audit_claim_returns_structured_verdict() {
    let Some(path) = binary() else {
        eprintln!("DESIGNER_HELPER_BINARY unset; skipping");
        return;
    };
    let helper = Arc::new(SwiftFoundationHelper::new(path));
    let ops = FoundationLocalOps::new(helper);
    // Just asserting no panic + a decidable verdict; the point is real
    // inference ran, not that we parsed a specific outcome.
    let _verdict = ops
        .audit_claim(AuditClaim {
            claim: "repository builds cleanly".into(),
            evidence: vec!["cargo build succeeded".into()],
        })
        .await
        .expect("audit");
}

#[tokio::test]
async fn summarize_row_returns_single_line() {
    let Some(path) = binary() else {
        eprintln!("DESIGNER_HELPER_BINARY unset; skipping");
        return;
    };
    let helper = Arc::new(SwiftFoundationHelper::new(path));
    let ops = FoundationLocalOps::new(helper);
    let out = ops
        .summarize_row(RowSummarizeInput {
            row_kind: "workspace".into(),
            state: "active".into(),
            latest_activity: Some("agent typed a reply".into()),
        })
        .await
        .expect("summarize_row");
    assert!(!out.line.contains('\n'));
    assert!(!out.line.contains("[offline"));
}

#[tokio::test]
async fn generate_caches_identical_prompts() {
    let Some(path) = binary() else {
        eprintln!("DESIGNER_HELPER_BINARY unset; skipping");
        return;
    };
    let helper = Arc::new(SwiftFoundationHelper::new(path));
    let first = helper
        .generate(JobKind::SummarizeRow, "hello")
        .await
        .expect("first");
    let second = helper
        .generate(JobKind::SummarizeRow, "hello")
        .await
        .expect("second");
    assert_eq!(first, second, "cache must return the identical string");
}
