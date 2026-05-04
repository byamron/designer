//! Anchor write-back. Safely persists auto-injected `<!-- anchor: foo -->`
//! lines to `roadmap.md` so derived ids remain stable across re-parse.
//!
//! # Safety
//!
//! Write-back can race a foreground editor (VS Code, Zed) that has the file
//! open with unsaved changes. The caller is responsible for the focus + age
//! gate; this module only handles the atomic-rewrite mechanics.
//!
//! - The current source is read fresh and compared against the source the
//!   parser saw. If the file changed underneath us, we abort — the
//!   in-memory plan is stale.
//! - Write goes to a sibling tmp file (same directory, so `rename` is
//!   atomic on the same filesystem) and is renamed into place.
//! - If no anchors needed injection, we don't open the file at all.

use super::tree::NodeIdAssignment;
use std::fs;
use std::io::Write;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AnchorWriteError {
    #[error("io error during anchor write-back: {0}")]
    Io(#[from] std::io::Error),
    #[error("source on disk changed since parse — aborting write-back")]
    SourceDrifted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnchorWriteOutcome {
    /// No assignments to write — file untouched.
    NoOp,
    /// Wrote `count` anchor lines.
    Wrote { count: usize },
}

/// Insert `<!-- anchor: foo -->` lines for every assignment, atomically.
///
/// `parsed_source` must be the exact source the parser saw — if the file
/// on disk no longer matches, this returns [`AnchorWriteError::SourceDrifted`]
/// rather than risk overwriting a concurrent edit.
///
/// The caller must enforce the focus + mtime-age gate (only write when
/// Designer has window focus AND file mtime > 5s old).
pub fn write_back_missing_anchors(
    path: &Path,
    parsed_source: &str,
    assignments: &[NodeIdAssignment],
) -> Result<AnchorWriteOutcome, AnchorWriteError> {
    if assignments.is_empty() {
        return Ok(AnchorWriteOutcome::NoOp);
    }

    let on_disk = fs::read_to_string(path)?;
    if on_disk != parsed_source {
        return Err(AnchorWriteError::SourceDrifted);
    }

    let new_source = inject_anchors(parsed_source, assignments);

    // Atomic write: tmp in same dir → rename into place.
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".roadmap-anchors-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    tmp.write_all(new_source.as_bytes())?;
    tmp.flush()?;
    tmp.persist(path)
        .map_err(|e| AnchorWriteError::Io(e.error))?;

    Ok(AnchorWriteOutcome::Wrote {
        count: assignments.len(),
    })
}

/// Pure: produce the new source with anchor comments inserted on the line
/// after each assigned heading. Sorted by `heading_end_byte` ascending so
/// insertions don't invalidate later offsets.
pub(crate) fn inject_anchors(source: &str, assignments: &[NodeIdAssignment]) -> String {
    let mut sorted: Vec<&NodeIdAssignment> = assignments.iter().collect();
    sorted.sort_by_key(|a| a.heading_end_byte);

    let mut out = String::with_capacity(source.len() + sorted.len() * 32);
    let mut cursor = 0usize;
    for a in sorted {
        let end = a.heading_end_byte.min(source.len());
        if end < cursor {
            // Defensive: skip overlapping/out-of-order assignments rather
            // than corrupt output.
            continue;
        }
        out.push_str(&source[cursor..end]);
        // Insert: `<!-- anchor: foo -->\n` immediately after the heading line.
        out.push_str("<!-- anchor: ");
        out.push_str(a.node_id.as_str());
        out.push_str(" -->\n");
        cursor = end;
    }
    out.push_str(&source[cursor..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::roadmap::NodeId;
    use std::fs;

    #[test]
    fn no_op_when_nothing_to_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("roadmap.md");
        fs::write(&path, "# Hi\n").unwrap();
        let outcome = write_back_missing_anchors(&path, "# Hi\n", &[]).unwrap();
        assert_eq!(outcome, AnchorWriteOutcome::NoOp);
        // File untouched.
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Hi\n");
    }

    #[test]
    fn injects_anchor_after_heading() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("roadmap.md");
        let src = "# Roadmap\n\n## Phase 1\n";
        fs::write(&path, src).unwrap();
        let assignments = vec![
            NodeIdAssignment {
                node_id: NodeId::new("roadmap"),
                heading_line: 1,
                heading_start_byte: 0,
                heading_end_byte: 10,
            },
            NodeIdAssignment {
                node_id: NodeId::new("roadmap.phase-1"),
                heading_line: 3,
                heading_start_byte: 11,
                heading_end_byte: 22,
            },
        ];
        let outcome = write_back_missing_anchors(&path, src, &assignments).unwrap();
        assert_eq!(outcome, AnchorWriteOutcome::Wrote { count: 2 });
        let after = fs::read_to_string(&path).unwrap();
        assert_eq!(
            after,
            "# Roadmap\n<!-- anchor: roadmap -->\n\n## Phase 1\n<!-- anchor: roadmap.phase-1 -->\n"
        );
    }

    #[test]
    fn aborts_when_source_drifted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("roadmap.md");
        fs::write(&path, "# Different now\n").unwrap();
        let result = write_back_missing_anchors(
            &path,
            "# Original\n",
            &[NodeIdAssignment {
                node_id: NodeId::new("x"),
                heading_line: 1,
                heading_start_byte: 0,
                heading_end_byte: 10,
            }],
        );
        assert!(matches!(result, Err(AnchorWriteError::SourceDrifted)));
        // File still on the drifted content — not overwritten.
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Different now\n");
    }
}
