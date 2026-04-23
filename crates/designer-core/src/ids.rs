//! Strongly-typed IDs. Using UUIDv7 for monotonic-by-creation ordering so
//! sort-by-id matches sort-by-time within a single host; distinct host clocks
//! remain safely unique.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident, $prefix:literal) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }

            pub fn prefix() -> &'static str {
                $prefix
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}_{}", $prefix, self.0)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
                let raw = s.strip_prefix(concat!($prefix, "_")).unwrap_or(s);
                Uuid::parse_str(raw).map(Self)
            }
        }
    };
}

id_type!(ProjectId, "prj");
id_type!(WorkspaceId, "wks");
id_type!(TabId, "tab");
id_type!(AgentId, "agt");
id_type!(TaskId, "tsk");
id_type!(ApprovalId, "apv");
id_type!(EventId, "evt");

/// A stream is the logical append-only log for a given aggregate. Every event
/// belongs to exactly one stream; streams are replayed to build projections.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum StreamId {
    /// Project-level events: creation, linking, thread messages.
    Project(ProjectId),
    /// Workspace-level events: workspace-scoped agents, tasks, approvals.
    Workspace(WorkspaceId),
    /// Application-level events (audit log, settings, system diagnostics).
    System,
}

impl StreamId {
    pub fn discriminant(&self) -> &'static str {
        match self {
            StreamId::Project(_) => "project",
            StreamId::Workspace(_) => "workspace",
            StreamId::System => "system",
        }
    }

    pub fn raw(&self) -> String {
        match self {
            StreamId::Project(id) => id.0.to_string(),
            StreamId::Workspace(id) => id.0.to_string(),
            StreamId::System => "system".into(),
        }
    }
}

impl fmt::Display for StreamId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.discriminant(), self.raw())
    }
}
