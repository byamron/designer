//! Local user preferences for the desktop shell.
//!
//! Lives as a sidecar `settings.json` in the app data dir — deliberately *not*
//! in the event store. Theme (and future UI prefs) are per-install local state
//! that must never sync over the Phase 14 transport. The event store stays a
//! domain-truth log; this file stays a local preference file.
//!
//! The load path is synchronous (no tokio) so the boot sequence can read theme
//! before the window opens, eliminating the cold-boot flash.

use designer_core::{ProjectId, Timestamp};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

/// Per-feature opt-in toggles. The DP-C reliability audit (2026-04-30)
/// set the project rule: half-baked features should not appear in prod
/// without an explicit user opt-in. Each field defaults to `false` so a
/// fresh install never surfaces a placeholder — **except** for flags
/// that have shipped through Phase 24's Build-cycle audit and flipped
/// default ON (currently `show_chat_v2`).
///
/// Add a new flag by adding a field with `#[serde(default)]`; the IPC
/// surface (`cmd_set_feature_flag`) matches by field name. Legacy
/// settings files without the `feature_flags` key load with all
/// flags off via the outer `#[serde(default)]` on `Settings` — except
/// for flags with an explicit `#[serde(default = "...")]` attribute,
/// which read from their named default fn.
///
/// **Note on `Default` impl.** The serde `#[serde(default = "...")]`
/// attribute only fires when deserializing JSON with a missing field.
/// The Rust-level `Default::default()` (called on first-time install
/// when settings.json doesn't exist — see `Settings::load`'s
/// `NotFound` branch) needs a hand-rolled `Default` impl so the same
/// defaults apply on both paths. **Do not switch back to `#[derive
/// (Default)]`** — that would silently regress flags like
/// `show_chat_v2` for first-time installs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlags {
    /// Show the Settings → Models pane. Currently a static placeholder
    /// (no model selection mechanism). Off by default until per-tab
    /// model override ships.
    #[serde(default)]
    pub show_models_section: bool,
    /// Surface every `ArtifactCreated` event in the activity spine
    /// (including per-tool-use `Used Read` / `Used Edit` reports). Off by
    /// default — the spine projection's allowlist (`SPINE_ARTIFACT_KINDS`
    /// plus `SPINE_AUTHOR_ROLES`) keeps the rail focused on substantive
    /// artifacts. Flip on for debugging or when triaging what the
    /// orchestrator emitted.
    #[serde(default)]
    pub show_all_artifacts_in_spine: bool,
    /// Phase 22.A — render the Roadmap canvas as the lead surface on the
    /// project Home tab. When on, the canvas replaces the
    /// Active-workspaces / Autonomy / Needs-your-attention sections at
    /// project altitude. Off by default until the canvas matures past
    /// the dogfood-readiness bar.
    #[serde(default)]
    pub show_roadmap_canvas: bool,
    /// Phase 22.B — show the new "Recent Reports" surface on the Home
    /// tab (curated highlights of shipped work in manager voice). Off
    /// by default until the on-device summary hook reliably produces
    /// `summary_high`. When off, HomeTabA renders the legacy report
    /// rendering only.
    #[serde(default)]
    pub show_recent_reports_v2: bool,
    /// Phase 24 (ADR 0008) — emit the new `AgentTurn*` chat-domain
    /// event family from the stream translator and route the renderer
    /// through the Phase 24 chat surface. **Default ON as of Step 13
    /// (2026-05-12)** — the A1–A12 contract-level coverage audit
    /// (`core-docs/phases/phase-24-pass-through-chat.md` §6.1) pinned each
    /// criterion to its test, and PRs #119–#133 shipped every
    /// behavioral piece (translator, bridge, renderer, queue, ESC +
    /// SIGINT, dispatch contract, render-time activity indicator,
    /// detector dual-shape, §5.6 error copy). When ON, the translator
    /// emits `AgentTurn*`, the bridge in
    /// `core_agents::spawn_message_coalescer` persists them, the
    /// activity indicator is a render-time observable, and the
    /// renderer's per-block accumulator drives the chat thread.
    ///
    /// Setting the flag OFF still works for back-compat (the legacy
    /// `MessagePosted` / `ArtifactProduced` arms of the
    /// broadcast→store bridge remain) but is no longer the default.
    /// The legacy-arms cleanup is filed as a Phase 24H follow-up — the
    /// `spawn_message_coalescer` function itself stays load-bearing as
    /// the broadcast→store bridge for `AgentTurn*` events; only the
    /// chat-v1-specific arms inside it retire.
    ///
    /// **Transition behaviour:** the flag is read once at subprocess
    /// spawn; flipping it only takes effect on the next respawn (next
    /// user message after a model swap or tab re-open).
    #[serde(default = "default_show_chat_v2")]
    pub show_chat_v2: bool,
}

