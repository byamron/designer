//! Phase 21.A2 detector implementations.
//!
//! Each detector lives in its own submodule under
//! `src/detectors/<name>.rs` and implements the locked
//! [`crate::Detector`] trait. Detectors are registered for runtime use
//! by consumers (today: tests + the AppCore wiring in Phase 21.A2's
//! integration step) — there is no global registry inside this crate so
//! that detectors stay unit-testable in isolation.

pub mod approval_always_granted;

pub use approval_always_granted::ApprovalAlwaysGrantedDetector;
