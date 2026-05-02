//! Friction projection — shared between the desktop's IPC handler and the
//! `designer` CLI's `friction list` subcommand. Lives in `designer-ipc`
//! because the output type (`FrictionEntry`) is already here, and pulling
//! the projection alongside it keeps the state machine a single source of
//! truth: both surfaces reduce the same events the same way.

use crate::{FrictionEntry, FrictionState};
use designer_core::{rfc3339, Anchor, EventEnvelope, EventPayload, FrictionId, ScreenshotRef};
use std::collections::HashMap;

/// Render the synthesized title for a friction entry: anchor descriptor,
/// then the first 60 chars of the body. Used at write-time (so the .md
/// front matter carries it) and at projection-time (so the triage list
/// row matches the file on disk).
pub fn synthesize_title(anchor: &Anchor, body: &str) -> String {
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

/// Reduce a sequence of events into a list of `FrictionEntry`. Pure
/// function. Output order is most-recent-first (by the timestamp of each
/// entry's originating `FrictionReported`).
pub fn project_friction<'a, I>(events: I) -> Vec<FrictionEntry>
where
    I: IntoIterator<Item = &'a EventEnvelope>,
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
                    created_at: rfc3339(env.timestamp),
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
