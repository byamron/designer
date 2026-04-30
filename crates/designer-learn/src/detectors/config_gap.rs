//! `config_gap` — formatter / linter / test config exists in the repo
//! but no corresponding entry exists in `.claude/settings.json`'s
//! `hooks` map.
//!
//! Static detection. Reads from [`SessionAnalysisInput::project_root`]
//! and ignores the event stream entirely. The detector lists the project
//! root once, then for each child filename checks every entry in
//! [`crate::defaults::CONFIG_GAP_HOOK_PATTERNS`] that matches it. When
//! `.claude/settings.json` does not register a hook whose `command`
//! substring-matches the expected tool, one [`Severity::Notice`] finding
//! is emitted with a single [`Anchor::FilePath`] pointing at the config
//! file.
//!
//! ## Forge co-installation
//!
//! Listed in [`crate::FORGE_OVERLAP_DETECTORS`] — Forge ships an
//! equivalent. The AppCore wiring defaults the config to
//! [`DetectorConfig::DISABLED`] when Forge is co-installed; running the
//! detector with that config short-circuits to an empty `Vec` here.
//!
//! ## False-positive posture
//!
//! Per the roadmap directive, the matcher is **lenient** —
//! false-negatives are fine; false-positives cost the user attention.
//! `command` matching is case-insensitive substring (so
//! `pnpm exec prettier --write` covers `.prettierrc`), but the hook
//! event name is matched **case-sensitively** because Claude Code
//! requires exact case at runtime — a typo'd event name is a real bug
//! the user wants surfaced, not a silent pass.
//!
//! ## Output
//!
//! - One finding per (config file × missing hook). Tools that share a
//!   config file (e.g. `pyproject.toml` carries both ruff and black)
//!   may produce multiple findings — each is its own gap.
//! - `confidence: 0.7` — the signal is structural rather than
//!   probabilistic; either the hook entry is there or it isn't.
//! - `summary` is evidence text per the 21.A1.2 surface contract:
//!   passive voice, ≤80 chars, no second-person.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use designer_core::{Anchor, Finding, FindingId, Severity, Timestamp};
use serde_json::Value;

use crate::defaults::{ConfigGapPattern, HookEvent, CONFIG_GAP_HOOK_PATTERNS};
use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};

/// Forge-overlap detector. Always-on confidence is structural — the
/// signal is "the hook is or isn't in the JSON", not a noisy probability.
#[derive(Debug, Default, Clone, Copy)]
pub struct ConfigGapDetector;

impl ConfigGapDetector {
    pub const NAME: &'static str = "config_gap";
    pub const VERSION: u32 = 1;
    /// Single-shot structural confidence. Calibration data may push this
    /// up or down later; bump `VERSION` if it moves.
    const CONFIDENCE: f32 = 0.7;
    /// Char budget for the evidence summary. Matches the 21.A1.2
    /// "Summary copy" guidance (≤80 chars).
    const SUMMARY_BUDGET: usize = 80;
}

#[async_trait]
impl Detector for ConfigGapDetector {
    fn name(&self) -> &'static str {
        Self::NAME
    }

    fn version(&self) -> u32 {
        Self::VERSION
    }

    #[cfg(feature = "local-ops")]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
        _ops: Option<&dyn designer_local_models::LocalOps>,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(run(input, config))
    }

    #[cfg(not(feature = "local-ops"))]
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
    ) -> Result<Vec<Finding>, DetectorError> {
        Ok(run(input, config))
    }
}

fn run(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled || config.max_findings_per_session == 0 {
        return Vec::new();
    }
    let Some(project_root) = input.project_root.as_ref() else {
        return Vec::new();
    };

    let entries = list_root_files(project_root);
    let registered = parse_registered_hooks(project_root);
    let cap = config.max_findings_per_session as usize;
    let mut content_cache: HashMap<PathBuf, String> = HashMap::new();
    let mut findings = Vec::new();

    for pattern in CONFIG_GAP_HOOK_PATTERNS {
        if findings.len() >= cap {
            break;
        }
        let Some(path) = entries.iter().find(|p| match_filename(p, &pattern.file)) else {
            continue;
        };
        if let Some(needle) = pattern.require_content {
            match read_cached(path, &mut content_cache) {
                Some(body) if body.contains(needle) => {}
                // Either the read failed (skip — lenient) or the gate
                // substring is absent (this row doesn't apply).
                _ => continue,
            }
        }
        if hook_covers(&registered, pattern) {
            continue;
        }
        findings.push(build_finding(input, project_root, path, pattern));
    }

    findings
}

/// Read the project root's direct children once. Returns regular-file
/// paths only; subdirectories and unreadable entries are skipped.
fn list_root_files(project_root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(project_root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            path.is_file().then_some(path)
        })
        .collect()
}

fn match_filename(path: &Path, file: &crate::defaults::FileMatch) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| file.matches(name))
}

