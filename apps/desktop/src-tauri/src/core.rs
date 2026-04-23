//! `AppCore` is the wiring hub: one event store, one projector, one
//! orchestrator (Claude Code or mock), one safety apparatus, one local-model
//! helper. Consumers (the Tauri shell, the CLI, tests) hold one `AppCore` and
//! call typed methods.

use async_trait::async_trait;
use designer_audit::{AuditLog, SqliteAuditLog};
use designer_claude::{ClaudeCodeOptions, ClaudeCodeOrchestrator, MockOrchestrator, Orchestrator};
use designer_core::{
    Actor, EventPayload, EventStore, ProjectId, Projection, Projector, SqliteEventStore, StreamId,
    StreamOptions, Tab, TabId, TabTemplate, Workspace, WorkspaceId,
};
use designer_ipc::{SpineAltitude, SpineRow, SpineState};
use designer_local_models::{
    probe_helper, FoundationHelper, FoundationLocalOps, HelperError, HelperEvent, HelperHealth,
    LocalOps, NullHelper, SwiftFoundationHelper,
};
use designer_safety::{CostCap, CostTracker, InMemoryApprovalGate};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub data_dir: PathBuf,
    pub use_mock_orchestrator: bool,
    #[serde(default)]
    pub claude_options: ClaudeCodeOptions,
    pub default_cost_cap: CostCap,
    /// Absolute path to the Swift Foundation Models helper binary. `None`
    /// forces the `NullHelper` fallback regardless of hardware. Resolved by
    /// `default_in_home()` from (in priority order):
    ///   1. `DESIGNER_HELPER_BINARY` env (absolute path).
    ///   2. Sibling of `current_exe()` when running inside a `.app` bundle
    ///      (Phase-16 production path; `Contents/MacOS/designer-foundation-helper`).
    ///   3. `<workspace>/helpers/foundation/.build/release/designer-foundation-helper`
    ///      when running under Cargo (dev).
    #[serde(default)]
    pub helper_binary_path: Option<PathBuf>,
}

impl AppConfig {
    pub fn default_in_home() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let helper_binary_path = resolve_default_helper_path();
        Self {
            data_dir: PathBuf::from(home).join(".designer"),
            use_mock_orchestrator: true,
            claude_options: ClaudeCodeOptions::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: Some(10_00),
                max_tokens: Some(1_000_000),
            },
            helper_binary_path,
        }
    }
}

/// Resolve the default helper binary path without spawning anything. See
/// `AppConfig::helper_binary_path` for the priority order.
fn resolve_default_helper_path() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("DESIGNER_HELPER_BINARY") {
        let p = PathBuf::from(override_path);
        if p.is_absolute() {
            info!(target: "local_models", path = %p.display(), "helper path from DESIGNER_HELPER_BINARY");
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let in_bundle = exe.ancestors().any(|p| p.ends_with("Contents/MacOS"));
        if in_bundle {
            if let Some(dir) = exe.parent() {
                let p = dir.join("designer-foundation-helper");
                info!(target: "local_models", path = %p.display(), "helper path resolved inside .app bundle");
                return Some(p);
            }
        }
    }

    // Dev path: walk up from CARGO_MANIFEST_DIR to the workspace root.
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let start = PathBuf::from(manifest);
        for dir in start.ancestors() {
            if dir.join("Cargo.toml").exists() && dir.join("helpers").exists() {
                let p = dir.join("helpers/foundation/.build/release/designer-foundation-helper");
                info!(target: "local_models", path = %p.display(), "helper path resolved at workspace dev location");
                return Some(p);
            }
        }
    }

    info!(target: "local_models", "no helper path resolved; NullHelper will be used");
    None
}

