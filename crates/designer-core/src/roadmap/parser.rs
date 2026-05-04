//! Line-based scanner over `roadmap.md`. Captures ATX headings (`#`..`######`),
//! HTML-comment anchors (`<!-- anchor: foo.bar -->`), and an authored status
//! marker tucked into the heading text (e.g. `### Foo *(in-progress)*`).
//!
//! We deliberately avoid pulling in a markdown AST. Headings + anchor lines
//! are sub-1ms to detect on a 64K source; bodies stay as byte-range slices
//! the frontend renders lazily in a Web Worker.
//!
//! # Anchor attachment
//!
//! - An anchor comment on the same physical line as the heading text
//!   attaches to that heading.
//! - An anchor comment on any line between heading N and heading N+1 (i.e.
//!   in heading N's body) attaches to heading N. The first such anchor
//!   wins; later anchors in the same body are ignored (the first line is
//!   the canonical author-intended placement).
//! - Anchors before the very first heading are dropped.
//!
//! # Errors
//!
//! Every [`ParseError`] carries a 1-based `line`, an optional `column`, a
//! ±2-line `snippet`, and a static `hint`.

use super::tree::{NodeIdAssignment, RoadmapTree};
use super::{NodeId, NodeStatus, RoadmapNode};
use serde::{Deserialize, Serialize};
use std::fmt;

/// One parse failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParseError {
    /// 1-based line number of the offending token.
    pub line: usize,
    /// 1-based column, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    /// ±2 lines around the offending token.
    pub snippet: String,
    /// Human-readable explanation. Stable strings the UI may pattern-match.
    /// Owned (`String`) rather than `&'static str` so the type can derive
    /// `Deserialize` without a phantom static lifetime — `ParseError`
    /// crosses the IPC boundary.
    pub hint: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "roadmap parse error at line {}: {}",
            self.line, self.hint
        )
    }
}

impl std::error::Error for ParseError {}

/// Parse `source` (the contents of `roadmap.md`) into a structural tree.
///
/// Returns the tree (with anchors) plus a list of [`NodeIdAssignment`]s for
/// any headings that were missing an anchor. The IPC layer hands the
/// assignment list to [`super::write_back_missing_anchors`] so the file
/// gets persistent anchors on first parse.
pub fn parse_roadmap(source: &str) -> Result<(RoadmapTree, Vec<NodeIdAssignment>), ParseError> {
    let raw_headings = scan_headings(source)?;

    if raw_headings.is_empty() {
        return Ok((RoadmapTree::empty(source), Vec::new()));
    }

    // Validate: depth must not jump (e.g. h2 → h4 with no h3).
    let mut prev_depth: Option<u8> = None;
    for h in &raw_headings {
        if let Some(prev) = prev_depth {
            if h.depth > prev + 1 {
                return Err(ParseError {
                    line: h.line,
                    column: None,
                    snippet: snippet_around(source, h.line),
                    hint: "heading depth jumped more than one level — \
                           insert an intermediate heading or shallow this one"
                        .into(),
                });
            }
        }
        prev_depth = Some(h.depth);
    }

    // Build parent links + derive missing anchors.
    let mut nodes: Vec<RoadmapNode> = Vec::with_capacity(raw_headings.len());
    let mut assignments: Vec<NodeIdAssignment> = Vec::new();
    let mut parent_stack: Vec<(u8, NodeId)> = Vec::new();
    let mut used_ids: std::collections::HashSet<NodeId> = std::collections::HashSet::new();

    // Body offset for node N runs from end of N's heading line up to the
    // start of N+1's heading line (or end-of-source).
    let mut heading_starts: Vec<usize> =
        raw_headings.iter().map(|h| h.heading_start_byte).collect();
    heading_starts.push(source.len());

    for (i, raw) in raw_headings.iter().enumerate() {
        // Pop stack to current depth.
        while let Some((top_depth, _)) = parent_stack.last() {
            if *top_depth >= raw.depth {
                parent_stack.pop();
            } else {
                break;
            }
        }
        let parent_id = parent_stack.last().map(|(_, id)| id.clone());

        let (id, was_assigned) = if let Some(anchor) = &raw.anchor {
            (NodeId::new(anchor), false)
        } else {
            let id = derive_id(&raw.headline, parent_id.as_ref(), &used_ids);
            (id, true)
        };
        used_ids.insert(id.clone());

        if was_assigned {
            assignments.push(NodeIdAssignment {
                node_id: id.clone(),
                heading_line: raw.line,
                heading_start_byte: raw.heading_start_byte,
                heading_end_byte: raw.heading_end_byte,
            });
        }

        let body_start = raw.heading_end_byte;
        let body_end = heading_starts[i + 1];
        let status = parse_status_marker(&raw.headline);
        let cleaned_headline = strip_status_marker(&raw.headline).trim().to_string();

        nodes.push(RoadmapNode {
            id: id.clone(),
            parent_id: parent_id.clone(),
            depth: raw.depth,
            headline: cleaned_headline,
            body_offset: body_start,
            body_length: body_end.saturating_sub(body_start),
            child_ids: Vec::new(),
            external_source: None,
            status,
            shipped_at: None,
            shipped_pr: None,
        });

        parent_stack.push((raw.depth, id));
    }

    // Fill child_ids in document order.
    let id_to_index: std::collections::HashMap<NodeId, usize> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.clone(), i))
        .collect();
    let mut child_lists: std::collections::HashMap<NodeId, Vec<NodeId>> =
        std::collections::HashMap::new();
    for n in &nodes {
        if let Some(parent) = &n.parent_id {
            child_lists
                .entry(parent.clone())
                .or_default()
                .push(n.id.clone());
        }
    }
    for (parent_id, children) in child_lists {
        if let Some(&idx) = id_to_index.get(&parent_id) {
            nodes[idx].child_ids = children;
        }
    }

    Ok((RoadmapTree::from_nodes(source, nodes), assignments))
}

