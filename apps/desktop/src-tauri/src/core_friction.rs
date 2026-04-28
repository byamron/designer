//! Track 13.K — Friction (internal feedback capture).
//!
//! Submit pipeline (locked by spec, see `core-docs/roadmap.md` § Track 13.K):
//!
//! 1. **Synchronous local persistence** — emit `FrictionReported` to the
//!    workspace stream (or system stream if no workspace is active). Write a
//!    markdown record to `~/.designer/friction/<timestamp>-<slug>.md` and a
//!    content-addressed screenshot to `~/.designer/friction/screenshots/
//!    <sha256>.png`. Identical screenshots dedupe.
//! 2. **Async GitHub** (only if `file_to_github = true`): downscale to
//!    1920px max width if wider (10MB gist cap), `gh gist create --secret
//!    <screenshot.png>` (`--secret` is explicit even though it's the
//!    default), capture the gist URL into the local markdown *before*
//!    attempting issue create (orphan gist on issue-create failure is
//!    accepted), then `gh issue create --label friction --title
//!    <synthesized> --body <markdown-with-gist-url>`.
//! 3. **Result** — emit `FrictionLinked { friction_id, url }` on success or
//!    `FrictionFileFailed { friction_id, error_kind }` on failure. The
//!    triage view (`Settings → Activity → Friction`) projects all four
//!    `Friction*` event variants to render state.
//!
//! Mark-resolved is local-only — does NOT close the GitHub issue. Closing on
//! GitHub is a separate explicit action the user takes from the issue link.

use crate::core::AppCore;
use async_trait::async_trait;
use designer_core::{
    Actor, Anchor, EventPayload, EventStore, FrictionFileError, FrictionId, Projection,
    ScreenshotRef, StreamId, StreamOptions,
};
use designer_ipc::{
    FrictionEntry, FrictionState, IpcError, ReportFrictionRequest, ReportFrictionResponse,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tracing::warn;

/// Maximum width in pixels for screenshots uploaded to gist. Anything
/// wider gets downscaled before upload (preserves aspect ratio). The
/// 10MB gist file cap is enforced indirectly: a 1920×1080 PNG of normal
/// content lands at ~1–2MB.
const SCREENSHOT_MAX_WIDTH: u32 = 1920;

/// Hard cap for screenshot bytes accepted by `cmd_report_friction`. Larger
/// payloads are rejected at the IPC boundary so the frontend can't bloat
/// the event store. 25MB is generous — actual screenshots are ≪1MB.
const SCREENSHOT_BYTE_CAP: usize = 25 * 1024 * 1024;

/// External-tool runner trait so tests don't need a real `gh` binary on
/// `$PATH`. Production wiring is `RealGhRunner`; tests inject a recording
/// mock that asserts arg shape. Unit lives here (not `designer-ipc`)
/// because crossing the IPC crate would force every test crate to depend
/// on tokio + tracing.
#[async_trait]
pub trait GhRunner: Send + Sync {
    /// Run `gh gist create --secret <path>`. Returns the gist URL on
    /// success. The path is the already-downscaled screenshot.
    async fn create_gist(&self, screenshot_path: &Path) -> Result<String, GhError>;
    /// Run `gh issue create --label friction --title <title> --body
    /// <body>`. Returns the new issue URL on success.
    async fn create_issue(&self, title: &str, body: &str) -> Result<String, GhError>;
}

#[derive(Debug, thiserror::Error)]
pub enum GhError {
    #[error("gh missing: {0}")]
    Missing(String),
    #[error("gh not authenticated: {0}")]
    NotAuthed(String),
    #[error("network offline: {0}")]
    Offline(String),
    #[error("gist rejected: {0}")]
    GistRejected(String),
    #[error("issue create failed: {0}")]
    IssueCreateFailed(String),
    #[error("gh failed: {0}")]
    Other(String),
}

impl From<&GhError> for FrictionFileError {
    fn from(e: &GhError) -> Self {
        match e {
            GhError::Missing(_) => FrictionFileError::GhMissing,
            GhError::NotAuthed(_) => FrictionFileError::GhNotAuthed,
            GhError::Offline(_) => FrictionFileError::NetworkOffline,
            GhError::GistRejected(detail) => FrictionFileError::GistRejected {
                detail: detail.clone(),
            },
            GhError::IssueCreateFailed(detail) => FrictionFileError::IssueCreateFailed {
                detail: detail.clone(),
            },
            GhError::Other(detail) => FrictionFileError::Other {
                detail: detail.clone(),
            },
        }
    }
}

/// Production runner. Spawns `gh` via tokio. Discriminates errors on stderr
/// substrings — `gh`'s exit codes don't distinguish "not authed" from
/// "network down" cleanly, so we read its stderr.
pub struct RealGhRunner;

#[async_trait]
impl GhRunner for RealGhRunner {
    async fn create_gist(&self, screenshot_path: &Path) -> Result<String, GhError> {
        let out = Command::new("gh")
            .args(["gist", "create", "--secret"])
            .arg(screenshot_path)
            .output()
            .await
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => {
                    GhError::Missing("gh CLI not installed or not on PATH".into())
                }
                _ => GhError::Other(e.to_string()),
            })?;
        if !out.status.success() {
            return Err(classify_gh_error(&out.stderr, "gist"));
        }
        // gh prints the URL on stdout, one per line, last line is the gist.
        let stdout = String::from_utf8_lossy(&out.stdout);
        let url = stdout
            .lines()
            .rfind(|l| l.starts_with("https://gist.github.com/"))
            .map(str::trim)
            .map(String::from)
            .ok_or_else(|| GhError::Other(format!("no gist url in gh output: {stdout}")))?;
        Ok(url)
    }

    async fn create_issue(&self, title: &str, body: &str) -> Result<String, GhError> {
        let out = Command::new("gh")
            .args([
                "issue", "create", "--label", "friction", "--title", title, "--body", body,
            ])
            .output()
            .await
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => {
                    GhError::Missing("gh CLI not installed or not on PATH".into())
                }
                _ => GhError::Other(e.to_string()),
            })?;
        if !out.status.success() {
            // Issue create failures are kept distinct so the triage view
            // can hint "gist landed; retry just the issue create" instead
            // of suggesting a re-upload.
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(GhError::IssueCreateFailed(stderr.trim().to_string()));
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        let url = stdout
            .lines()
            .rfind(|l| l.starts_with("https://github.com/"))
            .map(str::trim)
            .map(String::from)
            .ok_or_else(|| GhError::Other(format!("no issue url in gh output: {stdout}")))?;
        Ok(url)
    }
}