/// Boot-time status of the local-model helper. Decided once at `AppCore::boot`;
/// runtime health (restarts, current streak) lives on the helper itself and is
/// observable via `AppCore::helper_health()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelperStatus {
    pub kind: HelperStatusKind,
    pub fallback_reason: Option<FallbackReason>,
    pub binary_path: Option<PathBuf>,
    pub version: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HelperStatusKind {
    /// `SwiftFoundationHelper` passed the boot probe and is driving requests.
    Live,
    /// `NullHelper` is active — see `fallback_reason`.
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FallbackReason {
    /// Operator forced fallback via `DESIGNER_DISABLE_HELPER=1`.
    UserDisabled,
    /// `helper_binary_path` is `None` — no install detected.
    NotConfigured,
    /// Path is configured but the file does not exist or is not executable.
    BinaryMissing { path: PathBuf },
    /// Binary exists but `ping()` exceeded the boot deadline.
    PingTimeout,
    /// Binary spawned and reported `macos-too-old`. Terminal — no retry will help.
    UnsupportedOs,
    /// Binary spawned and reported `foundation-models-unavailable` (Apple Intelligence
    /// not enabled on this Mac, framework not linkable). Terminal on current hardware.
    ModelsUnavailable,
    /// Binary spawned and responded with some other error. `error` is the
    /// helper's verbatim message (may include Apple's error description).
    PingFailed { error: String },
}

impl FallbackReason {
    /// Whether the user can recover from this fallback. Pre-computed here so
    /// the IPC DTO and any future UI don't re-derive the routing.
    pub fn recovery(&self) -> RecoveryKind {
        match self {
            FallbackReason::UserDisabled => RecoveryKind::User,
            FallbackReason::BinaryMissing { .. } => RecoveryKind::Reinstall,
            FallbackReason::NotConfigured => RecoveryKind::Reinstall,
            FallbackReason::PingTimeout => RecoveryKind::Reinstall,
            FallbackReason::PingFailed { .. } => RecoveryKind::Reinstall,
            FallbackReason::UnsupportedOs | FallbackReason::ModelsUnavailable => RecoveryKind::None,
        }
    }
}

/// Whether a fallback is self-recoverable. Controls whether the UI offers a
/// retry affordance.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryKind {
    /// User can flip an env var / config toggle.
    User,
    /// Reinstall or rebuild the helper binary.
    Reinstall,
    /// Not recoverable on current hardware/OS; don't offer retry.
    None,
}

pub struct AppCore {
    pub config: AppConfig,
    pub store: Arc<SqliteEventStore>,
    pub projector: Projector,
    pub orchestrator: Arc<dyn Orchestrator>,
    pub audit: Arc<dyn AuditLog>,
    pub gate: Arc<InMemoryApprovalGate<SqliteEventStore>>,
    pub cost: CostTracker<SqliteEventStore>,
    pub helper: Arc<dyn FoundationHelper>,
    pub local_ops: Arc<dyn LocalOps>,
    pub helper_status: HelperStatus,
    /// When the helper is live, an existing `broadcast::Sender` forwards
    /// `HelperEvent`s from the supervisor. `None` when the NullHelper is
    /// active (there's nothing to transition). 13.F subscribes via
    /// `AppCore::subscribe_helper_events()`.
    helper_events: Option<broadcast::Sender<HelperEvent>>,
}

#[async_trait]
pub trait AppCoreBoot {
    async fn boot(config: AppConfig) -> designer_core::Result<Arc<AppCore>>;
}

/// Boot deadline for the helper's first ping. Accommodates a cold Swift process
/// start + Foundation Models session warm-up without being so loose that boot
/// hangs visibly when the helper is actually broken.
const HELPER_BOOT_DEADLINE: Duration = Duration::from_millis(750);

#[async_trait]
impl AppCoreBoot for AppCore {
    async fn boot(config: AppConfig) -> designer_core::Result<Arc<AppCore>> {
        let store = Arc::new(SqliteEventStore::open(config.data_dir.join("events.db"))?);
        let projector = Projector::new();

        // Replay history into the projector before live events.
        let history = store.read_all(StreamOptions::default()).await?;
        projector.replay(&history);

        let orchestrator: Arc<dyn Orchestrator> = if config.use_mock_orchestrator {
            Arc::new(MockOrchestrator::new(store.clone()))
        } else {
            Arc::new(ClaudeCodeOrchestrator::new(
                store.clone(),
                config.claude_options.clone(),
            ))
        };

        let audit: Arc<dyn AuditLog> = Arc::new(SqliteAuditLog::new(store.clone()));
        let gate = Arc::new(InMemoryApprovalGate::new(store.clone()));
        let cost = CostTracker::new(store.clone(), config.default_cost_cap);

        let (helper, helper_status, helper_events) = select_helper(&config).await;
        let local_ops: Arc<dyn LocalOps> = Arc::new(FoundationLocalOps::new(helper.clone()));

        let core = Arc::new(AppCore {
            config,
            store,
            projector,
            orchestrator,
            audit,
            gate,
            cost,
            helper,
            local_ops,
            helper_status,
            helper_events,
        });
        core.spawn_projector_task();
        info!("app core booted");
        Ok(core)
    }
}