/// One heading captured by the line scanner.
struct RawHeading {
    /// 1-based line number.
    line: usize,
    /// Heading depth (1..=6).
    depth: u8,
    /// Heading text with status marker still embedded; stripped at node-build time.
    headline: String,
    /// Anchor id parsed from `<!-- anchor: foo -->` either inline on the
    /// heading line or in the following body before the next heading.
    anchor: Option<String>,
    /// Byte offset at the start of the heading line.
    heading_start_byte: usize,
    /// Byte offset of the start of the line **after** the heading.
    heading_end_byte: usize,
}

fn scan_headings(source: &str) -> Result<Vec<RawHeading>, ParseError> {
    let mut headings: Vec<RawHeading> = Vec::new();
    let mut byte = 0usize;
    let mut line_no = 0usize;
    let mut in_code_fence = false;
    let mut code_fence_marker: Option<&str> = None;

    for raw_line in source.split_inclusive('\n') {
        line_no += 1;
        let line_start = byte;
        let line_end = byte + raw_line.len();
        // Strip trailing newline for content checks.
        let line = raw_line.trim_end_matches('\n').trim_end_matches('\r');

        // Code fences toggle parsing — never treat lines inside ``` blocks
        // as headings or anchors.
        let trimmed_for_fence = line.trim_start();
        if let Some(marker) = code_fence_marker {
            if trimmed_for_fence.starts_with(marker) {
                in_code_fence = false;
                code_fence_marker = None;
            }
        } else if let Some(rest) = trimmed_for_fence.strip_prefix("```") {
            // Opening fence; remember the marker.
            let marker = if rest.starts_with("```") {
                "````"
            } else {
                "```"
            };
            in_code_fence = true;
            code_fence_marker = Some(marker);
        }

        if in_code_fence {
            byte = line_end;
            continue;
        }

        // ATX heading detection: 1..6 leading '#' then a space or end-of-line.
        if let Some((depth, text)) = atx_heading(line) {
            let (text_no_anchor, inline_anchor) = strip_inline_anchor(text);
            let headline = text_no_anchor.trim().to_string();
            if headline.is_empty() && inline_anchor.is_none() {
                return Err(ParseError {
                    line: line_no,
                    column: None,
                    snippet: snippet_around(source, line_no),
                    hint: "empty heading text — give the heading a title or remove the line".into(),
                });
            }
            headings.push(RawHeading {
                line: line_no,
                depth,
                headline,
                anchor: inline_anchor,
                heading_start_byte: line_start,
                heading_end_byte: line_end,
            });
        } else if let Some(anchor) = parse_anchor_line(line) {
            // Body anchor — attach to the most recent heading IF that
            // heading doesn't already have one.
            if let Some(last) = headings.last_mut() {
                if last.anchor.is_none() {
                    last.anchor = Some(anchor);
                }
            }
        }

        byte = line_end;
    }

    Ok(headings)
}

/// Parse an ATX heading. Returns `(depth, trailing_text)` for `#..######`
/// followed by a space (or end-of-line). Setext headings (underlined `===`
/// / `---`) are not supported — Designer's roadmap uses ATX exclusively.
fn atx_heading(line: &str) -> Option<(u8, &str)> {
    let bytes = line.as_bytes();
    if bytes.is_empty() || bytes[0] != b'#' {
        return None;
    }
    let mut depth = 0;
    while depth < bytes.len() && bytes[depth] == b'#' {
        depth += 1;
    }
    if !(1..=6).contains(&depth) {
        return None;
    }
    if depth == bytes.len() {
        // Trailing text optional? CommonMark allows it but our shape needs a title.
        return Some((depth as u8, ""));
    }
    if bytes[depth] != b' ' {
        return None;
    }
    Some((
        depth as u8,
        line[depth + 1..].trim_end_matches('#').trim_end(),
    ))
}