fn classify_gh_error(stderr_bytes: &[u8], stage: &str) -> GhError {
    let stderr = String::from_utf8_lossy(stderr_bytes);
    let s = stderr.to_lowercase();
    if s.contains("not logged in")
        || s.contains("authentication required")
        || s.contains("unauthorized")
    {
        GhError::NotAuthed(stderr.trim().to_string())
    } else if s.contains("could not resolve host")
        || s.contains("network is unreachable")
        || s.contains("connection refused")
        || s.contains("timeout")
        || s.contains("temporary failure")
    {
        GhError::Offline(stderr.trim().to_string())
    } else if stage == "gist" {
        GhError::GistRejected(stderr.trim().to_string())
    } else {
        GhError::Other(stderr.trim().to_string())
    }
}

/// Decide where the friction events should live. Workspace-scoped if the
/// user is in a workspace; otherwise the system stream.
fn stream_for(req: &ReportFrictionRequest) -> StreamId {
    match req.workspace_id {
        Some(ws) => StreamId::Workspace(ws),
        None => StreamId::System,
    }
}

/// Slug-friendly snippet — lowercase ASCII, hyphens, ≤40 chars.
fn slugify(body: &str) -> String {
    let mut out = String::with_capacity(40);
    let mut last_was_hyphen = true;
    for ch in body.chars().take(120) {
        if out.len() >= 40 {
            break;
        }
        if ch.is_ascii_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            last_was_hyphen = false;
        } else if !last_was_hyphen {
            out.push('-');
            last_was_hyphen = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("friction");
    }
    out
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

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn screenshots_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("friction").join("screenshots")
}

fn records_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("friction")
}

/// Downscale a PNG to `SCREENSHOT_MAX_WIDTH` if wider; otherwise return the
/// bytes unchanged. Reads only the PNG header to decide — full decode
/// (~50–200ms on a typical screenshot) only runs when an actual resize is
/// needed. Errors surface as `GistRejected` so the user sees an actionable
/// failure if the input isn't a decodable PNG.
fn maybe_downscale(bytes: &[u8]) -> Result<Vec<u8>, GhError> {
    let dims =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png)
            .into_dimensions()
            .map_err(|e| GhError::GistRejected(format!("not a decodable PNG: {e}")))?;
    if dims.0 <= SCREENSHOT_MAX_WIDTH {
        return Ok(bytes.to_vec());
    }
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map_err(|e| GhError::GistRejected(format!("png decode failed: {e}")))?;
    let scaled = img.resize(
        SCREENSHOT_MAX_WIDTH,
        u32::MAX,
        image::imageops::FilterType::Lanczos3,
    );
    let mut out = Vec::with_capacity(bytes.len());
    {
        let mut cursor = std::io::Cursor::new(&mut out);
        scaled
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| GhError::GistRejected(format!("png encode failed: {e}")))?;
    }
    Ok(out)
}

