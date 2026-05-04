//! Phase 22.B — IPC handlers for the Recent Reports surface.
//!
//! Wire surface:
//! - `cmd_list_recent_reports(project_id, limit?)` — newest-first list
//!   of report artifacts for a project, with classification, workspace
//!   label, and PR link metadata when available.
//! - `cmd_mark_reports_read(project_id)` — advance the project's
//!   read-state cursor to the current head of the report stream.
//!   Idempotent + monotonic.
//! - `cmd_get_reports_unread_count(project_id)` — count of reports
//!   newer than the project's read mark. Cheap; safe to poll.
//!
//! The read mark is a single timestamp per project (single-machine v1;
//! shape extends to `(UserId, ProjectId)` when team-tier lands).
//! Persisted in `Settings.report_read_at_by_project` — NOT in the event
//! log (per roadmap §22.B "projection, not events").

use crate::core::AppCore;
use crate::settings::Settings;
use designer_core::{
    Artifact, PayloadRef, ProjectId, ReportClassification, Timestamp, WorkspaceId,
};
use designer_ipc::IpcError;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

/// Process-wide lock guarding the read-modify-write of the Settings
/// sidecar from `cmd_mark_reports_read`. Two tabs marking concurrently
/// would otherwise race: A reads sidecar, B reads sidecar, A writes,
/// B clobbers A. The lock is local to this command (other settings
/// writers go through their own IPC commands and don't share this
/// path); a broader Settings-wide mutex is a separate cleanup.
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// One Recent Reports row. Lean DTO — the Home tab only needs to render
/// the inline summary + classification chip; full bodies are fetched on
/// expand via the existing `get_artifact` IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentReportRow {
    pub artifact_id: String,
    pub workspace_id: WorkspaceId,
    /// Workspace name (so the Home tab can label the row with where the
    /// work landed without an extra IPC).
    pub workspace_name: String,
    pub title: String,
    /// Manager-voice summary; falls back to `summary` when the
    /// report was emitted before Phase 22.B (roadmap §22.B migration).
    pub summary_high: String,
    /// Coarse classification — Feature / Fix / Improvement / Reverted.
    /// Pre-22.B reports without a classification fall back to
    /// `Improvement` so the chip renders without a crash.
    pub classification: ReportClassification,
    /// PR URL if the report's payload encodes one (not required).
    pub pr_url: Option<String>,
    pub created_at: Timestamp,
}

impl RecentReportRow {
    fn from_artifact(a: &Artifact, workspace_name: String) -> Self {
        let summary_high = a.summary_high.clone().unwrap_or_else(|| a.summary.clone());
        let classification = a
            .classification
            .unwrap_or(ReportClassification::Improvement);
        let pr_url = match &a.payload {
            PayloadRef::Inline { body } => extract_pr_url(body),
            PayloadRef::Hash { .. } => None,
        };
        Self {
            artifact_id: a.id.to_string(),
            workspace_id: a.workspace_id,
            workspace_name,
            title: a.title.clone(),
            summary_high,
            classification,
            pr_url,
            created_at: a.created_at,
        }
    }
}

/// Best-effort PR URL extraction from a report body. Reports today come
/// from `recap_workspace` which writes markdown bullets; PR-linked
/// reports (a future emitter) will inline the URL on the first line.
/// Cheap heuristic — first `https://github.com/.../pull/N` or
/// `https://*/pull/N` we see wins.
fn extract_pr_url(body: &str) -> Option<String> {
    body.split_whitespace()
        .find(|tok| tok.starts_with("https://") && tok.contains("/pull/"))
        .map(|tok| {
            tok.trim_end_matches(|c: char| !c.is_alphanumeric())
                .to_string()
        })
}

/// Phase 22.B — newest-first list of reports for a project.
#[tauri::command]
pub async fn cmd_list_recent_reports(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
    limit: Option<u32>,
) -> Result<Vec<RecentReportRow>, IpcError> {
    let reports = core.projector.recent_reports(project_id);
    let cap = limit.unwrap_or(50) as usize;
    let mut out = Vec::with_capacity(reports.len().min(cap));
    for a in reports.into_iter().take(cap) {
        let ws_name = core
            .projector
            .workspace(a.workspace_id)
            .map(|w| w.name)
            .unwrap_or_else(|| "workspace".into());
        out.push(RecentReportRow::from_artifact(&a, ws_name));
    }
    Ok(out)
}

/// Phase 22.B — count of reports for a project that are newer than the
/// last-seen mark. Implicit advances on inline-expand and tab-open
/// happen via `cmd_mark_reports_read`; this read is the source of
/// truth for the Section header's "N unread" badge.
#[tauri::command]
pub fn cmd_get_reports_unread_count(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
) -> Result<u32, IpcError> {
    Ok(core.projector.unread_report_count(project_id) as u32)
}

/// Phase 22.B — advance the project's read mark to the current head of
/// the report stream. Idempotent + monotonic. Persisted in the
/// Settings sidecar so the mark survives restart.
#[tauri::command]
pub fn cmd_mark_reports_read(
    core: State<'_, Arc<AppCore>>,
    project_id: ProjectId,
) -> Result<u32, IpcError> {
    let head = core
        .projector
        .recent_reports(project_id)
        .first()
        .map(|a| a.created_at);
    let Some(at) = head else {
        // Nothing to mark — leave the projection alone so the next
        // emitted report still surfaces as unread.
        return Ok(0);
    };
    core.projector.mark_reports_read(project_id, at);
    // Persist sidecar under the process-wide lock so a concurrent call
    // for the same (or another) project can't read a stale snapshot
    // and clobber our write.
    {
        let _guard = SETTINGS_WRITE_LOCK.lock();
        let mut settings = Settings::load(&core.config.data_dir);
        settings.report_read_at_by_project.insert(project_id, at);
        settings
            .save(&core.config.data_dir)
            .map_err(|e| IpcError::unknown(format!("settings write failed: {e}")))?;
    }
    Ok(core.projector.unread_report_count(project_id) as u32)
}
