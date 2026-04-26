use designer_core::{Actor, ApprovalId, SqliteEventStore, WorkspaceId};
use designer_safety::{
    ApprovalGate, ApprovalRequest, CostCap, CostTracker, CostUsage, CspBuilder,
    InMemoryApprovalGate, ScopeGuard, ScopeRule, ScopeVerdict,
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
    assert!(matches!(
        err,
        designer_safety::SafetyError::CostCapExceeded(_)
    ));
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

/// Phase-13.G regression: a tracker recreated over the same store must
/// reflect historical spend. Without `replay_from_store` the cap check
/// would silently allow a workspace to double-spend its budget across
/// boots.
#[tokio::test]
async fn cost_tracker_replay_reflects_historical_spend() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let ws = WorkspaceId::new();
    {
        let tracker = CostTracker::new(
            store.clone(),
            CostCap {
                max_dollars_cents: Some(1_000),
                max_tokens: None,
            },
        );
        tracker
            .check_and_record(
                ws,
                CostUsage {
                    dollars_cents: 700,
                    ..Default::default()
                },
                Actor::user(),
            )
            .await
            .unwrap();
        assert_eq!(tracker.usage(ws).dollars_cents, 700);
    }

    // Simulate a process restart: drop the tracker, recreate against the
    // same store. Pre-replay the in-memory map is empty.
    let revived = CostTracker::new(
        store.clone(),
        CostCap {
            max_dollars_cents: Some(1_000),
            max_tokens: None,
        },
    );
    assert_eq!(
        revived.usage(ws).dollars_cents,
        0,
        "fresh tracker starts empty"
    );
    revived.replay_from_store().await.unwrap();
    assert_eq!(
        revived.usage(ws).dollars_cents,
        700,
        "replay must reflect historical spend"
    );
    // The cap check now refuses a $4.00 charge that would push us past
    // $10 — pre-fix this test would *succeed* the second charge,
    // double-spending the cap.
    let err = revived
        .check_and_record(
            ws,
            CostUsage {
                dollars_cents: 400,
                ..Default::default()
            },
            Actor::user(),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        designer_safety::SafetyError::CostCapExceeded(_)
    ));
}

/// Phase-13.G regression: `gate.status(id)` must reflect store-recorded
/// resolutions after a fresh gate is constructed. Production resolutions
/// route through the `InboxPermissionHandler` (which writes the event but
/// bypasses the gate's in-memory map); the gate's `replay_from_store` +
/// `record_status` together keep the trait surface truthful.
#[tokio::test]
async fn gate_replay_reflects_historical_resolutions() {
    use designer_safety::ApprovalStatus;
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let ws = WorkspaceId::new();
    let id = ApprovalId::new();
    {
        let gate = InMemoryApprovalGate::new(store.clone());
        gate.request(
            ApprovalRequest {
                id,
                workspace_id: ws,
                gate: "tool:Write".into(),
                summary: "test".into(),
            },
            Actor::system(),
        )
        .await
        .unwrap();
        gate.grant(id, Actor::user()).await.unwrap();
    }

    let revived = InMemoryApprovalGate::new(store.clone());
    assert_eq!(
        revived.status(id).await.unwrap(),
        ApprovalStatus::Pending,
        "fresh gate starts empty"
    );
    revived.replay_from_store().await.unwrap();
    assert_eq!(
        revived.status(id).await.unwrap(),
        ApprovalStatus::Granted,
        "replay must surface historical Granted state"
    );
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
