use designer_core::{Actor, ApprovalId, SqliteEventStore, WorkspaceId};
use designer_safety::{
    ApprovalGate, ApprovalRequest, CostCap, CostTracker, CostUsage, CspBuilder, InMemoryApprovalGate,
    ScopeGuard, ScopeRule, ScopeVerdict,
};
use std::sync::Arc;

#[tokio::test]
async fn approval_gate_transitions() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let gate = InMemoryApprovalGate::new(store.clone());

    let id = ApprovalId::new();
    let workspace_id = WorkspaceId::new();
    gate.request(
        ApprovalRequest {
            id,
            workspace_id,
            gate: "merge".into(),
            summary: "merge PR #42".into(),
        },
        Actor::agent("team-a", "team-lead"),
    )
    .await
    .unwrap();

    assert_eq!(
        gate.status(id).await.unwrap(),
        designer_safety::ApprovalStatus::Pending
    );

    gate.grant(id, Actor::user()).await.unwrap();
    assert_eq!(
        gate.status(id).await.unwrap(),
        designer_safety::ApprovalStatus::Granted
    );
}

#[tokio::test]
async fn cost_tracker_enforces_cap() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let tracker = CostTracker::new(
        store.clone(),
        CostCap {
            max_dollars_cents: Some(100),
            max_tokens: None,
        },
    );
    let ws = WorkspaceId::new();
    tracker
        .check_and_record(
            ws,
            CostUsage {
                dollars_cents: 50,
                ..Default::default()
            },
            Actor::agent("team-a", "team-lead"),
        )
        .await
        .unwrap();
    let err = tracker
        .check_and_record(
            ws,
            CostUsage {
                dollars_cents: 60,
                ..Default::default()
            },
            Actor::agent("team-a", "team-lead"),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, designer_safety::SafetyError::CostCapExceeded(_)));
}

#[test]
fn scope_guard_enforces_allow_and_deny() {
    let rule = ScopeRule {
        allow: vec!["src/**".into(), "docs/**".into()],
        deny: vec!["**/.env".into(), "**/secrets/**".into()],
    };
    let guard = ScopeGuard::new(rule).unwrap();
    assert_eq!(guard.check("src/main.rs"), ScopeVerdict::Allowed);
    assert_eq!(guard.check("src/.env"), ScopeVerdict::Denied);
    assert_eq!(guard.check("node_modules/x.js"), ScopeVerdict::Denied);
    assert_eq!(guard.check("docs/readme.md"), ScopeVerdict::Allowed);
}

#[test]
fn csp_builder_is_strict_by_default() {
    let csp = CspBuilder::strict().build();
    assert!(csp.contains("default-src 'none'"));
    assert!(csp.contains("script-src 'none'"));
    assert!(csp.contains("object-src 'none'"));
    assert!(csp.contains("frame-ancestors 'self'"));
    assert!(!csp.contains("script-src 'unsafe-inline'"));
}
