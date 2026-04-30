//! Phase 21.A2 detectors. Each detector lives in its own sibling module
//! so authors land in parallel without stepping on each other's files.
//! The registry is intentionally a flat `pub mod` list (not a global) so
//! every detector remains unit-testable in isolation; parallel A2 PRs
//! only touch this module's `pub mod` list and the `lib.rs` re-exports.

pub mod approval_always_granted;
pub mod compaction_pressure;
pub mod config_gap;
pub mod cost_hot_streak;
pub mod domain_specific_in_claude_md;
pub mod memory_promotion;
pub mod multi_step_tool_sequence;
pub mod repeated_correction;
pub mod repeated_prompt_opening;
pub mod scope_false_positive;

pub use approval_always_granted::ApprovalAlwaysGrantedDetector;
pub use compaction_pressure::CompactionPressureDetector;
pub use config_gap::ConfigGapDetector;
pub use cost_hot_streak::CostHotStreakDetector;
pub use domain_specific_in_claude_md::DomainSpecificInClaudeMdDetector;
pub use memory_promotion::MemoryPromotionDetector;
pub use multi_step_tool_sequence::MultiStepToolSequenceDetector;
pub use repeated_correction::RepeatedCorrectionDetector;
pub use repeated_prompt_opening::RepeatedPromptOpeningDetector;
pub use scope_false_positive::ScopeFalsePositiveDetector;
