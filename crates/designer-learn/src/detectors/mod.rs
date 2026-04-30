//! Phase 21.A2 detectors. Each detector lives in its own sibling module
//! so authors land in parallel without stepping on each other's files.
//! The registry is intentionally a flat `pub mod` list (not a global) so
//! every detector remains unit-testable in isolation; parallel A2 PRs
//! only touch this module's `pub mod` list and the `lib.rs` re-exports.

pub mod approval_always_granted;
pub mod compaction_pressure;
pub mod cost_hot_streak;
pub mod repeated_correction;
pub mod scope_false_positive;

pub use approval_always_granted::ApprovalAlwaysGrantedDetector;
pub use compaction_pressure::CompactionPressureDetector;
pub use cost_hot_streak::CostHotStreakDetector;
pub use repeated_correction::RepeatedCorrectionDetector;
pub use scope_false_positive::ScopeFalsePositiveDetector;