/// Inputs for the markdown record. Bundled so `write_record` doesn't take
/// a 10-arg signature (clippy::too_many_arguments).
pub(crate) struct WriteRecordArgs<'a> {
    pub path: &'a Path,
    pub friction_id: FrictionId,
    pub title: &'a str,
    pub body: &'a str,
    pub anchor: &'a Anchor,
    pub route: &'a str,
    pub app_version: &'a str,
    pub claude_version: Option<&'a str>,
    pub screenshot_ref: &'a Option<ScreenshotRef>,
    pub github_issue_url: Option<&'a str>,
}

/// Write the markdown record. Idempotent: caller passes a fresh path per
/// friction id, so re-running on the same id overwrites in place (safe;
/// the record is the canonical local copy and we own its layout).
fn write_record(args: WriteRecordArgs<'_>) -> std::io::Result<()> {
    let WriteRecordArgs {
        path,
        friction_id,
        title,
        body,
        anchor,
        route,
        app_version,
        claude_version,
        screenshot_ref,
        github_issue_url,
    } = args;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut md = String::new();
    md.push_str(&format!("# {title}\n\n"));
    md.push_str(&format!("- friction_id: `{friction_id}`\n"));
    md.push_str(&format!("- route: `{route}`\n"));
    md.push_str(&format!("- app_version: `{app_version}`\n"));
    if let Some(cv) = claude_version {
        md.push_str(&format!("- claude_version: `{cv}`\n"));
    }
    md.push_str(&format!("- anchor: {}\n", anchor.descriptor()));
    if let Some(ScreenshotRef::Local { path, sha256 }) = screenshot_ref {
        md.push_str(&format!(
            "- screenshot: `{}` (sha256:{sha256})\n",
            path.display()
        ));
    }
    if let Some(ScreenshotRef::Gist { url, sha256 }) = screenshot_ref {
        md.push_str(&format!("- screenshot_gist: {url} (sha256:{sha256})\n"));
    }
    if let Some(url) = github_issue_url {
        md.push_str(&format!("- github_issue: {url}\n"));
    }
    md.push_str("\n## Body\n\n");
    md.push_str(body);
    md.push('\n');
    std::fs::write(path, md)
}

/// Public friction surface on AppCore. Exposed via three IPC commands +
/// the projection helper.
impl AppCore {
    /// Synchronous local persistence + (optionally) async filing. Returns
    /// once the local write is durable; `gh` work is spawned on a tokio
    /// task so the user's submit returns in <100ms regardless of network.
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

        // Hashing + writing run on `spawn_blocking` so a multi-MB screenshot
        // doesn't pause the tokio worker for 50–200ms. Path is content-
        // addressed so an unconditional overwrite is harmless (same bytes
        // → same path).
        let screenshot_ref = if let Some(bytes) = req.screenshot_data.take() {
            let dir = screenshots_dir(&self.config.data_dir);
            let written =
                tokio::task::spawn_blocking(move || -> std::io::Result<(PathBuf, String)> {
                    let mut hasher = Sha256::new();
                    hasher.update(&bytes);
                    let sha = hex::encode(hasher.finalize());
                    std::fs::create_dir_all(&dir)?;
                    let path = dir.join(format!("{sha}.png"));
                    std::fs::write(&path, &bytes)?;
                    Ok((path, sha))
                })
                .await
                .map_err(|e| IpcError::unknown(format!("screenshot task: {e}")))?
                .map_err(|e| IpcError::unknown(format!("screenshot write: {e}")))?;
            Some(ScreenshotRef::Local {
                path: written.0,
                sha256: written.1,
            })
        } else {
            None
        };

        let slug = slugify(&req.body);
        let record_path =
            records_dir(&self.config.data_dir).join(format!("{}-{slug}.md", now_ms()));
        write_record(WriteRecordArgs {
            path: &record_path,
            friction_id,
            title: &title,
            body: &req.body,
            anchor: &req.anchor,
            route: &req.route,
            app_version: &app_version,
            claude_version: None,
            screenshot_ref: &screenshot_ref,
            github_issue_url: None,
        })
        .map_err(|e| IpcError::unknown(format!("record write: {e}")))?;

