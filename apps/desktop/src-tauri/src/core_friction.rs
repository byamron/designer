//! Friction (Tracks 13.K + 13.L) — internal feedback capture.
//!
//! 13.L is local-first: friction records persist as
//! `<repo>/.designer/friction/<id>.md` (markdown body) plus an optional
//! `<repo>/.designer/friction/<id>.png` sidecar. When no repo is linked
//! the records fall back to `<data_dir>/friction/<id>.{md,png}` so capture
//! still works pre-link. There is no GitHub round-trip — `gh gist` and
//! `gh issue` were dropped along with the `GhRunner` trait, the background
//! filer task, and `IpcError::ExternalToolFailed`.
//!
//! State machine (projected from the event stream):
//!
//!   FrictionReported              → Open
//!   + FrictionAddressed { pr }    → Addressed
//!   + FrictionResolved            → Resolved
//!   + FrictionReopened            → Open
//!
//! Legacy 13.K records (`FrictionLinked { github_issue_url }`) decode via
//! the deprecated variant and project as `Addressed { pr_url: None }`.
//! `FrictionFileFailed` records similarly decode but no longer alter
//! state — they were only meaningful while the gh filer existed.

use crate::core::AppCore;
use designer_core::{
    Actor, Anchor, EventPayload, EventStore, FrictionId, Projection, ScreenshotRef, StreamId,
    StreamOptions, WorkspaceId,
};
use designer_ipc::{
    FrictionEntry, FrictionState, IpcError, ReportFrictionRequest, ReportFrictionResponse,
};
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Hard cap for screenshot bytes accepted by `cmd_report_friction`. Larger
/// payloads are rejected at the IPC boundary so the frontend can't bloat
/// the event store. 25MB is generous — actual screenshots are ≪1MB.
const SCREENSHOT_BYTE_CAP: usize = 25 * 1024 * 1024;

/// Decide where the friction events should live. Workspace-scoped if the
/// user is in a workspace; otherwise the system stream.
fn stream_for(req: &ReportFrictionRequest) -> StreamId {
    match req.workspace_id {
        Some(ws) => StreamId::Workspace(ws),
        None => StreamId::System,
    }
}

fn synthesize_title(anchor: &Anchor, body: &str) -> String {
    let descriptor = anchor.descriptor();
    let trimmed: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let head = if trimmed.chars().count() > 60 {
        let cut: String = trimmed.chars().take(59).collect();
        format!("{cut}…")
    } else {
        trimmed
    };
    if head.is_empty() {
        descriptor
    } else {
        format!("{descriptor}: {head}")
    }
}

/// Resolve the directory friction records live in. Prefers the linked
/// workspace's repo (`<repo>/.designer/friction/`); falls back to
/// `<data_dir>/friction/` when no repo is linked or no workspace is set.
fn records_dir_for(core: &AppCore, req: &ReportFrictionRequest) -> PathBuf {
    if let Some(ws_id) = req.workspace_id {
        if let Some(ws) = core.projector.workspace(ws_id) {
            if let Some(repo) = ws.worktree_path {
                return repo.join(".designer").join("friction");
            }
        }
    }
    core.config.data_dir.join("friction")
}

/// Markdown record for a friction entry. Single source of truth on disk;
/// the event store keeps the same fields but the markdown is the artifact
/// the user opens directly via the row's "Open file" action.
fn render_record(
    friction_id: FrictionId,
    title: &str,
    body: &str,
    anchor: &Anchor,
    route: &str,
    app_version: &str,
    screenshot_path: Option<&Path>,
) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {title}\n\n"));
    md.push_str(&format!("- friction_id: `{friction_id}`\n"));
    md.push_str(&format!("- route: `{route}`\n"));
    md.push_str(&format!("- app_version: `{app_version}`\n"));
    md.push_str(&format!("- anchor: {}\n", anchor.descriptor()));
    if let Some(path) = screenshot_path {
        md.push_str(&format!("- screenshot: `{}`\n", path.display()));
    }
    md.push_str("\n## Body\n\n");
    md.push_str(body);
    md.push('\n');
    md
}

