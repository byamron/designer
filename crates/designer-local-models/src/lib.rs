//! Local-model ops layer. Shells out to a Swift helper binary
//! (`helpers/foundation/`) that wraps Apple Foundation Models via JSON-over-
//! stdio. Consumers see a small set of typed jobs — `context_optimize`,
//! `recap`, `audit_claim`, `summarize_row` — not the raw prompt interface.
//!
//! **Fallback:** when the helper is unavailable (older macOS, no Apple
//! Intelligence, missing binary) the `NullHelper` returns deterministic
//! placeholder responses so the rest of the app still works.
//!
//! **Supervisor:** the Swift helper is driven by a supervised subprocess
//! (`SwiftFoundationHelper`). Failed requests fail fast (`Unavailable`); the
//! supervisor respawns lazily with exponential backoff and demotes after
//! repeated failures. See `runner` module docs.
//!
//! **Rate limiting + caching** live Rust-side so the Swift helper is a thin
//! inference layer.

mod cache;
mod ops;
mod protocol;
mod ratelimit;
mod runner;

pub use cache::{CacheKey, ResponseCache};
pub use ops::{
    AuditClaim, AuditVerdict, ContextOptimizerInput, ContextOptimizerOutput, FoundationLocalOps,
    LocalOps, RecapInput, RecapOutput, RowSummarizeInput, RowSummarizeOutput,
};
pub use protocol::{HelperRequest, HelperResponse, JobKind};
pub use ratelimit::RateLimiter;
pub use runner::{
    probe_helper, FoundationHelper, HelperError, HelperEvent, HelperHealth, HelperResult,
    HelperTuning, NullHelper, SwiftFoundationHelper,
};