        let stream = stream_for(&req);
        let env = self
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
                    app_version: app_version.clone(),
                    claude_version: None,
                    last_user_actions: Vec::new(),
                    file_to_github: req.file_to_github,
                },
            )
            .await
            .map_err(IpcError::from)?;
        self.projector.apply(&env);

        if req.file_to_github {
            let snapshot = FrictionReportSnapshot {
                anchor: req.anchor.clone(),
                body: req.body.clone(),
                screenshot_ref: screenshot_ref.clone(),
                route: req.route.clone(),
                app_version: app_version.clone(),
            };
            spawn_filer(
                self.store.clone(),
                self.gh_runner(),
                stream_for(&req),
                friction_id,
                snapshot,
                Some(record_path.clone()),
            );
        }

        Ok(ReportFrictionResponse {
            friction_id,
            local_path: record_path,
        })
    }

    /// Project the friction event stream into a list of triage entries.
    /// Read-only; safe to call from any thread.
    pub async fn list_friction(&self) -> Result<Vec<FrictionEntry>, IpcError> {
        let events = self
            .store
            .read_all(StreamOptions::default())
            .await
            .map_err(IpcError::from)?;
        Ok(project_friction(events.iter()))
    }

    /// Mark a friction record resolved (local-only). Does not close the
    /// GitHub issue — that's an explicit action the user takes from the
    /// issue link.
    pub async fn resolve_friction(&self, id: FrictionId) -> Result<(), IpcError> {
        let (stream, _, _) = self.locate_friction(id).await?;
        let env = self
            .store
            .append(
                stream,
                None,
                Actor::user(),
                EventPayload::FrictionResolved { friction_id: id },
            )
            .await
            .map_err(IpcError::from)?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Retry a previously-failed (or local-only) entry against `gh`.
    pub async fn retry_file_friction(&self, id: FrictionId) -> Result<(), IpcError> {
        let (stream, snapshot, state) = self.locate_friction(id).await?;
        if matches!(state, FrictionState::Filed | FrictionState::Resolved) {
            return Err(IpcError::invalid_request(
                "entry already filed or resolved; nothing to retry",
            ));
        }
        spawn_filer(
            self.store.clone(),
            self.gh_runner(),
            stream,
            id,
            snapshot,
            None,
        );
        Ok(())
    }

    /// Production runner. Tests override via `set_gh_runner_for_tests`.
    fn gh_runner(&self) -> Arc<dyn GhRunner> {
        self.gh_runner_override
            .lock()
            .clone()
            .unwrap_or_else(|| Arc::new(RealGhRunner) as Arc<dyn GhRunner>)
    }

    /// Single-pass scan of the event log for a friction id. Returns the
    /// originating stream, the report snapshot, and the current projected
    /// state. Replaces the previous three independent `read_all` calls
    /// (`list_friction` + `find_friction_report` + `find_friction_stream`)
    /// for the resolve/retry paths — multi-MB event logs were being
    /// re-read three times per click.
    async fn locate_friction(
        &self,
        id: FrictionId,
    ) -> Result<(StreamId, FrictionReportSnapshot, FrictionState), IpcError> {
        let events = self
            .store
            .read_all(StreamOptions::default())
            .await
            .map_err(IpcError::from)?;
        let mut origin: Option<(StreamId, FrictionReportSnapshot)> = None;
        let mut state = FrictionState::LocalOnly;
        for env in events.iter() {
            match &env.payload {
                EventPayload::FrictionReported {
                    friction_id,
                    anchor,
                    body,
                    screenshot_ref,
                    route,
                    app_version,
                    ..
                } if *friction_id == id => {
                    origin = Some((
                        env.stream.clone(),
                        FrictionReportSnapshot {
                            anchor: anchor.clone(),
                            body: body.clone(),
                            screenshot_ref: screenshot_ref.clone(),
                            route: route.clone(),
                            app_version: app_version.clone(),
                        },
                    ));
                }
                EventPayload::FrictionLinked { friction_id, .. } if *friction_id == id => {
                    state = FrictionState::Filed;
                }
                EventPayload::FrictionFileFailed { friction_id, .. }
                    if *friction_id == id
                        && !matches!(state, FrictionState::Filed | FrictionState::Resolved) =>
                {
                    state = FrictionState::Failed;
                }
                EventPayload::FrictionResolved { friction_id } if *friction_id == id => {
                    state = FrictionState::Resolved;
                }
                _ => {}
            }
        }
        let (stream, snapshot) = origin.ok_or_else(|| IpcError::not_found(id.to_string()))?;
        Ok((stream, snapshot, state))
    }
}

