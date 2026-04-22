//! Local user preferences for the desktop shell.
//!
//! Lives as a sidecar `settings.json` in the app data dir — deliberately *not*
//! in the event store. Theme (and future UI prefs) are per-install local state
//! that must never sync over the Phase 14 transport. The event store stays a
//! domain-truth log; this file stays a local preference file.
//!
//! The load path is synchronous (no tokio) so the boot sequence can read theme
//! before the window opens, eliminating the cold-boot flash.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeChoice {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolvedTheme {
    Light,
    Dark,
}

impl ResolvedTheme {
    /// RGBA bytes used for both the NSWindow background and the WKWebView
    /// initial paint. Must match `--color-background` (= `--gray-1` = `mauve-1`)
    /// in `packages/app/src/styles/app.css` for each mode so the first frame
    /// is indistinguishable from the rendered app. Keep in sync when the
    /// gray flavor is swapped (see design-language.md).
    pub fn background_rgba(self) -> (u8, u8, u8, u8) {
        match self {
            // mauve-1 light: #fdfcfd
            ResolvedTheme::Light => (0xFD, 0xFC, 0xFD, 0xFF),
            // mauve-1 dark: #18181a
            ResolvedTheme::Dark => (0x18, 0x18, 0x1A, 0xFF),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ResolvedTheme::Light => "light",
            ResolvedTheme::Dark => "dark",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub theme: ThemeChoice,
    #[serde(default = "default_version")]
    pub version: u32,
}

fn default_version() -> u32 {
    1
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: ThemeChoice::default(),
            version: 1,
        }
    }
}

impl Settings {
    pub fn path(data_dir: &Path) -> PathBuf {
        data_dir.join("settings.json")
    }

    /// Read from disk, or return defaults if the file is missing or malformed.
    /// Corrupt files are logged and overwritten on next save — we never crash
    /// boot on a bad settings file.
    pub fn load(data_dir: &Path) -> Self {
        let path = Self::path(data_dir);
        match fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_else(|err| {
                tracing::warn!(error = %err, path = %path.display(), "settings.json malformed; using defaults");
                Settings::default()
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(err) => {
                tracing::warn!(error = %err, path = %path.display(), "settings.json unreadable; using defaults");
                Settings::default()
            }
        }
    }

    /// Atomic-ish write: temp-file then rename. macOS rename is atomic on the
    /// same filesystem.
    pub fn save(&self, data_dir: &Path) -> std::io::Result<()> {
        fs::create_dir_all(data_dir)?;
        let path = Self::path(data_dir);
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&body)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn resolve(&self) -> ResolvedTheme {
        match self.theme {
            ThemeChoice::Light => ResolvedTheme::Light,
            ThemeChoice::Dark => ResolvedTheme::Dark,
            ThemeChoice::System => detect_system_theme(),
        }
    }
}

fn detect_system_theme() -> ResolvedTheme {
    match dark_light::detect() {
        dark_light::Mode::Dark => ResolvedTheme::Dark,
        // Light + Default both map to light — Default is the macOS fallback
        // when the user hasn't explicitly set a preference.
        dark_light::Mode::Light | dark_light::Mode::Default => ResolvedTheme::Light,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_when_missing() {
        let dir = tempdir().unwrap();
        let s = Settings::load(dir.path());
        assert_eq!(s.theme, ThemeChoice::System);
        assert_eq!(s.version, 1);
    }

    #[test]
    fn roundtrip() {
        let dir = tempdir().unwrap();
        let s = Settings {
            theme: ThemeChoice::Dark,
            ..Settings::default()
        };
        s.save(dir.path()).unwrap();
        let loaded = Settings::load(dir.path());
        assert_eq!(loaded.theme, ThemeChoice::Dark);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = tempdir().unwrap();
        fs::write(Settings::path(dir.path()), b"{not json").unwrap();
        let s = Settings::load(dir.path());
        assert_eq!(s.theme, ThemeChoice::System);
    }

    #[test]
    fn resolved_theme_bg_matches_token() {
        // mauve-1 at two paint surfaces: NSWindow + WKWebView.
        assert_eq!(ResolvedTheme::Light.background_rgba(), (0xFD, 0xFC, 0xFD, 0xFF));
        assert_eq!(ResolvedTheme::Dark.background_rgba(), (0x18, 0x18, 0x1A, 0xFF));
    }
}
