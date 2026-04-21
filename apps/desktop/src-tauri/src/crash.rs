//! Crash reporting — opt-in, privacy-first.
//!
//! Default: disabled. When enabled by the user, reports are written locally
//! to `~/.designer/crashes/` as structured JSON and only uploaded after the
//! user explicitly reviews + sends. This matches the compliance posture:
//! Designer never ships data off the machine without an informed click.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashReport {
    pub timestamp: String,
    pub version: String,
    pub os: String,
    pub os_version: String,
    pub panic_message: String,
    pub backtrace: String,
    pub redacted_breadcrumbs: Vec<String>,
}

impl CrashReport {
    pub fn capture(message: impl Into<String>, backtrace: impl Into<String>) -> Self {
        Self {
            timestamp: OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            version: env!("CARGO_PKG_VERSION").into(),
            os: std::env::consts::OS.into(),
            os_version: sys_os_version(),
            panic_message: message.into(),
            backtrace: backtrace.into(),
            redacted_breadcrumbs: vec![],
        }
    }

    pub fn persist(&self, dir: &PathBuf) -> std::io::Result<PathBuf> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(format!("crash-{}.json", self.timestamp.replace(':', "-")));
        std::fs::write(&path, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        Ok(path)
    }
}

fn sys_os_version() -> String {
    // Placeholder — Tauri exposes richer platform info; we keep a plain string
    // so the report serializes deterministically in tests.
    std::env::var("OS_VERSION").unwrap_or_else(|_| "unknown".into())
}

/// Install a panic hook that persists crashes locally. Call once at process
/// start; Tauri apps typically do this in `main()`.
pub fn install_panic_hook(dir: PathBuf) {
    let dir = dir.clone();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("{info}");
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let report = CrashReport::capture(msg, backtrace);
        let _ = report.persist(&dir);
        eprintln!("designer: panic captured → {}", dir.display());
    }));
}