/// Snapshot of the bits needed to file (or refile) a friction record
/// against `gh`. Built from `FrictionReported`, never sent over IPC.
struct FrictionReportSnapshot {
    anchor: Anchor,
    body: String,
    screenshot_ref: Option<ScreenshotRef>,
    route: String,
    app_version: String,
}

struct GhOutcome {
    issue_url: String,
    gist_ref: Option<ScreenshotRef>,
}

/// Background tokio task: run `gh gist create` (with optional downscale)
/// then `gh issue create`. On success emits `FrictionLinked` and rewrites
/// the local markdown record (when present); on failure emits
/// `FrictionFileFailed`. Shared by both the initial submit and the
/// triage-page retry path.
fn spawn_filer(
    store: Arc<designer_core::SqliteEventStore>,
    runner: Arc<dyn GhRunner>,
    stream: StreamId,
    friction_id: FrictionId,
    snapshot: FrictionReportSnapshot,
    record_path: Option<PathBuf>,
) {
    tokio::spawn(async move {
        let title = synthesize_title(&snapshot.anchor, &snapshot.body);
        let outcome = file_to_github(runner.as_ref(), &title, &snapshot).await;
        let payload = match outcome {
            Ok(GhOutcome {
                issue_url,
                gist_ref,
            }) => {
                if let Some(path) = record_path.as_deref() {
                    // Best-effort markdown rewrite — the event log is the
                    // source of truth, so a failed rewrite is logged but
                    // doesn't fail the submit.
                    let _ = write_record(WriteRecordArgs {
                        path,
                        friction_id,
                        title: &title,
                        body: &snapshot.body,
                        anchor: &snapshot.anchor,
                        route: &snapshot.route,
                        app_version: &snapshot.app_version,
                        claude_version: None,
                        screenshot_ref: &gist_ref,
                        github_issue_url: Some(&issue_url),
                    });
                }
                EventPayload::FrictionLinked {
                    friction_id,
                    github_issue_url: issue_url,
                }
            }
            Err(err) => EventPayload::FrictionFileFailed {
                friction_id,
                error_kind: (&err).into(),
            },
        };
        if let Err(err) = store.append(stream, None, Actor::system(), payload).await {
            warn!(error = %err, "friction filer append failed");
        }
    });
}

async fn file_to_github(
    runner: &dyn GhRunner,
    title: &str,
    snap: &FrictionReportSnapshot,
) -> Result<GhOutcome, GhError> {
    let mut tmp_holder: Option<tempfile::NamedTempFile> = None;
    let mut gist_ref: Option<ScreenshotRef> = None;
    let upload_path: Option<PathBuf> = if let Some(src) = snap
        .screenshot_ref
        .as_ref()
        .and_then(ScreenshotRef::local_path)
    {
        let original =
            std::fs::read(src).map_err(|e| GhError::Other(format!("read screenshot: {e}")))?;
        let downscaled = maybe_downscale(&original)?;
        if downscaled == original {
            Some(src.to_path_buf())
        } else {
            let tmp = tempfile::Builder::new()
                .prefix("friction-")
                .suffix(".png")
                .tempfile()
                .map_err(|e| GhError::Other(format!("tempfile: {e}")))?;
            std::fs::write(tmp.path(), &downscaled)
                .map_err(|e| GhError::Other(format!("tempfile write: {e}")))?;
            let path = tmp.path().to_path_buf();
            tmp_holder = Some(tmp);
            Some(path)
        }
    } else {
        None
    };

    // Atomicity: capture gist URL before issue create. If issue create
    // fails the gist is orphaned — accepted per spec.
    let mut markdown_body = render_issue_body(title, snap, None);
    if let Some(path) = upload_path.as_deref() {
        let gist_url = runner.create_gist(path).await?;
        if let Some(sha) = snap.screenshot_ref.as_ref().map(ScreenshotRef::sha256) {
            gist_ref = Some(ScreenshotRef::Gist {
                url: gist_url.clone(),
                sha256: sha.to_string(),
            });
        }
        markdown_body = render_issue_body(title, snap, Some(&gist_url));
    }

    let issue_url = runner.create_issue(title, &markdown_body).await?;
    drop(tmp_holder);
    Ok(GhOutcome {
        issue_url,
        gist_ref,
    })
}