/// Phase 24 (ADR 0008) — `show_chat_v2` defaults ON as of Step 13.
/// Old settings.json files predating the flip de-serialize through
/// this fn (the `#[serde(default = ...)]` on the field) and pick up
/// the new default. Users who explicitly disabled chat-v2 in settings
/// (`"show_chat_v2": false`) keep their override.
fn default_show_chat_v2() -> bool {
    true
}

impl Default for FeatureFlags {
    /// Hand-rolled to keep the Rust-level default in sync with the
    /// serde-level per-field defaults. First-time installs hit this
    /// path through `Settings::load`'s `NotFound` branch (no
    /// settings.json file yet); without this impl they would silently
    /// regress `show_chat_v2` back to `false` even though the field's
    /// `#[serde(default = "...")]` says otherwise.
    ///
    /// When adding a new flag with a non-`false` default, update this
    /// impl alongside the serde attribute. The
    /// `feature_flags_first_run_default_matches_serde_default` test
    /// below pins the contract.
    fn default() -> Self {
        Self {
            show_models_section: false,
            show_all_artifacts_in_spine: false,
            show_roadmap_canvas: false,
            show_recent_reports_v2: false,
            show_chat_v2: default_show_chat_v2(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub theme: ThemeChoice,
    #[serde(default = "default_version")]
    pub version: u32,
    /// Show the cost chip in the workspace topbar. On by default since
    /// real-Claude mode means every turn costs money — usage visibility
    /// is the right default for a daily driver. Users can hide it via
    /// settings if they don't want the signal.
    #[serde(default = "default_cost_chip_enabled")]
    pub cost_chip_enabled: bool,
    /// Force the mock orchestrator instead of the configured default.
    /// `None` = use whatever `AppConfig.use_mock_orchestrator` is set to.
    /// `Some(true)` = force mock (useful for offline demos / replay tests).
    /// `Some(false)` = force real Claude. Settable from the UI's
    /// experimental section.
    #[serde(default)]
    pub use_mock_orchestrator: Option<bool>,
    /// Per-feature opt-in toggles for surfaces that aren't ready for
    /// default-on dogfood. See `FeatureFlags`.
    #[serde(default)]
    pub feature_flags: FeatureFlags,
    /// Phase 22.B — last-seen mark per project for the Recent Reports
    /// surface. Persisted in the Settings sidecar (NOT in the event log
    /// — see roadmap §22.B "projection, not events"). The in-memory
    /// projection mirrors this on boot via
    /// `Projector::hydrate_report_read_marks`.
    #[serde(default)]
    pub report_read_at_by_project: BTreeMap<ProjectId, Timestamp>,
}

fn default_version() -> u32 {
    1
}

fn default_cost_chip_enabled() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: ThemeChoice::default(),
            version: 1,
            cost_chip_enabled: true,
            use_mock_orchestrator: None,
            feature_flags: FeatureFlags::default(),
            report_read_at_by_project: BTreeMap::new(),
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
        // Real-Claude mode is the default; the cost chip is on so the user
        // sees per-turn spend without an opt-in step.
        assert!(
            s.cost_chip_enabled,
            "cost chip should default on for daily-driver real-Claude use"
        );
        assert_eq!(
            s.use_mock_orchestrator, None,
            "no override by default; AppConfig decides"
        );
    }

    #[test]
    fn legacy_settings_without_use_mock_field_loads() {
        // A settings.json written before the field existed must still
        // deserialize — the field uses serde(default) so missing → None.
        let dir = tempdir().unwrap();
        fs::write(
            Settings::path(dir.path()),
            br#"{"theme":"dark","version":1,"cost_chip_enabled":true}"#,
        )
        .unwrap();
        let s = Settings::load(dir.path());
        assert_eq!(s.theme, ThemeChoice::Dark);
        assert_eq!(s.use_mock_orchestrator, None);
    }

    #[test]
    fn legacy_settings_without_feature_flags_loads_at_per_field_defaults() {
        // DP-C: feature_flags is additive; legacy files without it must
        // load with every flag at its per-field default. Pre-Phase-24
        // every default was `false`; Phase 24 step 13 flipped
        // `show_chat_v2` to default ON, so a legacy file without the
        // feature_flags object now gets show_chat_v2: true (via the
        // outer `#[serde(default)]` on Settings → FeatureFlags::default()
        // → the hand-rolled Default impl that mirrors the serde
        // per-field defaults).
        let dir = tempdir().unwrap();
        fs::write(
            Settings::path(dir.path()),
            br#"{"theme":"dark","version":1,"cost_chip_enabled":true}"#,
        )
        .unwrap();
        let s = Settings::load(dir.path());
        assert!(!s.feature_flags.show_models_section);
        assert!(!s.feature_flags.show_all_artifacts_in_spine);
        assert!(
            s.feature_flags.show_chat_v2,
            "Phase 24 step 13 — chat-v2 default ON applies to legacy files without feature_flags too"
        );
    }

    #[test]
    fn feature_flags_default_off() {
        let s = Settings::default();
        assert!(
            !s.feature_flags.show_models_section,
            "experimental Models pane stays off by default"
        );
        assert!(
            !s.feature_flags.show_all_artifacts_in_spine,
            "spine pollution debug flag stays off by default"
        );
    }

    /// Phase 24 step 13 — first-time installs (no settings.json) must
    /// see the same defaults as users whose settings.json is missing
    /// individual fields. The serde `#[serde(default = "...")]` only
    /// fires on JSON deserialization; the Rust-level `Default::default()`
    /// (called via `Settings::load`'s `NotFound` branch) needs its own
    /// hand-rolled impl in lock-step. If a new flag flips default ON
    /// at the serde level but the Rust `Default` impl misses it,
    /// first-time installs silently regress.
    #[test]
    fn feature_flags_first_run_default_matches_serde_default() {
        let rust_default = FeatureFlags::default();

        // Deserialize an empty `{}` object — serde fires every field's
        // `#[serde(default ...)]` attribute. The two paths must agree.
        let serde_default: FeatureFlags = serde_json::from_str("{}").unwrap();

        assert_eq!(
            rust_default.show_chat_v2, serde_default.show_chat_v2,
            "first-run default for show_chat_v2 must match the serde default"
        );
        assert_eq!(
            rust_default.show_models_section,
            serde_default.show_models_section
        );
        assert_eq!(
            rust_default.show_all_artifacts_in_spine,
            serde_default.show_all_artifacts_in_spine
        );
        assert_eq!(
            rust_default.show_roadmap_canvas,
            serde_default.show_roadmap_canvas
        );
        assert_eq!(
            rust_default.show_recent_reports_v2,
            serde_default.show_recent_reports_v2
        );

        // Pin the specific Phase 24 step 13 contract: show_chat_v2 defaults ON.
        assert!(
            rust_default.show_chat_v2,
            "Phase 24 step 13 — show_chat_v2 defaults ON for first-time installs"
        );
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
        assert_eq!(
            ResolvedTheme::Light.background_rgba(),
            (0xFD, 0xFC, 0xFD, 0xFF)
        );
        assert_eq!(
            ResolvedTheme::Dark.background_rgba(),
            (0x18, 0x18, 0x1A, 0xFF)
        );
    }
}
