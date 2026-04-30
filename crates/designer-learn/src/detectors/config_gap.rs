//! `config_gap` — formatter / linter / test config exists in the repo
//! but no corresponding entry exists in `.claude/settings.json`'s
//! `hooks` map.
//!
//! Static detection. Reads from [`SessionAnalysisInput::project_root`]
//! and ignores the event stream entirely. For each entry in
//! [`crate::defaults::CONFIG_GAP_HOOK_PATTERNS`], the detector checks
//! whether the corresponding config file is present at the project
//! root, and — when it is — whether `.claude/settings.json` registers a
//! hook whose `command` substring-matches the expected tool. A missing
//! match emits one [`Severity::Notice`] finding with a single
//! [`Anchor::FilePath`] pointing at the config file.
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
//! The detector treats *any* hook command containing the tool's name
//! (case-insensitive substring) as covering that family, so a hook that
//! runs `pnpm exec prettier --write` and the canonical
//! `prettier --write` both count for `.prettierrc`. A user who has
//! intentionally wired a non-canonical command (e.g. `npm run format`
//! that wraps prettier) won't get covered, but that's a documentation
//! issue rather than a finding.
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

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use designer_core::{Anchor, Finding, FindingId, Severity, Timestamp};
use serde_json::Value;

use crate::defaults::{ConfigGapPattern, CONFIG_GAP_HOOK_PATTERNS};
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

    let registered = parse_registered_hooks(project_root);
    let cap = config.max_findings_per_session as usize;
    let mut findings = Vec::new();

    for pattern in CONFIG_GAP_HOOK_PATTERNS {
        if findings.len() >= cap {
            break;
        }
        let Some(config_path) = locate_config_file(project_root, pattern) else {
            continue;
        };
        if hook_covers(&registered, pattern) {
            continue;
        }
        findings.push(build_finding(input, project_root, &config_path, pattern));
    }

    findings
}

/// Resolve the on-disk config file for a pattern. Returns the absolute
/// path when present (and content-gate, if any, satisfied), `None`
/// otherwise.
fn locate_config_file(project_root: &Path, pattern: &ConfigGapPattern) -> Option<PathBuf> {
    let candidate = project_root.join(pattern.filename);
    if !candidate.is_file() {
        return None;
    }
    if let Some(needle) = pattern.require_content {
        let body = std::fs::read_to_string(&candidate).ok()?;
        if !body.contains(needle) {
            return None;
        }
    }
    Some(candidate)
}

/// Read every `hooks.<event>[*].command` string out of
/// `.claude/settings.json`. Returns `None` for the file when it doesn't
/// exist or is malformed — both cases mean "no hook registered for any
/// event" and are handled identically by [`hook_covers`].
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
    for (event, entries) in hooks_obj {
        let Some(arr) = entries.as_array() else {
            continue;
        };
        for entry in arr {
            collect_commands(entry, event, &mut out);
        }
    }
    out
}

/// Walk a single `hooks.<event>[i]` value and pull out every
/// `command` field we can see. Claude Code's documented shape nests
/// commands under a `hooks` array: `{ matcher, hooks: [{ type, command }] }`.
/// We accept the documented shape *and* a flatter `{ command }`
/// fallback so a user-authored settings file with a slightly different
/// structure isn't silently ignored.
fn collect_commands(entry: &Value, event: &str, out: &mut Vec<RegisteredHook>) {
    if let Some(cmd) = entry.get("command").and_then(Value::as_str) {
        out.push(RegisteredHook {
            event: event.to_string(),
            command: cmd.to_string(),
        });
    }
    if let Some(nested) = entry.get("hooks").and_then(Value::as_array) {
        for sub in nested {
            if let Some(cmd) = sub.get("command").and_then(Value::as_str) {
                out.push(RegisteredHook {
                    event: event.to_string(),
                    command: cmd.to_string(),
                });
            }
        }
    }
}

#[derive(Debug)]
struct RegisteredHook {
    event: String,
    command: String,
}

fn hook_covers(registered: &[RegisteredHook], pattern: &ConfigGapPattern) -> bool {
    let needle = pattern.command_substr.to_ascii_lowercase();
    registered
        .iter()
        .filter(|h| h.event.eq_ignore_ascii_case(pattern.event))
        .any(|h| h.command.to_ascii_lowercase().contains(&needle))
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

    let summary = trim_summary(format!(
        "{} config present, {} hook missing in .claude/settings.json",
        pattern.label, pattern.event
    ));

    let digest_keys = [pattern.label, pattern.event, relative.as_str()];
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
        // settings.json without any prettier hook.
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
    fn quiet_when_matching_hook_present() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        // Documented Claude Code hook shape: `hooks: [{ command }]`.
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
        // Empty project root.
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn fires_when_settings_json_missing_entirely() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        // No `.claude/settings.json` — every config gap fires.
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn flat_command_shape_also_matches() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        // Flatter `{ command }` shape (still accepted by the parser).
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"PostToolUse":[{"command":"prettier --write"}]}}"#,
        );
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn pyproject_toml_without_tool_section_is_quiet() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "pyproject.toml", "[project]\nname = \"foo\"\n");
        // No `[tool.ruff]` / `[tool.black]` sections — gating skips both
        // pyproject patterns even though the file exists.
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
    fn cargo_toml_without_test_section_is_quiet() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "Cargo.toml",
            "[package]\nname = \"foo\"\nversion = \"0.1.0\"\n",
        );
        // No `[[test]]` entry → gating skips.
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
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
        // Builder default leaves project_root as None.
        let input = SessionAnalysisInput::builder(ProjectId::new()).build();
        let findings = super::run(&input, &HOOK_DEFAULTS);
        assert!(findings.is_empty());
    }

    #[test]
    fn malformed_settings_treated_as_no_hooks() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        // Garbage inside settings.json — same outcome as a missing file.
        write(tmp.path(), ".claude/settings.json", "not json {");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn matches_are_case_insensitive() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), ".prettierrc", "{}\n");
        // Hook command in mixed case still matches the lowercase substring.
        write(
            tmp.path(),
            ".claude/settings.json",
            r#"{"hooks":{"posttoolUSE":[{"command":"PRETTIER --write"}]}}"#,
        );
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }
}
