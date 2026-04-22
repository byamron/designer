//! Designer desktop — the application core. The Tauri shell wraps this as a
//! thin IPC handler; all behavior lives in plain async methods on `AppCore` so
//! the library is testable without a WebView.
//!
//! **Why a pure library here:** we can compile + test the full application
//! surface on CI without pulling WebKit frameworks. The Tauri runtime layer is
//! added at the binary edge.

pub mod core;
pub mod crash;
pub mod ipc;
pub mod updater;

pub use core::{AppConfig, AppCore};
pub use crash::{install_panic_hook, CrashReport};
pub use updater::{NoopUpdater, UpdateInfo, UpdateStatus, Updater, UpdaterError};