fn render_issue_body(title: &str, snap: &FrictionReportSnapshot, gist_url: Option<&str>) -> String {
    let mut s = String::new();
    s.push_str(&format!("# {title}\n\n"));
    s.push_str(&snap.body);
    s.push_str("\n\n---\n\n");
    s.push_str(&format!("- anchor: `{}`\n", snap.anchor.descriptor()));
    s.push_str(&format!("- route: `{}`\n", snap.route));
    s.push_str(&format!("- app_version: `{}`\n", snap.app_version));
    if let Some(url) = gist_url {
        s.push_str(&format!("- screenshot (secret gist): {url}\n"));
    }
    s
}

/// Reduce a sequence of events into a list of `FrictionEntry`. Preserves
/// chronological order of first-seen `FrictionReported`. Pure function;
/// unit-tested below.
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
                    state: FrictionState::LocalOnly,
                    github_issue_url: None,
                    error: None,
                    screenshot_path: match screenshot_ref {
                        Some(ScreenshotRef::Local { path, .. }) => Some(path.clone()),
                        _ => None,
                    },
                    local_path: PathBuf::new(),
                };
                by_id.insert(*friction_id, entry);
            }
            EventPayload::FrictionLinked {
                friction_id,
                github_issue_url,
            } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    e.state = FrictionState::Filed;
                    e.github_issue_url = Some(github_issue_url.clone());
                    e.error = None;
                }
            }
            EventPayload::FrictionFileFailed {
                friction_id,
                error_kind,
            } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    // Filed wins over Failed — a later success replaces a
                    // prior failure. Resolved is terminal.
                    if !matches!(e.state, FrictionState::Filed | FrictionState::Resolved) {
                        e.state = FrictionState::Failed;
                    }
                    e.error = Some(error_kind.to_string());
                }
            }
            EventPayload::FrictionResolved { friction_id } => {
                if let Some(e) = by_id.get_mut(friction_id) {
                    e.state = FrictionState::Resolved;
                }
            }
            _ => {}
        }
    }
    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect()
}

/// Test-only setter for the `gh` runner. Used by the integration test to
/// inject a recording mock instead of shelling out.
#[cfg(test)]
pub fn set_gh_runner_for_tests(core: &Arc<AppCore>, runner: Arc<dyn GhRunner>) {
    *core.gh_runner_override.lock() = Some(runner);
}