/// Owned bag of inputs for the spawn_blocking write task. Lifted out
/// of `report_friction` to keep the closure capture explicit.
struct WriteArgs {
    dir: PathBuf,
    record_path: PathBuf,
    screenshot_path: Option<PathBuf>,
    screenshot_bytes: Option<Vec<u8>>,
    markdown: String,
}

fn write_record_to_disk(args: WriteArgs) -> std::io::Result<Option<ScreenshotRef>> {
    std::fs::create_dir_all(&args.dir)?;
    let sref = match (args.screenshot_bytes, args.screenshot_path) {
        (Some(bytes), Some(path)) => {
            let sha = hex::encode(Sha256::digest(&bytes));
            std::fs::write(&path, &bytes)?;
            Some(ScreenshotRef::Local { path, sha256: sha })
        }
        _ => None,
    };
    std::fs::write(&args.record_path, args.markdown)?;
    Ok(sref)
}

impl AppCore {
    /// Persist a friction record locally and emit `FrictionReported`.
    /// Returns once the markdown + optional screenshot are durable on
    /// disk; the event projection follows synchronously. No background
    /// network work.
    pub async fn report_friction(
        &self,
        mut req: ReportFrictionRequest,
    ) -> Result<ReportFrictionResponse, IpcError> {
        if req.body.trim().is_empty() {
            return Err(IpcError::invalid_request("body must not be empty"));
        }
        if let Some(bytes) = req.screenshot_data.as_ref() {
            if bytes.len() > SCREENSHOT_BYTE_CAP {
                return Err(IpcError::invalid_request(format!(
                    "screenshot exceeds {}MB cap",
                    SCREENSHOT_BYTE_CAP / 1024 / 1024
                )));
            }
        }

        let friction_id = FrictionId::new();
        let title = synthesize_title(&req.anchor, &req.body);
        let app_version = env!("CARGO_PKG_VERSION").to_string();

        let dir = records_dir_for(self, &req);
        let record_path = dir.join(format!("{friction_id}.md"));
        let screenshot_path = req
            .screenshot_data
            .as_ref()
            .map(|_| dir.join(format!("{friction_id}.png")));
        let bytes = req.screenshot_data.take();

        // The markdown is CPU-cheap; render it on the async runtime
        // before handing the I/O off to spawn_blocking. Keeps the
        // closure's capture set down to (dir, record_path, screenshot
        // path + bytes, rendered md) instead of every render-input.
        let md = render_record(
            friction_id,
            &title,
            &req.body,
            &req.anchor,
            &req.route,
            &app_version,
            screenshot_path.as_deref(),
        );

        // spawn_blocking carries the multi-MB hash + write so a slow
        // disk doesn't park a tokio worker for tens of milliseconds.
        let write_args = WriteArgs {
            dir,
            record_path: record_path.clone(),
            screenshot_path,
            screenshot_bytes: bytes,
            markdown: md,
        };
        let screenshot_ref = tokio::task::spawn_blocking(move || write_record_to_disk(write_args))
            .await
            .map_err(|e| IpcError::unknown(format!("record write task: {e}")))?
            .map_err(|e| IpcError::unknown(format!("record write: {e}")))?;

        let stream = stream_for(&req);
        let append_result = self
            .store
            .append(
                stream,
                None,
                Actor::user(),
                EventPayload::FrictionReported {
                    friction_id,
                    workspace_id: req.workspace_id,
                    project_id: req.project_id,
                    anchor: req.anchor.clone(),
                    body: req.body.clone(),
                    screenshot_ref: screenshot_ref.clone(),
                    route: req.route.clone(),
                    app_version,
                    claude_version: None,
                    last_user_actions: Vec::new(),
                    // Legacy field — 13.L always emits `false`. Kept on the
                    // event payload for replay compatibility with 13.K
                    // records.
                    file_to_github: false,
                    local_path: Some(record_path.clone()),
                },
            )
            .await;
        match append_result {
            Ok(env) => {
                self.projector.apply(&env);
                Ok(ReportFrictionResponse {
                    friction_id,
                    local_path: record_path,
                })
            }
            Err(err) => {
                // Append failed — best-effort cleanup of the on-disk
                // record so the event store stays the source of truth.
                // Failure to remove is logged but not propagated; the
                // user already sees the append error.
                let _ = std::fs::remove_file(&record_path);
                if let Some(ScreenshotRef::Local { path, .. }) = screenshot_ref.as_ref() {
                    let _ = std::fs::remove_file(path);
                }
                Err(IpcError::from(err))
            }
        }
    }

