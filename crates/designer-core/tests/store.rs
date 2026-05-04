use designer_core::{
    Actor, ArtifactId, ArtifactKind, EventPayload, EventStore, PayloadRef, ProjectId, Projection,
    Projector, SqliteEventStore, StreamId, StreamOptions, TrackId, TrackState, WorkspaceId,
};
use std::path::PathBuf;

#[tokio::test]
async fn append_and_read_stream_round_trip() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let stream = StreamId::Project(project_id);

    let payload = EventPayload::ProjectCreated {
        project_id,
        name: "Designer".into(),
        root_path: PathBuf::from("/tmp/designer"),
    };

    let env = store
        .append(stream.clone(), None, Actor::user(), payload)
        .await
        .unwrap();
    assert_eq!(env.sequence, 1);

    let events = store
        .read_stream(stream.clone(), StreamOptions::default())
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, env.id);
}

#[tokio::test]
async fn optimistic_concurrency_detects_conflict() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let stream = StreamId::Project(project_id);

    let payload = EventPayload::ProjectCreated {
        project_id,
        name: "A".into(),
        root_path: PathBuf::from("/tmp/a"),
    };
    store
        .append(stream.clone(), Some(0), Actor::user(), payload.clone())
        .await
        .unwrap();

    // Stale expected_sequence should fail.
    let err = store
        .append(stream.clone(), Some(0), Actor::user(), payload)
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        designer_core::CoreError::Concurrency {
            expected: 0,
            actual: 1
        }
    ));
}

#[tokio::test]
async fn projector_replays_events_into_aggregate_state() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let project_stream = StreamId::Project(project_id);
    let workspace_stream = StreamId::Workspace(workspace_id);

    store
        .append(
            project_stream.clone(),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Designer".into(),
                root_path: PathBuf::from("/tmp/d"),
            },
        )
        .await
        .unwrap();

    store
        .append(
            workspace_stream.clone(),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "onboarding".into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();

    let all = store.read_all(StreamOptions::default()).await.unwrap();
    assert_eq!(all.len(), 2);

    let projector = Projector::new();
    projector.replay(&all);
    assert_eq!(projector.projects().len(), 1);
    assert_eq!(projector.workspaces_in(project_id).len(), 1);
}

/// Regression: the live runtime applies every event twice — once
/// synchronously at the call site of `store.append` (read-your-own-
/// writes consistency) and once again from the broadcast subscriber
/// (`spawn_projector_task`). The projector must be sequence-idempotent
/// so the second apply doesn't double-project. Until 2026-05-01 this
/// raced silently; CI eventually surfaced it as `tabs.len() == 2`
/// instead of 1 in `core::tests::open_tab_appends_and_projects`.
#[tokio::test]
async fn projector_apply_is_idempotent_per_sequence() {
    use designer_core::{TabId, TabTemplate};

    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let tab_id = TabId::new();

    // Write minimal history: project + workspace + one tab.
    store
        .append(
            StreamId::Project(project_id),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "P".into(),
                root_path: PathBuf::from("/tmp/p"),
            },
        )
        .await
        .unwrap();
    let ws_env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::WorkspaceCreated {
                workspace_id,
                project_id,
                name: "ws".into(),
                base_branch: "main".into(),
            },
        )
        .await
        .unwrap();
    let tab_env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::TabOpened {
                tab_id,
                workspace_id,
                title: "Plan".into(),
                template: TabTemplate::Plan,
            },
        )
        .await
        .unwrap();

    // Variant 1 — manual dual-apply (the original CI-failing class).
    let projector = Projector::new();
    projector.apply(&ws_env);
    projector.apply(&tab_env);
    projector.apply(&ws_env);
    projector.apply(&tab_env);
    let ws = projector
        .workspace(workspace_id)
        .expect("workspace projected");
    assert_eq!(
        ws.tabs.len(),
        1,
        "manual dual-apply: must collapse to one tab (was {})",
        ws.tabs.len()
    );
    assert_eq!(ws.tabs[0].id, tab_id);

    // Variant 2 — the actual production boot path: `replay()` over the
    // full history (cold-boot snapshot rebuild) followed by a live
    // `apply()` that the broadcast subscriber would deliver for events
    // that happened during boot. The replay applies up through the
    // tab; the subsequent live apply of the same envelope must not
    // duplicate.
    let projector = Projector::new();
    let all = store.read_all(StreamOptions::default()).await.unwrap();
    projector.replay(&all);
    // Simulate the broadcast subscriber re-applying the most recent event.
    projector.apply(&tab_env);
    let ws = projector
        .workspace(workspace_id)
        .expect("workspace projected after replay");
    assert_eq!(
        ws.tabs.len(),
        1,
        "replay -> live apply: must not duplicate tab (was {})",
        ws.tabs.len()
    );

    // Variant 3 — concurrent applies of the same envelope from many
    // threads. The fix's atomicity comes from `parking_lot::RwLock`
    // wrapping the whole apply body, so two threads racing on the same
    // sequence both serialize through the write lock; whichever wins
    // first claims the sequence, and the loser's check sees the
    // claimed value and returns. Asserts the contract under load.
    let projector = std::sync::Arc::new(Projector::new());
    projector.apply(&ws_env);
    let mut handles = Vec::new();
    for _ in 0..16 {
        let p = projector.clone();
        let env = tab_env.clone();
        handles.push(std::thread::spawn(move || {
            p.apply(&env);
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    let ws = projector
        .workspace(workspace_id)
        .expect("workspace projected after concurrent applies");
    assert_eq!(
        ws.tabs.len(),
        1,
        "16-way concurrent apply: must collapse to one tab (was {})",
        ws.tabs.len()
    );
}

#[tokio::test]
async fn subscriber_receives_live_events() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let project_id = ProjectId::new();
    let stream = StreamId::Project(project_id);
    let mut rx = store.subscribe();

    store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ProjectCreated {
                project_id,
                name: "Live".into(),
                root_path: PathBuf::from("/tmp/live"),
            },
        )
        .await
        .unwrap();

    let received = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv())
        .await
        .expect("timeout waiting for event")
        .expect("channel closed");
    assert_eq!(
        received.kind(),
        designer_core::event::EventKind::ProjectCreated
    );
}

