//! Designer desktop — the application core. The Tauri shell wraps this as a
//! thin IPC handler; all behavior lives in plain async methods on `AppCore` so
//! the library is testable without a WebView.
//!
//! **Why a pure library here:** we can compile + test the full application
//! surface on CI without pulling WebKit frameworks. The Tauri runtime layer is
//! added at the binary edge.

pub mod commands;
pub mod commands_agents;
pub mod commands_friction;
pub mod commands_git;
pub mod commands_local;
pub mod commands_safety;
pub mod core;
pub mod core_agents;
pub mod core_friction;
pub mod core_git;
pub mod core_local;
pub mod core_safety;
pub mod crash;
pub mod events;
pub mod ipc;
pub mod ipc_agents;
pub mod menu;
pub mod settings;
pub mod updater;

pub use core::{AppConfig, AppCore};
pub use crash::{install_panic_hook, CrashReport};
pub use settings::{ResolvedTheme, Settings, ThemeChoice};
pub use updater::{NoopUpdater, UpdateInfo, UpdateStatus, Updater, UpdaterError};