    /// Project the friction event stream into a list of triage entries.
    /// Read-only; safe to call from any thread. Sort is most-recent-first
    /// (by event timestamp of the originating `FrictionReported`).
    pub async fn list_friction(&self) -> Result<Vec<FrictionEntry>, IpcError> {
        let events = self
            .store
            .read_all(StreamOptions::default())
            .await
            .map_err(IpcError::from)?;
        Ok(project_friction(events.iter()))
    }

    /// Mark a friction record `Addressed`. Optional `pr_url` records the
    /// fix's PR. The caller passes `workspace_id` from the projected
    /// `FrictionEntry` so the backend doesn't have to re-scan the event
    /// log to locate the originating stream — at 100k events that scan
    /// would dominate click latency.
    pub async fn address_friction(
        &self,
        id: FrictionId,
        workspace_id: Option<WorkspaceId>,
        pr_url: Option<String>,
    ) -> Result<(), IpcError> {
        self.append_friction_event(
            workspace_id,
            EventPayload::FrictionAddressed {
                friction_id: id,
                pr_url,
            },
        )
        .await
    }

    pub async fn resolve_friction(
        &self,
        id: FrictionId,
        workspace_id: Option<WorkspaceId>,
    ) -> Result<(), IpcError> {
        self.append_friction_event(
            workspace_id,
            EventPayload::FrictionResolved { friction_id: id },
        )
        .await
    }

    pub async fn reopen_friction(
        &self,
        id: FrictionId,
        workspace_id: Option<WorkspaceId>,
    ) -> Result<(), IpcError> {
        self.append_friction_event(
            workspace_id,
            EventPayload::FrictionReopened { friction_id: id },
        )
        .await
    }

    async fn append_friction_event(
        &self,
        workspace_id: Option<WorkspaceId>,
        payload: EventPayload,
    ) -> Result<(), IpcError> {
        let stream = workspace_id
            .map(StreamId::Workspace)
            .unwrap_or(StreamId::System);
        let env = self
            .store
            .append(stream, None, Actor::user(), payload)
            .await
            .map_err(IpcError::from)?;
        self.projector.apply(&env);
        Ok(())
    }
}

