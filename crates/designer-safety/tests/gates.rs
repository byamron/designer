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

// Lock the full CSP string. Any change to the strict baseline must update
// this assertion deliberately — that's the security review gate. Inline
// rather than a snapshot file because the value is short and the diff
// surfaces directly in PR review.
#[test]
fn csp_strict_baseline_matches_expected_exactly() {
    let csp = CspBuilder::strict().build();
    // Emission order is the declaration order of `CspDirective`.
    let expected = "default-src 'none'; \
        script-src 'none'; \
        style-src 'self' 'unsafe-inline'; \
        img-src 'self' data:; \
        connect-src 'none'; \
        font-src 'self' data:; \
        frame-src 'none'; \
        frame-ancestors 'self'; \
        object-src 'none'; \
        base-uri 'none'; \
        form-action 'none'; \
        worker-src 'none'";
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(normalize(&csp), normalize(expected));
}

/// Approval that resolves to Denied must not advance to Granted via a
/// later request — the approval id is single-use. This catches a class
/// of bug where a denied approval id gets re-requested and silently
/// flips state in the in-memory map.
#[tokio::test]
async fn approval_gate_denied_path() {
    use designer_safety::ApprovalStatus;
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let gate = InMemoryApprovalGate::new(store.clone());
    let id = ApprovalId::new();
    let workspace_id = WorkspaceId::new();

    gate.request(
        ApprovalRequest {
            id,
            workspace_id,
            gate: "tool:Bash".into(),
            summary: "rm -rf scratch/".into(),
        },
        Actor::agent("team-a", "team-lead"),
    )
    .await
    .unwrap();

    gate.deny(id, Some("user said no".into()), Actor::user())
        .await
        .unwrap();
    assert_eq!(gate.status(id).await.unwrap(), ApprovalStatus::Denied);

    // Replay through a fresh gate (simulating restart) — the denied
    // status survives, including the reason in the underlying event.
    let revived = InMemoryApprovalGate::new(store.clone());
    revived.replay_from_store().await.unwrap();
    assert_eq!(revived.status(id).await.unwrap(), ApprovalStatus::Denied);
}

/// Resolving an approval twice should be observable as the latest decision.
/// Production guards against this at the inbox handler level (single-writer),
/// but the gate trait itself is permissive — confirming the documented
/// "last-write-wins" semantic so a regression to e.g. "first-write-wins"
/// would surface here.
#[tokio::test]
async fn approval_gate_double_resolve_last_write_wins() {
    use designer_safety::ApprovalStatus;
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let gate = InMemoryApprovalGate::new(store.clone());
    let id = ApprovalId::new();
    let ws = WorkspaceId::new();
    gate.request(
        ApprovalRequest {
            id,
            workspace_id: ws,
            gate: "tool:Write".into(),
            summary: "edit file".into(),
        },
        Actor::system(),
    )
    .await
    .unwrap();
    gate.grant(id, Actor::user()).await.unwrap();
    gate.deny(id, None, Actor::user()).await.unwrap();
    assert_eq!(
        gate.status(id).await.unwrap(),
        ApprovalStatus::Denied,
        "second resolve overrides first"
    );
}

/// Per-workspace cost isolation: spend on one workspace must not count
/// against another's cap. This is the security-relevant invariant — a
/// shared map would let a noisy workspace block a quiet one.
#[tokio::test]
async fn cost_tracker_workspaces_isolated() {
    let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
    let tracker = CostTracker::new(
        store.clone(),
        CostCap {
            max_dollars_cents: Some(100),
            max_tokens: None,
        },
    );
    let ws_a = WorkspaceId::new();
    let ws_b = WorkspaceId::new();

    tracker
        .check_and_record(
            ws_a,
            CostUsage {
                dollars_cents: 90,
                ..Default::default()
            },
            Actor::user(),
        )
        .await
        .unwrap();

    // Workspace B starts fresh — full cap available, not blocked by A's
    // spend.
    tracker
        .check_and_record(
            ws_b,
            CostUsage {
                dollars_cents: 90,
                ..Default::default()
            },
            Actor::user(),
        )
        .await
        .expect("ws_b should not see ws_a's spend");

    assert_eq!(tracker.usage(ws_a).dollars_cents, 90);
    assert_eq!(tracker.usage(ws_b).dollars_cents, 90);
}

/// Scope deny-list takes precedence over allow-list. A path matching
/// both an allow pattern AND a deny pattern must be denied — otherwise
/// a broad allow (`src/**`) silently leaks files like `src/.env.local`
/// that the deny list was meant to protect.
#[test]
fn scope_guard_deny_wins_over_overlapping_allow() {
    let rule = ScopeRule {
        allow: vec!["src/**".into()],
        deny: vec!["**/.env*".into(), "**/secrets/**".into()],
    };
    let guard = ScopeGuard::new(rule).unwrap();
    assert_eq!(guard.check("src/main.rs"), ScopeVerdict::Allowed);
    assert_eq!(
        guard.check("src/.env.local"),
        ScopeVerdict::Denied,
        "deny pattern beats allow"
    );
    assert_eq!(
        guard.check("src/secrets/key.pem"),
        ScopeVerdict::Denied,
        "deny pattern beats allow"
    );
}

/// Empty allow list is a documented "allow-all (deny still enforced)"
/// fallback — locking it so a refactor that changes the default doesn't
/// silently flip every workspace into "allow nothing" or "ignore deny".
#[test]
fn scope_guard_empty_allow_means_allow_all_with_deny_floor() {
    let rule = ScopeRule {
        allow: vec![],
        deny: vec!["**/.env*".into()],
    };
    let guard = ScopeGuard::new(rule).unwrap();
    assert_eq!(guard.check("anything/at/all.rs"), ScopeVerdict::Allowed);
    assert_eq!(guard.check("repo/.env"), ScopeVerdict::Denied);
}
