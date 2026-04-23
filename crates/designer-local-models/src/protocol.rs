//! JSON-over-stdio protocol between Rust and the Swift Foundation helper.
//! Stable, documented, version-gated.

use serde::{Deserialize, Serialize};

/// Every request is prefixed by a 4-byte big-endian length and a JSON body
/// containing a `kind` tag plus job-specific fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HelperRequest {
    Ping,
    Generate { job: JobKind, prompt: String },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    ContextOptimize,
    Recap,
    AuditClaim,
    SummarizeRow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HelperResponse {
    Pong { version: String, model: String },
    Text { text: String },
    Error { message: String },
}

/// Framing: 4-byte BE length, then JSON payload. Keeps things portable and
/// cheap on both ends.
#[allow(dead_code)]
pub fn frame(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + bytes.len());
    let len = bytes.len() as u32;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(bytes);
    out
}