/// Decide between `SwiftFoundationHelper` and `NullHelper` based on env,
/// config, and a bounded boot-time ping. Returns the chosen helper, a
/// structured status for IPC/diagnostics, and (for live helpers) a broadcast
/// `Sender` so 13.F consumers can subscribe to state transitions.
pub async fn select_helper(
    config: &AppConfig,
) -> (
    Arc<dyn FoundationHelper>,
    HelperStatus,
    Option<broadcast::Sender<HelperEvent>>,
) {
    if std::env::var("DESIGNER_DISABLE_HELPER").ok().as_deref() == Some("1") {
        warn!(target: "local_models", "helper disabled via DESIGNER_DISABLE_HELPER");
        return (
            Arc::new(NullHelper::default()),
            HelperStatus {
                kind: HelperStatusKind::Fallback,
                fallback_reason: Some(FallbackReason::UserDisabled),
                binary_path: config.helper_binary_path.clone(),
                version: None,
                model: None,
            },
            None,
        );
    }

    let Some(path) = config.helper_binary_path.clone() else {
        return (
            Arc::new(NullHelper::default()),
            HelperStatus {
                kind: HelperStatusKind::Fallback,
                fallback_reason: Some(FallbackReason::NotConfigured),
                binary_path: None,
                version: None,
                model: None,
            },
            None,
        );
    };

    if !path.is_file() {
        warn!(
            target: "local_models",
            binary = %path.display(),
            "helper binary missing; using NullHelper"
        );
        return (
            Arc::new(NullHelper::default()),
            HelperStatus {
                kind: HelperStatusKind::Fallback,
                fallback_reason: Some(FallbackReason::BinaryMissing { path: path.clone() }),
                binary_path: Some(path),
                version: None,
                model: None,
            },
            None,
        );
    }

    let live = Arc::new(SwiftFoundationHelper::new(path.clone()));
    let events = live.subscribe_events(); // take before we maybe discard the helper
                                          // We need the Sender side separately so we can hand a Sender to AppCore
                                          // for re-subscribe. The supervisor owns the only Sender, so bridge through
                                          // a small forwarding task.
    let bridge = build_event_bridge(events);

    let probe_helper_ref: Arc<dyn FoundationHelper> = live.clone();
    match probe_helper(probe_helper_ref, HELPER_BOOT_DEADLINE).await {
        Ok(_pretty) => {
            let health = live.health();
            (
                live,
                HelperStatus {
                    kind: HelperStatusKind::Live,
                    fallback_reason: None,
                    binary_path: Some(path),
                    version: health.version,
                    model: health.model,
                },
                Some(bridge),
            )
        }
        Err(e) => {
            let reason = fallback_reason_from_probe_error(&e);
            warn!(
                target: "local_models",
                binary = %path.display(),
                error = %e,
                ?reason,
                "helper boot probe failed; using NullHelper"
            );
            (
                Arc::new(NullHelper::default()),
                HelperStatus {
                    kind: HelperStatusKind::Fallback,
                    fallback_reason: Some(reason),
                    binary_path: Some(path),
                    version: None,
                    model: None,
                },
                None,
            )
        }
    }
}

/// Pure mapping from a probe error to a `FallbackReason`. Discriminates on
/// `HelperError` variants (not error-message substring) so changing a format
/// string can't silently reroute. The one place we still string-match is on
/// `Reported`, where the helper emits documented machine tags
/// (`"macos-too-old"`, `"foundation-models-unavailable"`) as its contract.
pub fn fallback_reason_from_probe_error(e: &HelperError) -> FallbackReason {
    match e {
        HelperError::Timeout(_) => FallbackReason::PingTimeout,
        HelperError::Reported(msg) if msg == "macos-too-old" => FallbackReason::UnsupportedOs,
        HelperError::Reported(msg) if msg == "foundation-models-unavailable" => {
            FallbackReason::ModelsUnavailable
        }
        other => FallbackReason::PingFailed {
            error: other.to_string(),
        },
    }
}

/// Turn a `broadcast::Receiver` from the supervisor into a `broadcast::Sender`
/// that AppCore can hand out fresh receivers from. We could expose the
/// supervisor's own `Sender` directly, but that leaks the helper's internal
/// channel and ties AppCore to `SwiftFoundationHelper` instead of
/// `Arc<dyn FoundationHelper>`. The forwarding task costs one tokio spawn
/// per AppCore boot, which is negligible.
fn build_event_bridge(mut rx: broadcast::Receiver<HelperEvent>) -> broadcast::Sender<HelperEvent> {
    let (tx, _) = broadcast::channel(32);
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let _ = tx_clone.send(ev);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    tx
}