/// Find an inline `<!-- anchor: foo -->` in heading text. Returns the
/// heading text with the anchor comment removed, plus the anchor id.
fn strip_inline_anchor(text: &str) -> (String, Option<String>) {
    if let Some(start) = text.find("<!--") {
        if let Some(end_rel) = text[start..].find("-->") {
            let end = start + end_rel + 3;
            let comment = &text[start..end];
            if let Some(anchor) = parse_anchor_comment(comment) {
                let mut out = String::with_capacity(text.len() - (end - start));
                out.push_str(&text[..start]);
                out.push_str(&text[end..]);
                return (out.trim().to_string(), Some(anchor));
            }
        }
    }
    (text.to_string(), None)
}

/// Parse an anchor-only line: `<!-- anchor: foo.bar -->` (with whitespace
/// tolerated). Returns the anchor id, or `None`.
pub(crate) fn parse_anchor_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    parse_anchor_comment(trimmed)
}

/// Parse `<!-- anchor: foo.bar -->` from a raw HTML chunk.
pub(crate) fn parse_anchor_comment(html: &str) -> Option<String> {
    let trimmed = html.trim();
    let inner = trimmed.strip_prefix("<!--")?.strip_suffix("-->")?.trim();
    let rest = inner.strip_prefix("anchor:")?;
    let id = rest.trim();
    if id.is_empty() || !valid_anchor_id(id) {
        None
    } else {
        Some(id.to_string())
    }
}

fn valid_anchor_id(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// Derive an id from the headline + parent prefix + sibling-disambig.
fn derive_id(
    headline: &str,
    parent_id: Option<&NodeId>,
    used: &std::collections::HashSet<NodeId>,
) -> NodeId {
    let slug_base = slugify(&strip_status_marker(headline));
    let parent_prefix = parent_id.map(|p| format!("{p}.")).unwrap_or_default();
    let mut candidate = format!("{parent_prefix}{slug_base}");
    let mut suffix = 2;
    while used.contains(&NodeId::new(&candidate)) {
        candidate = format!("{parent_prefix}{slug_base}-{suffix}");
        suffix += 1;
    }
    NodeId::new(candidate)
}

/// Slugify a heading. Lowercase, alnum + dash; collapses runs of non-alnum
/// to a single dash; trims leading/trailing dashes; truncates to 48 chars.
fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = true;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 48 {
        out.truncate(48);
        while out.ends_with('-') {
            out.pop();
        }
    }
    if out.is_empty() {
        out.push_str("node");
    }
    out
}