/// Cached `read_to_string`. Two patterns may share a file
/// (`pyproject.toml` for ruff and black); the second hit returns the
/// already-buffered body. `None` propagates the read error to the
/// caller so the pattern is skipped per the lenient false-positive
/// posture.
fn read_cached<'a>(path: &Path, cache: &'a mut HashMap<PathBuf, String>) -> Option<&'a str> {
    if !cache.contains_key(path) {
        let body = std::fs::read_to_string(path).ok()?;
        cache.insert(path.to_path_buf(), body);
    }
    cache.get(path).map(String::as_str)
}

/// Read every `(event, lower_command)` pair out of `.claude/settings.json`.
/// Returns an empty vec when the file is missing or malformed — both
/// cases mean "no hook registered" and are handled identically by
/// [`hook_covers`]. Unrecognized event names are dropped here so the
/// detector treats a typo'd event the same as a missing one.
fn parse_registered_hooks(project_root: &Path) -> Vec<RegisteredHook> {
    let path = project_root.join(".claude").join("settings.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let Some(hooks_obj) = json.get("hooks").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for (event_str, entries) in hooks_obj {
        let Some(event) = HookEvent::parse(event_str) else {
            continue;
        };
        let Some(arr) = entries.as_array() else {
            continue;
        };
        for entry in arr {
            push_commands(entry, event, &mut out);
        }
    }
    out
}

/// Pull every `command` field out of a single `hooks.<event>[i]` value.
/// Claude Code's documented shape nests commands under a `hooks` array
/// (`{ matcher, hooks: [{ type, command }] }`); we also accept a flat
/// `{ command }` so a slightly different user-authored shape isn't
/// silently ignored. Commands are lowercased once at parse time so
/// [`hook_covers`]'s per-pattern substring scan stays a borrow.
fn push_commands(entry: &Value, event: HookEvent, out: &mut Vec<RegisteredHook>) {
    let mut record = |cmd: &str| {
        out.push(RegisteredHook {
            event,
            command_lower: cmd.to_ascii_lowercase(),
        });
    };
    if let Some(cmd) = entry.get("command").and_then(Value::as_str) {
        record(cmd);
    }
    let Some(nested) = entry.get("hooks").and_then(Value::as_array) else {
        return;
    };
    for sub in nested {
        if let Some(cmd) = sub.get("command").and_then(Value::as_str) {
            record(cmd);
        }
    }
}

#[derive(Debug)]
struct RegisteredHook {
    event: HookEvent,
    /// Pre-lowercased so substring matching is a borrow, not an alloc.
    command_lower: String,
}

/// `true` when at least one registered hook on the same event runs a
/// command containing the pattern's tool name (case-insensitive
/// substring; the lower form is precomputed at parse time).
fn hook_covers(registered: &[RegisteredHook], pattern: &ConfigGapPattern) -> bool {
    let needle = pattern.command_substr.to_ascii_lowercase();
    registered
        .iter()
        .filter(|h| h.event == pattern.event)
        .any(|h| h.command_lower.contains(&needle))
}

fn build_finding(
    input: &SessionAnalysisInput,
    project_root: &Path,
    config_path: &Path,
    pattern: &ConfigGapPattern,
) -> Finding {
    let relative = config_path
        .strip_prefix(project_root)
        .unwrap_or(config_path)
        .to_string_lossy()
        .into_owned();

    let event = pattern.event.as_str();
    let summary = trim_summary(format!(
        "{} config present, {} hook missing in .claude/settings.json",
        pattern.label, event
    ));

    let digest_keys = [pattern.label, event, relative.as_str()];
    let window_digest = window_digest(ConfigGapDetector::NAME, &digest_keys);

    Finding {
        id: FindingId::new(),
        detector_name: ConfigGapDetector::NAME.to_string(),
        detector_version: ConfigGapDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: input
            .events
            .last()
            .map(|e| e.timestamp)
            .unwrap_or(Timestamp::UNIX_EPOCH),
        severity: Severity::Notice,
        confidence: ConfigGapDetector::CONFIDENCE,
        summary,
        evidence: vec![Anchor::FilePath {
            path: relative,
            line_range: None,
        }],
        suggested_action: None,
        window_digest,
    }
}

