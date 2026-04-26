//! Safety infrastructure. Hard gates live here and are enforced in the core
//! (not the frontend) — a frontend compromise cannot bypass approvals,
//! cost caps, or scope rules.
//!
//! Four primitives:
//!
//! * `ApprovalGate` — request/review/respond flow. Any gated action goes
//!   through a single enforcement point.
//! * `CostTracker` — per-workspace token + dollar accounting with caps.
//! * `ScopeGuard` — allow/deny path patterns enforced at the filesystem
//!   boundary before any write is issued.
//! * `CspBuilder` — strict Content-Security-Policy strings for HTML previews.

mod approval;
mod cost;
mod csp;
mod scope;

pub use approval::{
    ApprovalDecision, ApprovalGate, ApprovalRequest, ApprovalStatus, InMemoryApprovalGate,
};
pub use cost::{usd_to_cents, CostCap, CostTracker, CostUsage};
pub use csp::{CspBuilder, CspDirective, SANDBOX_ATTRIBUTE};
pub use scope::{ScopeGuard, ScopeRule, ScopeVerdict};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SafetyError {
    #[error("approval denied: {0}")]
    ApprovalDenied(String),
    #[error("cost cap exceeded: {0}")]
    CostCapExceeded(String),
    #[error("scope denied: {0}")]
    ScopeDenied(String),
    #[error("core error: {0}")]
    Core(#[from] designer_core::CoreError),
    #[error("pattern compile: {0}")]
    Pattern(#[from] globset::Error),
}

pub type SafetyResult<T> = std::result::Result<T, SafetyError>;