fn snippet_around(source: &str, line_1based: usize) -> String {
    let start_line = line_1based.saturating_sub(2).max(1);
    let end_line = line_1based + 2;
    source
        .lines()
        .enumerate()
        .filter_map(|(i, l)| {
            let n = i + 1;
            if n >= start_line && n <= end_line {
                Some(format!("{n:>4} | {l}"))
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Authored status markers in headings (e.g. `### Foo (in-progress)`).
fn parse_status_marker(headline: &str) -> NodeStatus {
    let lower = headline.to_ascii_lowercase();
    let needles = [
        ("(canceled)", NodeStatus::Canceled),
        ("(blocked)", NodeStatus::Blocked),
        ("(done)", NodeStatus::Done),
        ("(shipped)", NodeStatus::Done),
        ("(in review)", NodeStatus::InReview),
        ("(in-review)", NodeStatus::InReview),
        ("(in progress)", NodeStatus::InProgress),
        ("(in-progress)", NodeStatus::InProgress),
        ("(todo)", NodeStatus::Todo),
        ("(backlog)", NodeStatus::Backlog),
    ];
    for (needle, status) in needles {
        if lower.contains(needle) {
            return status;
        }
    }
    NodeStatus::Backlog
}

fn strip_status_marker(headline: &str) -> String {
    let lower = headline.to_ascii_lowercase();
    let needles = [
        "(canceled)",
        "(blocked)",
        "(done)",
        "(shipped)",
        "(in review)",
        "(in-review)",
        "(in progress)",
        "(in-progress)",
        "(todo)",
        "(backlog)",
    ];
    for needle in needles {
        if let Some(start) = lower.find(needle) {
            let mut s = headline.to_string();
            s.replace_range(start..start + needle.len(), "");
            return s;
        }
    }
    headline.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASIC: &str = "\
# Roadmap
<!-- anchor: root -->

## Phase 1 (in-progress)
<!-- anchor: phase1 -->

Body of phase 1.

### Slice A
<!-- anchor: phase1.a -->

### Slice B (done)
<!-- anchor: phase1.b -->

## Phase 2
<!-- anchor: phase2 -->
";

    #[test]
    fn parses_basic_tree_with_authored_anchors() {
        let (tree, assignments) = parse_roadmap(BASIC).expect("parse");
        assert!(assignments.is_empty(), "no anchors should need injection");
        assert_eq!(tree.nodes().len(), 5);
        let root = tree.node(&NodeId::new("root")).unwrap();
        assert_eq!(root.depth, 1);
        assert_eq!(root.child_ids.len(), 2);
        let phase1 = tree.node(&NodeId::new("phase1")).unwrap();
        assert_eq!(phase1.status, NodeStatus::InProgress);
        assert_eq!(phase1.headline, "Phase 1");
        assert_eq!(phase1.child_ids.len(), 2);
        let slice_b = tree.node(&NodeId::new("phase1.b")).unwrap();
        assert_eq!(slice_b.status, NodeStatus::Done);
    }

    #[test]
    fn injects_anchors_for_unanchored_headings() {
        let src = "\
# Roadmap

## Phase Alpha

### Slice One

### Slice Two
";
        let (_tree, assignments) = parse_roadmap(src).expect("parse");
        assert_eq!(assignments.len(), 4);
        let ids: Vec<&str> = assignments.iter().map(|a| a.node_id.as_str()).collect();
        assert_eq!(ids[0], "roadmap");
        assert_eq!(ids[1], "roadmap.phase-alpha");
        assert_eq!(ids[2], "roadmap.phase-alpha.slice-one");
        assert_eq!(ids[3], "roadmap.phase-alpha.slice-two");
    }

    #[test]
    fn anchor_split_keeps_id_with_first_in_file_order() {
        // Both halves diverged → original anchor stays with first heading
        // in file order; the second gets a fresh slug-derived id.
        let src = "\
## Phase 1 Renamed
<!-- anchor: phase1 -->

## Phase 1 Sibling
";
        let (tree, assignments) = parse_roadmap(src).expect("parse");
        assert!(tree.node(&NodeId::new("phase1")).is_some());
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].node_id.as_str(), "phase-1-sibling");
    }

    #[test]
    fn malformed_depth_jump_returns_parse_error_with_line_and_snippet() {
        let src = "\
# Top

#### Skipped two levels
";
        let err = parse_roadmap(src).unwrap_err();
        assert_eq!(err.line, 3);
        assert!(
            err.snippet.contains("Skipped two levels"),
            "{}",
            err.snippet
        );
        assert!(err.hint.contains("depth"));
    }

    #[test]
    fn empty_source_parses_to_empty_tree() {
        let (tree, assignments) = parse_roadmap("").expect("parse");
        assert!(tree.nodes().is_empty());
        assert!(assignments.is_empty());
    }

    #[test]
    fn parse_anchor_comment_handles_whitespace() {
        assert_eq!(
            parse_anchor_comment("<!-- anchor: foo.bar -->"),
            Some("foo.bar".to_string())
        );
        assert_eq!(
            parse_anchor_comment("  <!--   anchor:   foo  -->  "),
            Some("foo".to_string())
        );
        assert_eq!(parse_anchor_comment("<!-- something else -->"), None);
        assert_eq!(parse_anchor_comment("<!-- anchor: -->"), None);
        assert_eq!(parse_anchor_comment("<!-- anchor: bad spaces -->"), None);
    }

    #[test]
    fn ignores_anchors_inside_code_fences() {
        let src = "\
## Phase 1
<!-- anchor: phase1 -->

```md
<!-- anchor: not-real -->
```

## Phase 2
";
        let (tree, _) = parse_roadmap(src).expect("parse");
        assert!(tree.node(&NodeId::new("not-real")).is_none());
        assert!(tree.node(&NodeId::new("phase1")).is_some());
    }

    #[test]
    fn inline_anchor_on_heading_line() {
        let src = "## Phase 1 <!-- anchor: phase1 -->\n";
        let (tree, assignments) = parse_roadmap(src).expect("parse");
        assert!(assignments.is_empty());
        let n = tree.node(&NodeId::new("phase1")).unwrap();
        assert_eq!(n.headline, "Phase 1");
    }

    #[test]
    fn empty_heading_is_a_parse_error() {
        let src = "# \n## OK\n";
        let err = parse_roadmap(src).unwrap_err();
        assert_eq!(err.line, 1);
        assert!(err.hint.contains("empty heading"));
    }
}