impl AppCore {
    fn spawn_projector_task(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            let mut rx = me.store.subscribe();
            while let Ok(event) = rx.recv().await {
                me.projector.apply(&event);
            }
        });
    }

    /// Runtime snapshot of the local-model helper. Combines the boot-time
    /// selection (kind + fallback reason) with live supervisor state
    /// (consecutive failures, last restart). Cheap; intended for an IPC poll.
    pub fn helper_health(&self) -> (HelperStatus, HelperHealth) {
        (self.helper_status.clone(), self.helper.health())
    }

    /// Subscribe to helper state-transition events. Returns `None` when the
    /// NullHelper is active — no transitions are possible. Subscribers that
    /// fall behind see `broadcast::error::RecvError::Lagged` and should
    /// re-read `helper_health()` to resync.
    pub fn subscribe_helper_events(&self) -> Option<broadcast::Receiver<HelperEvent>> {
        self.helper_events.as_ref().map(|tx| tx.subscribe())
    }

    pub async fn create_project(
        &self,
        name: String,
        root_path: PathBuf,
    ) -> designer_core::Result<designer_core::Project> {
        let id = ProjectId::new();
        let env = self
            .store
            .append(
                StreamId::Project(id),
                None,
                Actor::user(),
                EventPayload::ProjectCreated {
                    project_id: id,
                    name,
                    root_path,
                },
            )
            .await?;
        // Apply synchronously so the caller's subsequent read sees the write,
        // independent of the broadcast-subscriber task scheduling.
        self.projector.apply(&env);
        self.projector
            .project(id)
            .ok_or_else(|| designer_core::CoreError::NotFound(id.to_string()))
    }

    pub async fn create_workspace(
        &self,
        project_id: ProjectId,
        name: String,
        base_branch: String,
    ) -> designer_core::Result<Workspace> {
        let id = WorkspaceId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(id),
                None,
                Actor::user(),
                EventPayload::WorkspaceCreated {
                    workspace_id: id,
                    project_id,
                    name,
                    base_branch,
                },
            )
            .await?;
        self.projector.apply(&env);
        self.projector
            .workspace(id)
            .ok_or_else(|| designer_core::CoreError::NotFound(id.to_string()))
    }

    pub async fn list_projects(&self) -> Vec<designer_core::Project> {
        self.projector.projects()
    }

    pub async fn workspaces_in(&self, project_id: ProjectId) -> Vec<Workspace> {
        self.projector.workspaces_in(project_id)
    }

    pub async fn open_tab(
        &self,
        workspace_id: WorkspaceId,
        title: String,
        template: TabTemplate,
    ) -> designer_core::Result<Tab> {
        let tab_id = TabId::new();
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::TabOpened {
                    tab_id,
                    workspace_id,
                    title,
                    template,
                },
            )
            .await?;
        self.projector.apply(&env);
        let workspace = self
            .projector
            .workspace(workspace_id)
            .ok_or_else(|| designer_core::CoreError::NotFound(workspace_id.to_string()))?;
        workspace
            .tabs
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| designer_core::CoreError::NotFound(tab_id.to_string()))
    }

    /// Derive an activity-spine view from the projector. Summaries are `None`
    /// here; Phase 13.F replaces them with `LocalOps::summarize_row` output.
    pub async fn spine(&self, workspace_id: Option<WorkspaceId>) -> Vec<SpineRow> {
        match workspace_id {
            None => self
                .projector
                .projects()
                .into_iter()
                .map(|p| {
                    let count = self.projector.workspaces_in(p.id).len();
                    SpineRow {
                        id: p.id.to_string(),
                        altitude: SpineAltitude::Project,
                        label: p.name,
                        summary: Some(format!(
                            "{count} workspace{}",
                            if count == 1 { "" } else { "s" }
                        )),
                        state: SpineState::Idle,
                        children: vec![],
                    }
                })
                .collect(),
            Some(id) => {
                // Workspace-altitude view: one row per agent is Phase-13 territory;
                // until then, return a single placeholder row keyed to the
                // workspace itself so the surface renders without stubs.
                let Some(w) = self.projector.workspace(id) else {
                    return vec![];
                };
                vec![SpineRow {
                    id: w.id.to_string(),
                    altitude: SpineAltitude::Workspace,
                    label: w.name,
                    summary: Some(format!("state: {:?}", w.state).to_lowercase()),
                    state: match w.state {
                        designer_core::WorkspaceState::Active => SpineState::Active,
                        designer_core::WorkspaceState::Paused => SpineState::Idle,
                        designer_core::WorkspaceState::Archived => SpineState::Idle,
                        designer_core::WorkspaceState::Errored => SpineState::Errored,
                    },
                    children: vec![],
                }]
            }
        }
    }

    /// Full replay — used when an external writer (tests, repair tools) modifies
    /// the log outside `AppCore`. In the steady state, `apply` on each append
    /// keeps the projector current without touching the log.
    pub async fn sync_projector_from_log(&self) -> designer_core::Result<()> {
        let all = self.store.read_all(StreamOptions::default()).await?;
        self.projector.replay(&all);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_safety::CostCap;
    use tempfile::tempdir;

    async fn boot_test_core() -> Arc<AppCore> {
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            // Force NullHelper in tests — no accidental dependency on a local
            // Swift build. The helper-selection path is exercised directly in
            // the two pure tests below.
            helper_binary_path: None,
        };
        // Leak the tempdir so the path stays live for the core's lifetime.
        std::mem::forget(dir);
        AppCore::boot(config).await.unwrap()
    }

    #[test]
    fn fallback_reason_maps_from_helper_error() {
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Timeout(Duration::from_millis(100))),
            FallbackReason::PingTimeout
        ));
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Reported("macos-too-old".into())),
            FallbackReason::UnsupportedOs
        ));
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Reported(
                "foundation-models-unavailable".into(),
            )),
            FallbackReason::ModelsUnavailable
        ));
        match fallback_reason_from_probe_error(&HelperError::Reported("other-error".into())) {
            FallbackReason::PingFailed { error } => assert!(error.contains("other-error")),
            other => panic!("expected PingFailed, got {other:?}"),
        }
        assert!(matches!(
            fallback_reason_from_probe_error(&HelperError::Spawn("nope".into())),
            FallbackReason::PingFailed { .. }
        ));
    }

    #[test]
    fn recovery_kind_matches_taxonomy() {
        assert_eq!(FallbackReason::UserDisabled.recovery(), RecoveryKind::User);
        assert_eq!(
            FallbackReason::NotConfigured.recovery(),
            RecoveryKind::Reinstall
        );
        assert_eq!(
            FallbackReason::BinaryMissing {
                path: PathBuf::from("/missing")
            }
            .recovery(),
            RecoveryKind::Reinstall
        );
        assert_eq!(
            FallbackReason::PingTimeout.recovery(),
            RecoveryKind::Reinstall
        );
        assert_eq!(FallbackReason::UnsupportedOs.recovery(), RecoveryKind::None);
        assert_eq!(
            FallbackReason::ModelsUnavailable.recovery(),
            RecoveryKind::None
        );
        assert_eq!(
            FallbackReason::PingFailed { error: "x".into() }.recovery(),
            RecoveryKind::Reinstall
        );
    }

    #[tokio::test]
    async fn open_tab_appends_and_projects() {
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab = core
            .open_tab(ws.id, "Plan".into(), TabTemplate::Plan)
            .await
            .unwrap();
        assert_eq!(tab.title, "Plan");
        let refreshed = core.projector.workspace(ws.id).unwrap();
        assert_eq!(refreshed.tabs.len(), 1);
        assert_eq!(refreshed.tabs[0].id, tab.id);
    }

    #[tokio::test]
    async fn spine_project_altitude_counts_workspaces() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let _ = core
            .create_workspace(p.id, "a".into(), "main".into())
            .await
            .unwrap();
        let _ = core
            .create_workspace(p.id, "b".into(), "main".into())
            .await
            .unwrap();

        let rows = core.spine(None).await;
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.altitude, SpineAltitude::Project);
        assert_eq!(row.label, "P");
        assert_eq!(row.summary.as_deref(), Some("2 workspaces"));
    }

    #[tokio::test]
    async fn spine_workspace_altitude_maps_state() {
        let core = boot_test_core().await;
        let p = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let w = core
            .create_workspace(p.id, "ws".into(), "main".into())
            .await
            .unwrap();

        let rows = core.spine(Some(w.id)).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].altitude, SpineAltitude::Workspace);
        // Default WorkspaceState::Active maps to SpineState::Active.
        assert!(matches!(rows[0].state, SpineState::Active));
    }

    #[tokio::test]
    async fn spine_unknown_workspace_returns_empty() {
        let core = boot_test_core().await;
        let rows = core.spine(Some(WorkspaceId::new())).await;
        assert!(rows.is_empty());
    }
}