fn trim_summary(summary: String) -> String {
    if summary.chars().count() <= ConfigGapDetector::SUMMARY_BUDGET {
        return summary;
    }
    let mut out: String = summary
        .chars()
        .take(ConfigGapDetector::SUMMARY_BUDGET - 1)
        .collect();
    out.push('\u{2026}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::HOOK_DEFAULTS;
    use designer_core::ProjectId;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &Path, rel: &str, body: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(&path, body).expect("write");
    }

    fn run_against(dir: &Path) -> Vec<Finding> {
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .project_root(dir)
            .build();
        super::run(&input, &HOOK_DEFAULTS)
    }

    #[test]
    fn fires_when_prettierrc_present_and_hook_missing() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"PostToolUse":[]}}"#,
        );

        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1, "expected one gap, got {findings:?}");
        let f = &findings[0];
        assert_eq!(f.detector_name, ConfigGapDetector::NAME);
        assert_eq!(f.detector_version, 1);
        assert_eq!(f.severity, Severity::Notice);
        assert!((f.confidence - ConfigGapDetector::CONFIDENCE).abs() < f32::EPSILON);
        assert!(f.summary.contains("prettier"));
        assert!(f.summary.contains("PostToolUse"));
        assert!(!f.summary.to_lowercase().contains(" you "));
        assert!(f.summary.chars().count() <= 80);
        assert_eq!(f.evidence.len(), 1);
        match &f.evidence[0] {
            Anchor::FilePath { path, line_range } => {
                assert_eq!(path, ".prettierrc");
                assert!(line_range.is_none());
            }
            other => panic!("expected FilePath anchor, got {other:?}"),
        }
    }

    #[test]
    fn prefix_match_catches_unenumerated_extension() {
        let tmp = TempDir::new().unwrap();
        // `.prettierrc.toml` isn't an exact entry anywhere — the prefix
        // `.prettierrc` covers it.
        write(tmp.path(), ".prettierrc.toml", "semi = false\n");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("prettier"));
    }

    #[test]
    fn quiet_when_matching_hook_present() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"PostToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"pnpm exec prettier --write"}]}]}}"#,
        );
        let findings = run_against(tmp.path());
        assert!(
            findings.is_empty(),
            "matching hook should suppress, got {findings:?}"
        );
    }

    #[test]
    fn quiet_when_no_config_files_at_all() {
        let tmp = TempDir::new().unwrap();
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn fires_when_settings_json_missing_entirely() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn flat_command_shape_also_matches() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"PostToolUse":[{"command":"prettier --write"}]}}"#,
        );
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn typoed_event_name_does_not_count_as_covered() {
        // Claude Code requires exact case for event names; a hook
        // registered under `posttoolUSE` will never fire at runtime.
        // Surfacing the gap is the right call — it catches a real bug.
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"posttoolUSE":[{"command":"prettier --write"}]}}"#,
        );
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1, "typo'd event should still fire the gap");
    }

    #[test]
    fn pyproject_toml_without_tool_section_is_quiet() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "pyproject.toml", "[project]\nname = \"foo\"\n");
        let findings = run_against(tmp.path());
        assert!(
            findings.is_empty(),
            "pyproject without tool sections should not fire: {findings:?}"
        );
    }

    #[test]
    fn pyproject_toml_with_ruff_fires() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "pyproject.toml",
            "[project]\nname = \"foo\"\n\n[tool.ruff]\nline-length = 88\n",
        );
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("ruff"));
    }

    #[test]
    fn pyproject_toml_with_both_tools_fires_twice() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "pyproject.toml",
            "[tool.ruff]\nline-length = 88\n\n[tool.black]\nline-length = 88\n",
        );
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 2);
        let labels: Vec<&str> = findings.iter().map(|f| f.summary.as_str()).collect();
        assert!(labels.iter().any(|s| s.contains("ruff")));
        assert!(labels.iter().any(|s| s.contains("black")));
    }

    #[test]
    fn cargo_toml_without_test_section_is_quiet() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "Cargo.toml",
            "[package]\nname = \"foo\"\nversion = \"0.1.0\"\n",
        );
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn cargo_toml_with_test_section_fires() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "Cargo.toml",
            "[package]\nname = \"foo\"\nversion = \"0.1.0\"\n\n[[test]]\nname = \"smoke\"\npath = \"tests/smoke.rs\"\n",
        );
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("cargo test"));
        assert!(findings[0].summary.contains("PrePush"));
    }

    #[test]
    fn disabled_config_emits_nothing() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .project_root(tmp.path())
            .build();
        let findings = super::run(&input, &DetectorConfig::DISABLED);
        assert!(findings.is_empty());
    }

    #[test]
    fn no_project_root_emits_nothing() {
        let input = SessionAnalysisInput::builder(ProjectId::new()).build();
        let findings = super::run(&input, &HOOK_DEFAULTS);
        assert!(findings.is_empty());
    }

    #[test]
    fn malformed_settings_treated_as_no_hooks() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(tmp.path(), ".claude/settings.json", "not json {");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn command_match_is_case_insensitive() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"PostToolUse":[{"command":"PRETTIER --write"}]}}"#,
        );
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn cap_short_circuits_finding_count() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        write(tmp.path(), "biome.json", "{}\n");
        write(tmp.path(), "pytest.ini", "[pytest]\n");
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .project_root(tmp.path())
            .build();
        let cfg = DetectorConfig {
            enabled: true,
            max_findings_per_session: 2,
            ..DetectorConfig::default()
        };
        let findings = super::run(&input, &cfg);
        assert_eq!(findings.len(), 2, "cap should bound emission");
    }
}