/// Reduce a sequence of events into a list of `FrictionEntry`. Pure
/// function; unit-tested below. Output order is most-recent-first (by the
/// timestamp of each entry's originating `FrictionReported`).
pub fn project_friction<'a, I>(events: I) -> Vec<FrictionEntry>
where
    I: IntoIterator<Item = &'a designer_core::EventEnvelope>,
{
    let mut by_id: HashMap<FrictionId, FrictionEntry> = HashMap::new();
    let mut order: Vec<FrictionId> = Vec::new();
    for env in events {
        match &env.payload {
            EventPayload::FrictionReported {
                friction_id,
                workspace_id,
                project_id,
                anchor,
                body,
                screenshot_ref,
                route,
                local_path,
                ..
            } => {
                if !by_id.contains_key(friction_id) {
                    order.push(*friction_id);
                }
                let title = synthesize_title(anchor, body);
                let entry = FrictionEntry {
                    friction_id: *friction_id,
                    workspace_id: *workspace_id,
                    project_id: *project_id,
                    created_at: designer_core::rfc3339(env.timestamp),
                    body: body.clone(),
                    route: route.clone(),
                    title,
                    anchor_descriptor: anchor.descriptor(),
                    state: FrictionState::Open,
                    pr_url: None,
                    screenshot_path: match screenshot_ref {
                        Some(ScreenshotRef::Local { path, .. }) => Some(path.clone()),
                        _ => None,
                    },
                    // Field added in 13.L; legacy 13.K records have `None`
                    // and the FE gates the "Open file" action accordingly.
                    local_path: local_path.clone().unwrap_or_default(),
                };
                by_id.insert(*friction_id, entry);
            }
            EventPayload::FrictionAddressed {
                friction_id,
                pr_url,
            } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    e.state = FrictionState::Addressed;
                    e.pr_url = pr_url.clone();
                }
            }
            EventPayload::FrictionResolved { friction_id } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    e.state = FrictionState::Resolved;
                }
            }
            EventPayload::FrictionReopened { friction_id } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    e.state = FrictionState::Open;
                }
            }
            // Legacy 13.K record — projects as Addressed with no PR url.
            // Don't overwrite a later 13.L `FrictionAddressed { pr_url:
            // Some(_) }` since that arrived after, but a bare
            // `FrictionLinked` is still meaningful as a state transition
            // and as an empty-`pr_url` fallback.
            #[allow(deprecated)]
            EventPayload::FrictionLinked { friction_id, .. } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    e.state = FrictionState::Addressed;
                }
            }
            // Legacy 13.K record — has no semantic meaning post-13.L. The
            // gh filer that produced it is gone; treat it as a no-op so
            // old `events.db` files replay without a phantom state.
            #[allow(deprecated)]
            EventPayload::FrictionFileFailed { .. } => {}
            _ => {}
        }
    }
    let mut entries: Vec<FrictionEntry> = order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect();
    // Most-recent-first: sort by `created_at` descending. RFC3339 strings
    // sort lexicographically in time order so a string compare is fine.
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    entries
}

