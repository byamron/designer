//! Phase 21.A2 detectors. One module per detector.
//!
//! Each detector lives in its own file under `src/detectors/<name>.rs`,
//! implements the locked [`crate::Detector`] trait, and ships with a
//! fixture pair under `tests/fixtures/<name>/`. See
//! `crates/designer-learn/CONTRIBUTING.md` for the procedure.

pub mod cost_hot_streak;
