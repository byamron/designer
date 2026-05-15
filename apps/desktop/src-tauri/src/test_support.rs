//! Shared test mocks for the desktop crate. Cross-module tests and
//! integration tests under `tests/` reach for these doubles instead of
//! redefining inline copies in every test module.
//!
//! Two surfaces live here:
//!
//! * [`CountingOps`] — a counting `LocalOps` mock used by unit tests in
//!   `core_local`. Crate-private.
//! * [`IntegrationHarness`] — a reusable boot pattern for integration
//!   tests under `tests/`. Boots `AppCore` against a `MockOrchestrator`,
//!   spawns the message coalescer (the broadcast → store bridge), and
//!   wires the production `InboxPermissionHandler` into the mock so
//!   scripted `ToolUse` blocks park on the real inbox.
//!
//! See Phase 24I (`core-docs/roadmap.md` §"Phase 24I — Harden: AppCore
//! integration test harness") for the motivating context.

use async_trait::async_trait;
use designer_claude::{MockOrchestrator, Orchestrator, PermissionHandler, TeamSpec};
use designer_core::{
    EventEnvelope, EventStore, ProjectId, SqliteEventStore, StreamOptions, TabId, TabTemplate,
    WorkspaceId,
};
use designer_local_models::{
    AuditClaim, AuditVerdict, ContextOptimizerInput, ContextOptimizerOutput, HelperResult,
    LocalOps, RecapInput, RecapOutput, RowSummarizeInput, RowSummarizeOutput,
};
use designer_safety::CostCap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

use crate::core::{AppConfig, AppCore};
use crate::core_agents::spawn_message_coalescer;
use crate::core_safety::{inbox_handler, PendingApproval};

/// Counting `LocalOps` mock: every helper method is a no-op except
/// `summarize_row`, which increments `summarize_calls` so callers can assert
/// "exactly N helper round-trips for this code path." Returns a fixed
/// `"summary line"` string so artifact-level assertions can match on it.
#[derive(Default)]
#[allow(
    dead_code,
    reason = "used by unit tests in `core_git`; lives here to share the mock"
)]
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

/// Phase 24I — reusable AppCore integration harness.
///
/// Boots a real `AppCore` against a typed [`MockOrchestrator`], spawns
/// the message-coalescer (so scripted broadcasts get persisted to the
/// store), and installs the production [`InboxPermissionHandler`] into
/// the mock. Integration tests under `tests/` drive `AppCore` via the
/// `ipc::cmd_*` surface and assert against `read_events()`.
///
/// The typical flow:
///
/// ```ignore
/// let h = IntegrationHarness::boot().await;
/// let project = h.create_project("Demo").await;
/// let ws = h.create_workspace(project, "alpha").await;
/// let tab = h.open_tab(ws).await;
/// h.spawn_team(ws, tab).await;
/// h.script_turn(ws, tab, ScriptedTurn::text("msg_1", "hi"));
/// h.post_message(ws, tab, "hello").await.unwrap();
/// let events = h.read_events().await;
/// ```
pub struct IntegrationHarness {
    pub core: Arc<AppCore>,
    pub mock: Arc<MockOrchestrator<SqliteEventStore>>,
    /// Tempdirs kept alive for the lifetime of the harness. AppCore opens
    /// its sqlite at `data_dir/events.db`; dropping the dir invalidates
    /// every read in flight.
    _data_dir: TempDir,
    pub project_root: TempDir,
}

impl IntegrationHarness {
    /// Boot a fresh AppCore + typed mock orchestrator + message coalescer
    /// + production inbox permission handler installed on the mock.
    ///
    /// **Why the coalescer.** `AppCore::boot_with_orchestrator` does not
    /// auto-spawn the message coalescer — that's a `main.rs` setup step
    /// in production. The coalescer is the broadcast → store bridge for
    /// Phase 24 events: without it, scripted `AgentTurn*` events fire on
    /// the orchestrator broadcast but never land in `store.read_all()`.
    /// We use a 5 ms flush window so tests don't have to wait the
    /// production 120 ms.
    ///
    /// **Why the inbox handler.** `InboxPermissionHandler` is installed
    /// as a process-global during `AppCore::boot`, but only wired into
    /// `ClaudeCodeOrchestrator` — the mock is constructed without one.
    /// We re-attach it post-boot so scripted `ToolUse` blocks park on
    /// the production handler (the same handler `cmd_resolve_approval`
    /// resolves).
    pub async fn boot() -> Self {
        let data_dir = tempfile::tempdir().expect("tempdir for data");
        let project_root = tempfile::tempdir().expect("tempdir for project root");

        // The mock keeps its own in-memory store — it only persists the
        // legacy `AgentSpawned` / mock reply chain there, which the
        // harness's event-log assertions don't read. Phase 24 broadcasts
        // reach AppCore's on-disk store via the coalescer bridge spawned
        // below. (Matches the pattern in `tests/activity_bridge_e2e.rs`.)
        let mock_store =
            Arc::new(SqliteEventStore::open_in_memory().expect("open in-memory mock store"));
        let mock = Arc::new(MockOrchestrator::new(mock_store));

        let config = AppConfig {
            data_dir: data_dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };

        let core =
            AppCore::boot_with_orchestrator(config, Some(mock.clone() as Arc<dyn Orchestrator>))
                .await
                .expect("boot AppCore for harness");

        // Phase 24 broadcast → store bridge. Tight window so the
        // round-trip test isn't bottlenecked by coalescer wait.
        spawn_message_coalescer(core.clone(), Duration::from_millis(5));

        // Re-wire the production inbox handler into the mock so scripted
        // ToolUse blocks park on the same handler `cmd_resolve_approval`
        // wakes. `inbox_handler()` is `None` in unusual setups (no
        // AppCore booted in this process yet) — bail loudly so a future
        // refactor of `install_inbox_handler` surfaces here rather than
        // as a silent "approvals just auto-accept" mystery.
        let handler = inbox_handler().expect(
            "InboxPermissionHandler must be installed by AppCore::boot before harness wiring",
        );
        mock.install_permission_handler(handler as Arc<dyn PermissionHandler>);

        Self {
            core,
            mock,
            _data_dir: data_dir,
            project_root,
        }
    }