/// Append a single `.designer/friction/` ignore line to `<repo>/.gitignore`
/// when not already listed. Idempotent: a no-op if the entry exists.
/// Best-effort — failing to write is logged, not propagated, because it
/// must never block `link_repo`.
///
/// The read+write is serialized via a process-global mutex so two
/// concurrent `link_repo` calls on the same repo can't both observe the
/// "needle missing" state and both append a duplicate line.
pub fn ensure_friction_gitignore(repo_root: &Path) {
    static GITIGNORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = GITIGNORE_LOCK.get_or_init(|| Mutex::new(())).lock();

    let gitignore = repo_root.join(".gitignore");
    let needle = ".designer/friction/";
    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
    if existing
        .lines()
        .any(|line| line.trim() == needle || line.trim() == ".designer/friction")
    {
        return;
    }
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    if next.is_empty() {
        next.push_str("# Designer — local friction records (drop this line to commit them).\n");
    }
    next.push_str(needle);
    next.push('\n');
    if let Err(err) = std::fs::write(&gitignore, next) {
        tracing::warn!(
            error = %err,
            path = %gitignore.display(),
            "could not write .gitignore for friction records"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::Anchor;
    use tempfile::tempdir;

    fn dom_anchor() -> Anchor {
        Anchor::DomElement {
            selector_path: "[data-component=\"WorkspaceSidebar\"]".into(),
            route: "/workspace/x".into(),
            component: Some("WorkspaceSidebar".into()),
            stable_id: None,
            text_snippet: Some("Track A".into()),
        }
    }

    async fn boot() -> (std::sync::Arc<AppCore>, tempfile::TempDir) {
        use crate::core::{AppConfig, AppCoreBoot};
        use designer_safety::CostCap;
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        let core = AppCore::boot(config).await.unwrap();
        (core, dir)
    }

    #[tokio::test]
    async fn report_friction_writes_record_and_emits_event() {
        let (core, _dir) = boot().await;
        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "row layout looks off when collapsed".into(),
            screenshot_data: Some(b"fakepng".to_vec()),
            screenshot_filename: Some("paste.png".into()),
            workspace_id: None,
            project_id: None,
            route: "/workspace/x".into(),
        };
        let resp = core.report_friction(req).await.expect("ok");
        assert!(resp.local_path.exists(), "markdown record on disk");
        assert!(resp
            .local_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".md"));
        let png = resp.local_path.with_extension("png");
        assert!(png.exists(), "PNG sidecar lives next to the markdown");

        let events = core.store.read_all(StreamOptions::default()).await.unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e.payload, EventPayload::FrictionReported { .. }))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn report_friction_lands_under_repo_when_workspace_linked() {
        use std::process::Command;
        let (core, _data) = boot().await;
        let project = core
            .create_project("P".into(), std::env::temp_dir())
            .await
            .unwrap();
        let workspace = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        // Stand up a real git repo so `link_repo` accepts it.
        let repo_dir = tempdir().unwrap();
        Command::new("git")
            .args(["init", "-q"])
            .current_dir(repo_dir.path())
            .status()
            .unwrap();
        core.link_repo(workspace.id, repo_dir.path().to_path_buf())
            .await
            .unwrap();

        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "anchored to the linked repo".into(),
            screenshot_data: Some(b"png".to_vec()),
            screenshot_filename: None,
            workspace_id: Some(workspace.id),
            project_id: Some(project.id),
            route: "/workspace/x".into(),
        };
        let resp = core.report_friction(req).await.unwrap();
        let canonical_repo = std::fs::canonicalize(repo_dir.path()).unwrap();
        let canonical_record = std::fs::canonicalize(&resp.local_path).unwrap();
        assert!(
            canonical_record.starts_with(canonical_repo.join(".designer").join("friction")),
            "record lands under <repo>/.designer/friction (got {})",
            canonical_record.display()
        );
    }

    #[tokio::test]
    async fn empty_body_rejected() {
        let (core, _dir) = boot().await;
        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "  \n".into(),
            screenshot_data: None,
            screenshot_filename: None,
            workspace_id: None,
            project_id: None,
            route: "/r".into(),
        };
        let err = core.report_friction(req).await.expect_err("rejected");
        assert!(matches!(err, IpcError::InvalidRequest { .. }));
    }

    #[tokio::test]
    async fn address_round_trips_pr_url_through_projection() {
        let (core, _dir) = boot().await;
        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "the PR url survives serde".into(),
            screenshot_data: None,
            screenshot_filename: None,
            workspace_id: None,
            project_id: None,
            route: "/r".into(),
        };
        let resp = core.report_friction(req).await.unwrap();
        core.address_friction(
            resp.friction_id,
            None,
            Some("https://github.com/x/y/pull/9".into()),
        )
        .await
        .unwrap();
        let entries = core.list_friction().await.unwrap();
        let entry = entries
            .iter()
            .find(|e| e.friction_id == resp.friction_id)
            .unwrap();
        assert_eq!(entry.state, FrictionState::Addressed);
        assert_eq!(
            entry.pr_url.as_deref(),
            Some("https://github.com/x/y/pull/9")
        );
    }

    #[tokio::test]
    async fn state_machine_transitions_open_addressed_resolved_reopen() {
        let (core, _dir) = boot().await;
        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "state machine checks out".into(),
            screenshot_data: None,
            screenshot_filename: None,
            workspace_id: None,
            project_id: None,
            route: "/r".into(),
        };
        let resp = core.report_friction(req).await.unwrap();
        let id = resp.friction_id;

        // Open by default.
        let state =
            |entries: &[FrictionEntry]| entries.iter().find(|e| e.friction_id == id).unwrap().state;
        assert_eq!(
            state(&core.list_friction().await.unwrap()),
            FrictionState::Open
        );

        core.address_friction(id, None, None).await.unwrap();
        assert_eq!(
            state(&core.list_friction().await.unwrap()),
            FrictionState::Addressed
        );

        core.resolve_friction(id, None).await.unwrap();
        assert_eq!(
            state(&core.list_friction().await.unwrap()),
            FrictionState::Resolved
        );

        core.reopen_friction(id, None).await.unwrap();
        assert_eq!(
            state(&core.list_friction().await.unwrap()),
            FrictionState::Open
        );
    }

    #[test]
    fn legacy_friction_linked_projects_as_addressed_with_no_pr() {
        use designer_core::{
            Actor, EventEnvelope, EventId, ProjectId, StreamId, Timestamp, WorkspaceId,
        };
        #[allow(deprecated)]
        let id_a = FrictionId::new();
        let ws = WorkspaceId::new();
        let _pid = ProjectId::new();

        let make = |seq: u64, payload: EventPayload| EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: seq,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            // Old fixture — written before the 13.L bump.
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        };

        #[allow(deprecated)]
        let events = [
            make(
                1,
                EventPayload::FrictionReported {
                    friction_id: id_a,
                    workspace_id: Some(ws),
                    project_id: None,
                    anchor: dom_anchor(),
                    body: "legacy".into(),
                    screenshot_ref: None,
                    route: "/r".into(),
                    app_version: "0.1.0".into(),
                    claude_version: None,
                    last_user_actions: vec![],
                    file_to_github: true,
                    local_path: None,
                },
            ),
            make(
                2,
                EventPayload::FrictionLinked {
                    friction_id: id_a,
                    github_issue_url: "https://github.com/x/y/issues/1".into(),
                },
            ),
        ];

        let entries = project_friction(events.iter());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].state, FrictionState::Addressed);
        assert!(entries[0].pr_url.is_none());
    }

    #[test]
    fn project_friction_orders_most_recent_first() {
        use designer_core::{Actor, EventEnvelope, EventId, StreamId, Timestamp, WorkspaceId};
        let ws = WorkspaceId::new();
        let id_old = FrictionId::new();
        let id_new = FrictionId::new();

        let make = |seq: u64, ts: Timestamp, payload: EventPayload| EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: seq,
            timestamp: ts,
            actor: Actor::user(),
            version: 2,
            causation_id: None,
            correlation_id: None,
            payload,
        };
        let report = |id, body: &str| EventPayload::FrictionReported {
            friction_id: id,
            workspace_id: Some(ws),
            project_id: None,
            anchor: dom_anchor(),
            body: body.into(),
            screenshot_ref: None,
            route: "/r".into(),
            app_version: "0.1.0".into(),
            claude_version: None,
            last_user_actions: vec![],
            file_to_github: false,
            local_path: None,
        };

        let t_old = Timestamp::UNIX_EPOCH;
        let t_new = Timestamp::UNIX_EPOCH + time::Duration::seconds(1_700_000_000);
        let events = [
            make(1, t_old, report(id_old, "old")),
            make(2, t_new, report(id_new, "new")),
        ];

        let entries = project_friction(events.iter());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].friction_id, id_new);
        assert_eq!(entries[1].friction_id, id_old);
    }

    #[test]
    fn synthesize_title_uses_descriptor_and_truncates_body() {
        let anchor = dom_anchor();
        let out = synthesize_title(&anchor, "the row layout breaks under collapse");
        assert_eq!(
            out,
            "WorkspaceSidebar: the row layout breaks under collapse"
        );
        let long = "x".repeat(120);
        let out = synthesize_title(&anchor, &long);
        assert!(out.ends_with("…"));
    }

    #[test]
    fn ensure_friction_gitignore_writes_and_is_idempotent() {
        let dir = tempdir().unwrap();
        ensure_friction_gitignore(dir.path());
        let first = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(first.contains(".designer/friction/"));
        // Second call must not append a duplicate line.
        ensure_friction_gitignore(dir.path());
        let second = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn ensure_friction_gitignore_preserves_existing_entries() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "node_modules\n.DS_Store\n").unwrap();
        ensure_friction_gitignore(dir.path());
        let content = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(content.contains("node_modules"));
        assert!(content.contains(".DS_Store"));
        assert!(content.contains(".designer/friction/"));
    }
}
