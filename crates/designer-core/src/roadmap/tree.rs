//! Structural cache for one parsed roadmap. Owns the source string and the
//! ordered node list; exposes O(1) lookups by id.
//!
//! [`RoadmapHash`] is the trigger for re-parse: `(mtime, size, content_hash)`
//! catches all of: file-content edits, atomic-rewrite mtime updates,
//! `touch + revert` (mtime stable, content unchanged → no re-parse), and
//! `git checkout` (mtime moves backward but content changed → re-parse).

use super::{NodeId, RoadmapNode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::SystemTime;

/// One node id chosen by the parser for a heading that didn't have an
/// authored anchor. The IPC layer hands these to
/// [`super::write_back_missing_anchors`] to persist them as
/// `<!-- anchor: foo -->` lines on the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeIdAssignment {
    pub node_id: NodeId,
    /// 1-based heading line number.
    pub heading_line: usize,
    /// Byte offset at the start of the heading line.
    pub heading_start_byte: usize,
    /// Byte offset of the start of the line **after** the heading.
    pub heading_end_byte: usize,
}

/// Identity of a parsed roadmap source. Used as a re-parse trigger key —
/// any change to any field invalidates the cached tree.
///
/// `mtime_unix_secs` is in whole seconds (sub-second resolution varies by
/// platform and isn't stable). `content_hash` is the first 16 bytes (32 hex
/// chars) of SHA-256 — full-collision resistance unnecessary for an
/// invalidation key, and 16 bytes keeps the JSON payload small.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoadmapHash {
    pub mtime_unix_secs: i64,
    pub size_bytes: u64,
    pub content_hash: String,
}

impl RoadmapHash {
    pub fn from_source(mtime: SystemTime, source: &str) -> Self {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(source.as_bytes());
        let digest = hasher.finalize();
        let truncated = &digest[..16];
        let mtime_unix_secs = mtime
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|err| -(err.duration().as_secs() as i64));
        Self {
            mtime_unix_secs,
            size_bytes: source.len() as u64,
            content_hash: hex::encode(truncated),
        }
    }
}

/// One parsed roadmap. Owns the source so body slices stay valid; nodes are
/// in document order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapTree {
    source: String,
    nodes: Vec<RoadmapNode>,
    #[serde(skip)]
    by_id: HashMap<NodeId, usize>,
}

impl PartialEq for RoadmapTree {
    fn eq(&self, other: &Self) -> bool {
        // Exclude `by_id` (a derived index) from equality so round-trip
        // tests don't have to rebuild the cache before comparison.
        self.source == other.source && self.nodes == other.nodes
    }
}

impl RoadmapTree {
    pub fn empty(source: &str) -> Self {
        Self {
            source: source.to_string(),
            nodes: Vec::new(),
            by_id: HashMap::new(),
        }
    }

    pub fn from_nodes(source: &str, nodes: Vec<RoadmapNode>) -> Self {
        let mut by_id = HashMap::with_capacity(nodes.len());
        for (i, n) in nodes.iter().enumerate() {
            by_id.insert(n.id.clone(), i);
        }
        Self {
            source: source.to_string(),
            nodes,
            by_id,
        }
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn nodes(&self) -> &[RoadmapNode] {
        &self.nodes
    }

    pub fn node(&self, id: &NodeId) -> Option<&RoadmapNode> {
        self.by_id.get(id).and_then(|&i| self.nodes.get(i))
    }

    /// Top-level (depth=1 or smallest depth) nodes in document order. The
    /// frontend reads these as the phase strip.
    pub fn roots(&self) -> Vec<&RoadmapNode> {
        self.nodes
            .iter()
            .filter(|n| n.parent_id.is_none())
            .collect()
    }

    /// Slice the body of `id` from the source string. Returns `""` if the
    /// node has no body (a heading with nothing under it).
    pub fn body(&self, id: &NodeId) -> &str {
        let Some(node) = self.node(id) else {
            return "";
        };
        let start = node.body_offset.min(self.source.len());
        let end = (start + node.body_length).min(self.source.len());
        &self.source[start..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn hash_changes_on_content_change_at_same_mtime() {
        let mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let a = RoadmapHash::from_source(mtime, "hello");
        let b = RoadmapHash::from_source(mtime, "hello world");
        assert_ne!(a, b, "different content → different hash");
    }

    #[test]
    fn hash_stable_on_identical_input() {
        let mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let a = RoadmapHash::from_source(mtime, "x");
        let b = RoadmapHash::from_source(mtime, "x");
        assert_eq!(a, b);
    }
}