    /// Create a project rooted at the harness's tempdir. Returns the
    /// fresh [`ProjectId`].
    pub async fn create_project(&self, name: &str) -> ProjectId {
        let project = self
            .core
            .create_project(name.into(), self.project_root.path().to_path_buf())
            .await
            .expect("create project");
        project.id
    }

    /// Create a workspace under `project_id`. The base branch defaults
    /// to `main` since the harness's project root is a temp dir and
    /// won't be exercising real git ops in most integration tests.
    pub async fn create_workspace(&self, project_id: ProjectId, name: &str) -> WorkspaceId {
        let ws = self
            .core
            .create_workspace(project_id, name.into(), "main".into())
            .await
            .expect("create workspace");
        ws.id
    }

    /// Open a `Thread` tab on the workspace. Round-trips through the
    /// projection so the returned `TabId` is what `cmd_post_message`
    /// expects.
    pub async fn open_tab(&self, workspace_id: WorkspaceId) -> TabId {
        let tab = self
            .core
            .open_tab(workspace_id, "Thread".into(), TabTemplate::Thread)
            .await
            .expect("open tab");
        tab.id
    }

    /// Pre-spawn the mock team for `(workspace, tab)`. The mock's
    /// `post_message` returns `TeamNotFound` until this lands — callers
    /// who skip it will see `cmd_post_message` fail.
    pub async fn spawn_team(&self, workspace_id: WorkspaceId, tab_id: TabId) {
        self.mock
            .spawn_team(TeamSpec {
                workspace_id,
                tab_id,
                team_name: "harness".into(),
                lead_role: "assistant".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: true,
            })
            .await
            .expect("spawn_team for harness");
    }

    /// Queue a scripted Phase 24 turn on the mock for the next user
    /// `post_message` to `(workspace_id, tab_id)`. FIFO per key — see
    /// [`MockOrchestrator::script_next_turn`] for the contract.
    pub fn script_turn(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
        turn: designer_claude::ScriptedTurn,
    ) {
        self.mock.script_next_turn(workspace_id, tab_id, turn);
    }

    /// Drive a user `post_message` through the IPC layer. Returns the
    /// `PostMessageResponse` so callers can correlate the user-side
    /// artifact id with their assertions.
    pub async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
        body: &str,
    ) -> Result<designer_ipc::PostMessageResponse, designer_ipc::IpcError> {
        crate::ipc_agents::cmd_post_message(
            &self.core,
            designer_ipc::PostMessageRequest {
                workspace_id,
                text: body.into(),
                attachments: vec![],
                tab_id: Some(tab_id),
                model: None,
            },
        )
        .await
    }

    /// Resolve a parked approval via the IPC layer.
    pub async fn resolve_approval(
        &self,
        approval_id: designer_core::ApprovalId,
        granted: bool,
        reason: Option<&str>,
    ) -> Result<(), designer_ipc::IpcError> {
        crate::ipc::cmd_resolve_approval(
            &self.core,
            approval_id.to_string(),
            granted,
            reason.map(|s| s.to_string()),
        )
        .await
    }

    /// Read the full event log via the store. Convenience for "did event
    /// X land?" assertions; uses `StreamOptions::default()` so events
    /// arrive in `(timestamp, rowid)` order — the same order the
    /// projector replays them.
    pub async fn read_events(&self) -> Vec<EventEnvelope> {
        self.core
            .store
            .read_all(StreamOptions::default())
            .await
            .expect("read_all")
    }

    /// Snapshot of pending approvals via the IPC layer. Filters to
    /// `workspace_id` when supplied. Walks the event log under the hood,
    /// so prefer calling once and iterating instead of polling in a tight
    /// loop.
    pub async fn pending_approvals(
        &self,
        workspace_id: Option<WorkspaceId>,
    ) -> Vec<PendingApproval> {
        self.core.list_pending_approvals(workspace_id).await
    }
}