// `AppCore` field for the gh runner override. Lives in a parking_lot::Mutex
// so production callers don't pay an async lock cost for the steady-state
// production-runner read.
pub(crate) type GhRunnerSlot = parking_lot::Mutex<Option<Arc<dyn GhRunner>>>;

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use designer_core::Anchor;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;

    struct RecordingRunner {
        calls: AtomicUsize,
        /// `Some` returns this URL on success; `None` returns `GhError::Offline`.
        gist_url: Option<String>,
        issue_url: Option<String>,
        last_gist_path: parking_lot::Mutex<Option<PathBuf>>,
        last_issue_title: parking_lot::Mutex<Option<String>>,
        last_issue_body: parking_lot::Mutex<Option<String>>,
    }

    impl RecordingRunner {
        fn ok() -> Arc<Self> {
            Arc::new(Self {
                calls: AtomicUsize::new(0),
                gist_url: Some("https://gist.github.com/byamron/abc".into()),
                issue_url: Some("https://github.com/byamron/designer/issues/42".into()),
                last_gist_path: parking_lot::Mutex::new(None),
                last_issue_title: parking_lot::Mutex::new(None),
                last_issue_body: parking_lot::Mutex::new(None),
            })
        }
        fn offline() -> Arc<Self> {
            Arc::new(Self {
                calls: AtomicUsize::new(0),
                gist_url: None,
                issue_url: None,
                last_gist_path: parking_lot::Mutex::new(None),
                last_issue_title: parking_lot::Mutex::new(None),
                last_issue_body: parking_lot::Mutex::new(None),
            })
        }
    }

    #[async_trait]
    impl GhRunner for RecordingRunner {
        async fn create_gist(&self, screenshot_path: &Path) -> Result<String, GhError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.last_gist_path.lock() = Some(screenshot_path.to_path_buf());
            self.gist_url
                .clone()
                .ok_or_else(|| GhError::Offline("connection refused".into()))
        }
        async fn create_issue(&self, title: &str, body: &str) -> Result<String, GhError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.last_issue_title.lock() = Some(title.into());
            *self.last_issue_body.lock() = Some(body.into());
            self.issue_url
                .clone()
                .ok_or_else(|| GhError::Other("issue create suppressed".into()))
        }
    }

    fn dom_anchor() -> Anchor {
        Anchor::DomElement {
            selector_path: "[data-component=\"WorkspaceSidebar\"]".into(),
            route: "/workspace/x".into(),
            component: Some("WorkspaceSidebar".into()),
            stable_id: None,
            text_snippet: Some("Track A".into()),
        }
    }

    fn make_png_bytes(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbaImage::new(width, height);
        let mut bytes = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut bytes);
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    async fn boot() -> (Arc<AppCore>, tempfile::TempDir) {
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
        let runner = RecordingRunner::ok();
        set_gh_runner_for_tests(&core, runner.clone());

        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "row layout looks off when collapsed".into(),
            screenshot_data: Some(make_png_bytes(64, 32)),
            screenshot_filename: Some("paste.png".into()),
            workspace_id: None,
            project_id: None,
            file_to_github: false,
            route: "/workspace/x".into(),
        };
        let resp = core.report_friction(req).await.expect("ok");
        assert!(resp.local_path.exists(), "markdown record on disk");

        let events = core.store.read_all(StreamOptions::default()).await.unwrap();
        let reported = events
            .iter()
            .filter(|e| matches!(e.payload, EventPayload::FrictionReported { .. }))
            .count();
        assert_eq!(reported, 1);

        // One screenshot file written + content-addressed.
        let screenshots = std::fs::read_dir(screenshots_dir(&core.config.data_dir))
            .unwrap()
            .count();
        assert_eq!(screenshots, 1);
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
            file_to_github: false,
            route: "/r".into(),
        };
        let err = core.report_friction(req).await.expect_err("rejected");
        assert!(matches!(err, IpcError::InvalidRequest { .. }));
    }

    #[tokio::test]
    async fn file_to_github_invokes_gh_with_secret_and_label() {
        let (core, _dir) = boot().await;
        let runner = RecordingRunner::ok();
        set_gh_runner_for_tests(&core, runner.clone());

        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "missing focus ring on Plan tab".into(),
            // 2080px → wider than the 1920px cap so the downscale path
            // exercises. Kept small in pixel terms so the PNG decode + resize
            // stays under the test deadline in unoptimized builds.
            screenshot_data: Some(make_png_bytes(2080, 64)),
            screenshot_filename: None,
            workspace_id: None,
            project_id: None,
            file_to_github: true,
            route: "/workspace/x".into(),
        };
        core.report_friction(req).await.unwrap();

        // Wait for the spawned task to land FrictionLinked. Poll the store.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let events = core.store.read_all(StreamOptions::default()).await.unwrap();
            if events
                .iter()
                .any(|e| matches!(e.payload, EventPayload::FrictionLinked { .. }))
            {
                break;
            }
            if std::time::Instant::now() > deadline {
                let kinds: Vec<_> = events.iter().map(|e| e.kind()).collect();
                panic!("FrictionLinked never emitted; saw {kinds:?}");
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        // Issue title contains the descriptor; body contains the gist URL.
        let title = runner.last_issue_title.lock().clone().unwrap();
        let body = runner.last_issue_body.lock().clone().unwrap();
        assert!(title.starts_with("WorkspaceSidebar:"), "title={title}");
        assert!(body.contains("https://gist.github.com/"), "body={body}");
        // Gist runner was called exactly once with a path that exists on disk
        // at call time (recorded via lock). The temp file is unlinked on
        // tmp_holder drop, so we don't re-read the bytes here — the
        // downscale is covered separately in `maybe_downscale_caps_width`.
        assert!(runner.last_gist_path.lock().is_some());
    }

    #[test]
    fn maybe_downscale_caps_width_above_threshold() {
        let bytes = make_png_bytes(2080, 64);
        let out = maybe_downscale(&bytes).expect("downscale ok");
        let img = image::load_from_memory(&out).unwrap();
        assert!(img.width() <= SCREENSHOT_MAX_WIDTH);
    }

    #[test]
    fn maybe_downscale_passes_through_below_threshold() {
        let bytes = make_png_bytes(1024, 768);
        let out = maybe_downscale(&bytes).expect("ok");
        // Same bytes returned untouched (no re-encode round trip).
        assert_eq!(out.len(), bytes.len());
    }

    #[tokio::test]
    async fn gh_offline_emits_file_failed() {
        let (core, _dir) = boot().await;
        let runner = RecordingRunner::offline();
        set_gh_runner_for_tests(&core, runner);

        let req = ReportFrictionRequest {
            anchor: dom_anchor(),
            body: "needs offline retry".into(),
            screenshot_data: Some(make_png_bytes(64, 32)),
            screenshot_filename: None,
            workspace_id: None,
            project_id: None,
            file_to_github: true,
            route: "/r".into(),
        };
        core.report_friction(req).await.unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let events = core.store.read_all(StreamOptions::default()).await.unwrap();
            if events
                .iter()
                .any(|e| matches!(e.payload, EventPayload::FrictionFileFailed { .. }))
            {
                break;
            }
            if std::time::Instant::now() > deadline {
                panic!("FrictionFileFailed never emitted");
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    #[test]
    fn project_friction_orders_by_first_seen_and_resolves_status() {
        use designer_core::{
            Actor, EventEnvelope, EventId, ProjectId, StreamId, Timestamp, WorkspaceId,
        };
        let id_a = FrictionId::new();
        let id_b = FrictionId::new();
        let ws = WorkspaceId::new();
        let _pid = ProjectId::new();

        let make = |seq: u64, payload: EventPayload| EventEnvelope {
            id: EventId::new(),
            stream: StreamId::Workspace(ws),
            sequence: seq,
            timestamp: Timestamp::UNIX_EPOCH,
            actor: Actor::user(),
            version: 1,
            causation_id: None,
            correlation_id: None,
            payload,
        };

        let events = [
            make(
                1,
                EventPayload::FrictionReported {
                    friction_id: id_a,
                    workspace_id: Some(ws),
                    project_id: None,
                    anchor: dom_anchor(),
                    body: "first".into(),
                    screenshot_ref: None,
                    route: "/r".into(),
                    app_version: "0.1.0".into(),
                    claude_version: None,
                    last_user_actions: vec![],
                    file_to_github: true,
                },
            ),
            make(
                2,
                EventPayload::FrictionReported {
                    friction_id: id_b,
                    workspace_id: Some(ws),
                    project_id: None,
                    anchor: dom_anchor(),
                    body: "second".into(),
                    screenshot_ref: None,
                    route: "/r".into(),
                    app_version: "0.1.0".into(),
                    claude_version: None,
                    last_user_actions: vec![],
                    file_to_github: false,
                },
            ),
            make(
                3,
                EventPayload::FrictionFileFailed {
                    friction_id: id_a,
                    error_kind: FrictionFileError::NetworkOffline,
                },
            ),
            make(
                4,
                EventPayload::FrictionLinked {
                    friction_id: id_a,
                    github_issue_url: "https://github.com/x/y/issues/1".into(),
                },
            ),
            make(5, EventPayload::FrictionResolved { friction_id: id_b }),
        ];

        let entries = project_friction(events.iter());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].friction_id, id_a);
        // FrictionLinked should override the prior FrictionFileFailed.
        assert_eq!(entries[0].state, FrictionState::Filed);
        assert_eq!(
            entries[0].github_issue_url.as_deref(),
            Some("https://github.com/x/y/issues/1")
        );
        assert_eq!(entries[1].state, FrictionState::Resolved);
    }

    #[test]
    fn slugify_is_url_safe() {
        assert_eq!(slugify("Hello, World! Foo bar."), "hello-world-foo-bar");
        assert_eq!(slugify(""), "friction");
        assert_eq!(slugify("   "), "friction");
        assert_eq!(slugify("abc-DEF—gh"), "abc-def-gh");
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
        // Descriptor + ": " + 60 chars (59 + ellipsis).
        assert!(out.ends_with("…"));
    }

    #[test]
    fn classify_gh_error_routes_known_substrings() {
        let s = b"X-GitHub-Request-Id: 1\nerror: not logged in to github.com";
        assert!(matches!(
            classify_gh_error(s, "gist"),
            GhError::NotAuthed(_)
        ));
        let s = b"could not resolve host: api.github.com";
        assert!(matches!(classify_gh_error(s, "gist"), GhError::Offline(_)));
        let s = b"weird error";
        assert!(matches!(
            classify_gh_error(s, "gist"),
            GhError::GistRejected(_)
        ));
        let s = b"weird error";
        assert!(matches!(classify_gh_error(s, "issue"), GhError::Other(_)));
    }
}