#[tokio::test]
async fn artifact_lifecycle_projects_through_pin_unpin_archive() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let workspace_id = WorkspaceId::new();
    let artifact_id = ArtifactId::new();
    let stream = StreamId::Workspace(workspace_id);

    // Created
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id,
                workspace_id,
                artifact_kind: ArtifactKind::Spec,
                title: "Onboarding spec".into(),
                summary: "Three-step link + autonomy choice.".into(),
                payload: PayloadRef::inline("# Onboarding\n\nGoal: link + spawn under 60s."),
                author_role: Some("team-lead".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let found = projector.artifact(artifact_id).expect("artifact created");
    assert_eq!(found.kind, ArtifactKind::Spec);
    assert_eq!(found.version, 1);
    assert!(found.pinned_at.is_none());

    // Pinned
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactPinned { artifact_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let pinned = projector.pinned_artifacts(workspace_id);
    assert_eq!(pinned.len(), 1);
    assert_eq!(pinned[0].id, artifact_id);

    // Unpinned
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactUnpinned { artifact_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert!(projector.pinned_artifacts(workspace_id).is_empty());

    // Archived
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactArchived { artifact_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert!(projector.artifacts_in(workspace_id).is_empty());
    // Archived artifacts are still fetchable by id.
    assert!(projector.artifact(artifact_id).is_some());
}

/// Spine pollution guard — the projection's allowlist filters out
/// per-tool-use `Used <X>` reports (kind=Report, no recap/auditor role)
/// but keeps substantive artifacts (`Spec`, `Prototype`, etc.). Mirrors
/// `frc_019de6fe-e719`: "the artifacts in the activity spine store
/// basically every action — this gets polluted quickly".
#[tokio::test]
async fn spine_projection_filters_tool_use_reports_but_keeps_specs() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let workspace_id = WorkspaceId::new();
    let stream = StreamId::Workspace(workspace_id);

    // A "Used Read" tool-use card from PR #19 — Report kind with no
    // recap/auditor role. Should NOT enter the spine.
    let tool_report_id = ArtifactId::new();
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: tool_report_id,
                workspace_id,
                artifact_kind: ArtifactKind::Report,
                title: "Used Read".into(),
                summary: "tool: read · src/foo.rs".into(),
                payload: PayloadRef::inline("{}"),
                author_role: Some("tool".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    // A real spec artifact — must enter the spine.
    let spec_id = ArtifactId::new();
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: spec_id,
                workspace_id,
                artifact_kind: ArtifactKind::Spec,
                title: "Onboarding spec".into(),
                summary: "Three-step link + autonomy choice.".into(),
                payload: PayloadRef::inline("# Onboarding"),
                author_role: Some("planner".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    // A recap report — Report kind WITH the recap role. Allowlisted.
    let recap_id = ArtifactId::new();
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: recap_id,
                workspace_id,
                artifact_kind: ArtifactKind::Report,
                title: "Daily recap".into(),
                summary: "3 PRs landed; 1 needs review.".into(),
                payload: PayloadRef::inline("…"),
                author_role: Some("recap".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    // Default (show_all=false) — only the substantive artifacts.
    let spine = projector.spine_artifacts_in(workspace_id, false);
    let ids: std::collections::HashSet<_> = spine.iter().map(|a| a.id).collect();
    assert!(ids.contains(&spec_id), "spec must enter the spine");
    assert!(ids.contains(&recap_id), "recap report must enter the spine");
    assert!(
        !ids.contains(&tool_report_id),
        "tool-use 'Used Read' report must be filtered out"
    );

    // show_all=true — debug bypass surfaces every artifact.
    let all = projector.spine_artifacts_in(workspace_id, true);
    let all_ids: std::collections::HashSet<_> = all.iter().map(|a| a.id).collect();
    assert!(all_ids.contains(&spec_id));
    assert!(all_ids.contains(&recap_id));
    assert!(
        all_ids.contains(&tool_report_id),
        "show_all bypass must surface tool-use reports for debugging"
    );
}

#[tokio::test]
async fn track_lifecycle_projects_through_pr_open_complete_archive() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let workspace_id = WorkspaceId::new();
    let track_id = TrackId::new();
    let stream = StreamId::Workspace(workspace_id);

    // Started
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::TrackStarted {
                track_id,
                workspace_id,
                worktree_path: PathBuf::from("/tmp/repo/.designer/worktrees/feature-a"),
                branch: "feature/a".into(),
                anchor_node_id: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let track = projector.track(track_id).expect("track created");
    assert_eq!(track.state, TrackState::Active);
    assert_eq!(projector.tracks_in(workspace_id).len(), 1);

    // PR opened
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::PullRequestOpened {
                track_id,
                pr_number: 42,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let track = projector.track(track_id).unwrap();
    assert_eq!(track.state, TrackState::PrOpen);
    assert_eq!(track.pr_number, Some(42));

    // Completed
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::system(),
            EventPayload::TrackCompleted { track_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert_eq!(projector.track(track_id).unwrap().state, TrackState::Merged);

    // Archived
    let env = store
        .append(
            stream.clone(),
            None,
            Actor::system(),
            EventPayload::TrackArchived { track_id },
        )
        .await
        .unwrap();
    projector.apply(&env);
    assert_eq!(
        projector.track(track_id).unwrap().state,
        TrackState::Archived
    );

    // Replay produces identical state.
    let all = store.read_all(StreamOptions::default()).await.unwrap();
    let replayed = Projector::new();
    replayed.replay(&all);
    let replayed_track = replayed.track(track_id).unwrap();
    assert_eq!(replayed_track.state, TrackState::Archived);
    assert_eq!(replayed_track.pr_number, Some(42));
    assert_eq!(replayed.tracks_in(workspace_id).len(), 1);
}

#[tokio::test]
async fn payload_ref_inline_vs_hash_serialize_distinctly() {
    let inline = PayloadRef::inline("short");
    let hash = PayloadRef::Hash {
        hash: "abc123".into(),
        size: 50_000,
    };
    let inline_json = serde_json::to_string(&inline).unwrap();
    let hash_json = serde_json::to_string(&hash).unwrap();
    assert!(inline_json.contains("\"kind\":\"inline\""));
    assert!(hash_json.contains("\"kind\":\"hash\""));
    assert!(hash_json.contains("\"size\":50000"));
    let round: PayloadRef = serde_json::from_str(&inline_json).unwrap();
    assert!(round.is_inline());
}

#[tokio::test]
async fn busy_timeout_is_5_seconds_on_pool_connections() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    assert_eq!(store.busy_timeout_ms().unwrap(), 5000);
}

/// Per-tab thread isolation. With two tabs in the same workspace,
/// `MessagePosted` / `ArtifactCreated { kind: Message }` events with
/// `tab_id: Some(t)` must project into the requested tab and NOT into
/// the sibling tab. Non-message artifacts (specs, PRs, …) stay
/// workspace-wide and appear in every tab's slice.
#[tokio::test]
async fn artifacts_filter_by_tab_for_message_kind_only() {
    use designer_core::{TabId, TabTemplate};

    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let tab_a = TabId::new();
    let tab_b = TabId::new();

    // Seed: project + workspace + two tabs.
    for env in [
        store
            .append(
                StreamId::Project(project_id),
                None,
                Actor::user(),
                EventPayload::ProjectCreated {
                    project_id,
                    name: "P".into(),
                    root_path: PathBuf::from("/tmp/p"),
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::WorkspaceCreated {
                    workspace_id,
                    project_id,
                    name: "ws".into(),
                    base_branch: "main".into(),
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id: tab_a,
                    workspace_id,
                    title: "Tab A".into(),
                    template: TabTemplate::Thread,
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id: tab_b,
                    workspace_id,
                    title: "Tab B".into(),
                    template: TabTemplate::Thread,
                },
            )
            .await
            .unwrap(),
    ] {
        projector.apply(&env);
    }

    // Two messages — one per tab.
    let msg_in_a = ArtifactId::new();
    let msg_in_b = ArtifactId::new();
    let env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: msg_in_a,
                workspace_id,
                artifact_kind: ArtifactKind::Message,
                title: "from A".into(),
                summary: "from A".into(),
                payload: PayloadRef::inline("from A"),
                author_role: Some("user".into()),
                tab_id: Some(tab_a),
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);
    let env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: msg_in_b,
                workspace_id,
                artifact_kind: ArtifactKind::Message,
                title: "from B".into(),
                summary: "from B".into(),
                payload: PayloadRef::inline("from B"),
                author_role: Some("user".into()),
                tab_id: Some(tab_b),
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    // One workspace-wide spec — must show up in every tab's view.
    let spec_id = ArtifactId::new();
    let env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: spec_id,
                workspace_id,
                artifact_kind: ArtifactKind::Spec,
                title: "shared spec".into(),
                summary: "shared".into(),
                payload: PayloadRef::inline("# shared"),
                author_role: Some("team-lead".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    let in_a = projector.artifacts_in_tab(workspace_id, tab_a);
    let in_b = projector.artifacts_in_tab(workspace_id, tab_b);

    let ids_a: Vec<_> = in_a.iter().map(|a| a.id).collect();
    let ids_b: Vec<_> = in_b.iter().map(|a| a.id).collect();

    assert!(ids_a.contains(&msg_in_a), "tab A is missing its own msg");
    assert!(
        ids_a.contains(&spec_id),
        "tab A is missing the workspace spec"
    );
    assert!(
        !ids_a.contains(&msg_in_b),
        "tab A leaked tab B's message: {ids_a:?}"
    );

    assert!(ids_b.contains(&msg_in_b), "tab B is missing its own msg");
    assert!(
        ids_b.contains(&spec_id),
        "tab B is missing the workspace spec"
    );
    assert!(
        !ids_b.contains(&msg_in_a),
        "tab B leaked tab A's message: {ids_b:?}"
    );
}

/// Legacy attribution: a `Message` `ArtifactCreated` event whose
/// `tab_id` is `None` (pre-tab-isolation) must project to the
/// workspace's first non-closed tab so historical conversations
/// remain visible after the schema change.
#[tokio::test]
async fn legacy_message_without_tab_id_projects_to_first_tab() {
    use designer_core::{TabId, TabTemplate};

    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let first_tab = TabId::new();
    let second_tab = TabId::new();

    let envs = vec![
        store
            .append(
                StreamId::Project(project_id),
                None,
                Actor::user(),
                EventPayload::ProjectCreated {
                    project_id,
                    name: "P".into(),
                    root_path: PathBuf::from("/tmp/p"),
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::WorkspaceCreated {
                    workspace_id,
                    project_id,
                    name: "ws".into(),
                    base_branch: "main".into(),
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id: first_tab,
                    workspace_id,
                    title: "First".into(),
                    template: TabTemplate::Thread,
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id: second_tab,
                    workspace_id,
                    title: "Second".into(),
                    template: TabTemplate::Thread,
                },
            )
            .await
            .unwrap(),
    ];
    for env in &envs {
        projector.apply(env);
    }

    // Legacy event: no `tab_id`. Must attribute to the first tab.
    let legacy_msg = ArtifactId::new();
    let env = store
        .append(
            StreamId::Workspace(workspace_id),
            None,
            Actor::user(),
            EventPayload::ArtifactCreated {
                artifact_id: legacy_msg,
                workspace_id,
                artifact_kind: ArtifactKind::Message,
                title: "old".into(),
                summary: "old".into(),
                payload: PayloadRef::inline("old"),
                author_role: Some("user".into()),
                tab_id: None,
                summary_high: None,
                classification: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    let in_first = projector.artifacts_in_tab(workspace_id, first_tab);
    let in_second = projector.artifacts_in_tab(workspace_id, second_tab);

    assert!(
        in_first.iter().any(|a| a.id == legacy_msg),
        "legacy msg should attribute to the workspace's first tab"
    );
    assert!(
        in_second.iter().all(|a| a.id != legacy_msg),
        "legacy msg should NOT appear in the second tab"
    );
}

// ---- Phase 22.A — roadmap projection determinism ----

/// Two tracks claim the same node. After replay (in any order), both
/// projections must agree: same claimants, same shipments, same `node_for_track`
/// reverse-index. Determinism is the load-bearing property here — multi-claim
/// rendering on the canvas depends on it.
#[tokio::test]
async fn roadmap_claims_project_deterministically_across_replay_orders() {
    use designer_core::roadmap::NodeId;

    let store = SqliteEventStore::open_in_memory().unwrap();
    let workspace_id = WorkspaceId::new();
    let stream = StreamId::Workspace(workspace_id);
    let node = NodeId::new("phase22.a");
    let track_a = TrackId::new();
    let track_b = TrackId::new();

    // Append both TrackStarted events with anchor.
    store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::TrackStarted {
                track_id: track_a,
                workspace_id,
                worktree_path: PathBuf::from("/tmp/wt/a"),
                branch: "feature/a".into(),
                anchor_node_id: Some(node.clone()),
            },
        )
        .await
        .unwrap();
    store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::TrackStarted {
                track_id: track_b,
                workspace_id,
                worktree_path: PathBuf::from("/tmp/wt/b"),
                branch: "feature/b".into(),
                anchor_node_id: Some(node.clone()),
            },
        )
        .await
        .unwrap();

    let events = store
        .read_stream(stream.clone(), StreamOptions::default())
        .await
        .unwrap();

    // Single replay vs double replay (the boot-path double-apply concern):
    // the projector's `last_applied` dedupes per `(stream, sequence)`, so
    // replaying twice must produce the same state as replaying once.
    let p1 = Projector::new();
    p1.replay(&events);
    let p2 = Projector::new();
    p2.replay(&events);
    p2.replay(&events);

    let claims_1 = p1.node_claimants(&node);
    let claims_2 = p2.node_claimants(&node);
    assert_eq!(claims_1.len(), 2, "two tracks → two claims");
    assert_eq!(
        claims_1, claims_2,
        "double-replay must equal single-replay (idempotency)"
    );
    // Order is stable: claimed_at ascending, then track_id lexicographic
    // on ties. UUIDv7 ids agree with creation time so the secondary sort
    // doesn't surprise.
    assert!(
        claims_1[0].claimed_at <= claims_1[1].claimed_at,
        "claimants ordered by claimed_at ascending"
    );
    assert_eq!(p1.node_for_track(track_a), Some(node.clone()));
    assert_eq!(p1.node_for_track(track_b), Some(node.clone()));
}

/// `TrackArchived` cleans the live claim but leaves shipment history alone
/// (shipments aren't populated in 22.A but the cleanup invariant is what
/// 22.I will rely on).
#[tokio::test]
async fn track_archived_drops_node_claim_idempotently() {
    use designer_core::roadmap::NodeId;

    let store = SqliteEventStore::open_in_memory().unwrap();
    let workspace_id = WorkspaceId::new();
    let stream = StreamId::Workspace(workspace_id);
    let node = NodeId::new("phase22.a");
    let track = TrackId::new();
    let projector = Projector::new();

    let started = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::TrackStarted {
                track_id: track,
                workspace_id,
                worktree_path: PathBuf::from("/tmp/wt/x"),
                branch: "feature/x".into(),
                anchor_node_id: Some(node.clone()),
            },
        )
        .await
        .unwrap();
    projector.apply(&started);
    assert_eq!(projector.node_claimants(&node).len(), 1);

    let archived = store
        .append(
            stream.clone(),
            None,
            Actor::user(),
            EventPayload::TrackArchived { track_id: track },
        )
        .await
        .unwrap();
    projector.apply(&archived);
    assert!(projector.node_claimants(&node).is_empty());
    assert_eq!(projector.node_for_track(track), None);

    // Re-applying the same archive event (boot path duplicate) is a no-op.
    projector.apply(&archived);
    assert!(projector.node_claimants(&node).is_empty());
}

/// Tracks without an `anchor_node_id` (the common case in 13.E flows) do
/// not produce claims. Verifies the optional-anchor projection path stays
/// quiet for tracks that don't claim a roadmap node.
#[tokio::test]
async fn track_without_anchor_does_not_create_a_claim() {
    let store = SqliteEventStore::open_in_memory().unwrap();
    let workspace_id = WorkspaceId::new();
    let stream = StreamId::Workspace(workspace_id);
    let track = TrackId::new();
    let projector = Projector::new();

    let env = store
        .append(
            stream,
            None,
            Actor::user(),
            EventPayload::TrackStarted {
                track_id: track,
                workspace_id,
                worktree_path: PathBuf::from("/tmp/wt/no-anchor"),
                branch: "feature/no-anchor".into(),
                anchor_node_id: None,
            },
        )
        .await
        .unwrap();
    projector.apply(&env);

    assert_eq!(projector.node_for_track(track), None);
    assert!(projector.all_node_claimants().is_empty());
}

/// Replay-order race: a legacy `Message` `ArtifactCreated` event with
/// `tab_id: None` may be applied **before** any `TabOpened` event in
/// the stream (the workspace's tabs were created later in the user's
/// history). The apply-time attribution falls through to `None`
/// because no tab exists yet — and Phase 23.E's strict tab match
/// would hide the message forever. The query-side fallback in
/// `artifacts_in_tab` must surface it on the workspace's first tab
/// once tabs do exist.
#[tokio::test]
async fn legacy_message_before_any_tab_event_surfaces_on_first_tab() {
    use designer_core::{TabId, TabTemplate};

    let store = SqliteEventStore::open_in_memory().unwrap();
    let projector = Projector::new();
    let project_id = ProjectId::new();
    let workspace_id = WorkspaceId::new();
    let later_tab = TabId::new();

    // Order matters: workspace exists, then a legacy message lands
    // *before* any tab is created.
    let envs = vec![
        store
            .append(
                StreamId::Project(project_id),
                None,
                Actor::user(),
                EventPayload::ProjectCreated {
                    project_id,
                    name: "P".into(),
                    root_path: PathBuf::from("/tmp/p"),
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::WorkspaceCreated {
                    workspace_id,
                    project_id,
                    name: "ws".into(),
                    base_branch: "main".into(),
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::ArtifactCreated {
                    artifact_id: ArtifactId::new(),
                    workspace_id,
                    artifact_kind: ArtifactKind::Message,
                    title: "orphan".into(),
                    summary: "orphan".into(),
                    payload: PayloadRef::inline("orphan"),
                    author_role: Some("user".into()),
                    tab_id: None,
                    summary_high: None,
                    classification: None,
                },
            )
            .await
            .unwrap(),
        store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id: later_tab,
                    workspace_id,
                    title: "Tab opened later".into(),
                    template: TabTemplate::Thread,
                },
            )
            .await
            .unwrap(),
    ];
    for env in &envs {
        projector.apply(env);
    }

    let in_tab = projector.artifacts_in_tab(workspace_id, later_tab);
    assert_eq!(
        in_tab
            .iter()
            .filter(|a| a.kind == ArtifactKind::Message)
            .count(),
        1,
        "orphan legacy message should surface on the workspace's first tab \
         even though it landed in the stream before any TabOpened event"
    );
}
