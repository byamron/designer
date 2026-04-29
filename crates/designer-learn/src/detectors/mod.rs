//! Phase 21.A2 detector implementations. Each detector lives in its own
//! sibling module so authors land in parallel without stepping on each
//! other's files.
//!
//! Detectors are registered for runtime use by consumers (today:
//! tests, plus the AppCore wiring in Phase 21.A2's integration step).
//! There is no global registry inside this crate so detectors stay
//! unit-testable in isolation.

pub mod approval_always_granted;
pub mod repeated_correction;

pub use approval_always_granted::ApprovalAlwaysGrantedDetector;
