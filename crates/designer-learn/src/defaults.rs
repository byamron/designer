//! Default thresholds and keyword corpora.
//!
//! Every constant here is migrated **verbatim** from Forge's deterministic
//! analyzer (Phase 21.A1's "Forge co-installation" rule depends on the
//! detector behaviors matching Forge's where they overlap, so a user with
//! both installed sees consistent signal). Each block carries a citation
//! pointing back to the original file + line in Forge so future detector
//! authors can audit drift.
//!
//! **Forge source pin:** `forge` repo at
//! `/Users/benyamron/Desktop/coding/forge/` — the dogfood checkout. When
//! Forge bumps a threshold, this file is the surface that has to update;
//! the detectors read from these constants, never from inline literals.
//!
//! Detector-specific overrides live in [`crate::DetectorConfig`]; the
//! constants below are the *defaults* a detector picks up unless the user
//! has tuned it.

use crate::{DetectorConfig, DEFAULT_MAX_FINDINGS_PER_SESSION};
use designer_core::Severity;

// ---------------------------------------------------------------------------
// Evidence thresholds — `forge/scripts/build-proposals.py` L31-L37 (THRESHOLDS)
// ---------------------------------------------------------------------------

/// Forge `THRESHOLDS["skill"]`. Used by `repeated_prompt_opening` and
/// `multi_step_tool_sequence` (skill-candidate kind).
pub const SKILL_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 4,
    min_sessions: 3,
    impact_override: None,
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// Forge `THRESHOLDS["hook"]`. Used by `post_action_deterministic` and
/// `config_gap` (hook kind).
pub const HOOK_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 5,
    min_sessions: 3,
    impact_override: None,
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// Forge `THRESHOLDS["rule"]`. Used by `repeated_correction` (feedback-rule
/// kind) and `domain_specific_in_claude_md` (rule-extraction kind).
pub const RULE_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 3,
    min_sessions: 2,
    impact_override: None,
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// Forge `THRESHOLDS["claude_md_entry"]`. Used by `memory_promotion`.
pub const CLAUDE_MD_ENTRY_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 3,
    min_sessions: 2,
    impact_override: None,
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// Forge `THRESHOLDS["agent"]`. Used by `multi_step_tool_sequence` when it
/// proposes an agent-candidate.
pub const AGENT_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 5,
    min_sessions: 3,
    impact_override: None,
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

// ---------------------------------------------------------------------------
// Staleness thresholds — `forge/scripts/build-proposals.py` L39-L42
// ---------------------------------------------------------------------------

/// Minimum sessions before `stale_artifact` will fire. With <10 sessions
/// of history, "rule used in 1/3 sessions" is noise, not staleness.
/// Forge `STALENESS_THRESHOLDS["min_sessions_for_analysis"]`.
pub const STALENESS_MIN_SESSIONS: u32 = 10;

/// Reference-rate floor below which an artifact is "stale". Forge
/// `STALENESS_THRESHOLDS["min_reference_ratio"]`.
pub const STALENESS_MIN_REFERENCE_RATIO: f32 = 0.25;

// ---------------------------------------------------------------------------
// Designer-unique detector defaults (no Forge analog).
//
// Severity defaults reflect the asymmetry: approval/scope/cost detectors
// touch the safety perimeter, so they default to `Notice` (visible, not
// urgent) rather than `Info`.
// ---------------------------------------------------------------------------

/// `approval_always_granted`: 5+ grants, 0 denies on a deterministic
/// operation class. Conservative because a false positive proposes
/// auto-approving a class of writes — irreversible if the user accepts
/// without reading.
pub const APPROVAL_ALWAYS_GRANTED_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 5,
    min_sessions: 1,
    impact_override: Some(Severity::Notice),
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// `scope_false_positive`: 3+ same-path denials. Lower bar than
/// `approval_always_granted` because the proposal here *relaxes* a guard
/// rather than disabling it; safer to surface earlier.
pub const SCOPE_FALSE_POSITIVE_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 3,
    min_sessions: 1,
    impact_override: Some(Severity::Notice),
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// `cost_hot_streak`: token-spend outlier vs project baseline on a
/// repeated task. Threshold is "above rolling p90" — stored as 1
/// occurrence + 3 sessions so the detector sees enough baseline before
/// flagging.
pub const COST_HOT_STREAK_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 1,
    min_sessions: 3,
    impact_override: Some(Severity::Notice),
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// `compaction_pressure`: `/compact` invoked ≥1×/session consistently.
/// Forge ships nothing equivalent; threshold "3 sessions in a week" is
/// expressed as min_occurrences=3 across min_sessions=3.
pub const COMPACTION_PRESSURE_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 3,
    min_sessions: 3,
    impact_override: None,
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

// ---------------------------------------------------------------------------
// Keyword corpora — `forge/scripts/analyze-transcripts.py` L141-L201.
//
// Forge stores these as scored regex tables; we ship the keyword list as
// `&[&str]` (the literal phrases, lowercase, anchor-free) and let
// individual detectors compose their own scoring. The detectors don't
// have to share Forge's exact regex engine, but they should all start
// from the same vocabulary so calibration data is comparable.
// ---------------------------------------------------------------------------

/// Strong correction signals. Forge: `_STRONG_CORRECTION`.
/// Detectors should treat each match as high-weight evidence (~0.3-0.4 in
/// Forge's scoring); presence of one is usually enough to record a
/// `repeated_correction` finding when paired with `min_occurrences`
/// thresholds across sessions.
pub const CORRECTION_KEYWORDS_STRONG: &[&str] = &[
    "i told you",
    "that's not right",
    "thats not right",
    "that's wrong",
    "thats wrong",
    "that's incorrect",
    "thats incorrect",
    "i said",
    "we use",
    "use instead",
    "don't use",
    "dont use",
    "don't do",
    "dont do",
    "don't add",
    "dont add",
    "don't change",
    "dont change",
    "don't modify",
    "don't remove",
    "never use",
    "never do",
    "never add",
    "should not",
    "shouldn't",
    "wrong approach",
    "not the right way",
    "not the correct way",
    "not the right approach",
    "not the correct approach",
    "this is the wrong",
];

/// Mild correction signals. Forge: `_MILD_CORRECTION`. Lower weight than
/// strong; detectors typically require 2+ mild matches OR 1 strong match
/// before counting an occurrence.
pub const CORRECTION_KEYWORDS_MILD: &[&str] = &[
    "no,",
    "no.",
    "actually,",
    "actually.",
    "instead,",
    "switch to",
    "wrong",
    "that should be",
    "this should be",
    "not that",
    "scratch that",
    "not quite",
    "do what you had before",
    "revert",
    "undo",
    "add back",
    "dealbreaker",
    "why did you",
    "why would you",
    "what do you mean",
    "too subtle",
    "too much",
    "go back to",
    "we can't",
    "we cant",
    "i want to remove",
    "i want to change",
    "i want to fix",
    "i want to redo",
];

/// Confirmatory openers — *false positives* for correction detection.
/// Forge: `_CONFIRMATORY`. Detectors should subtract weight when these
/// appear at the head of a user message.
pub const CONFIRMATION_KEYWORDS: &[&str] = &[
    "yes",
    "yeah",
    "yep",
    "ok",
    "okay",
    "sure",
    "perfect",
    "great",
    "thanks",
    "thank you",
    "looks good",
    "looks great",
    "lgtm",
    "nice",
    "awesome",
    "exactly",
];

/// Deterministic post-tool commands. Used by `post_action_deterministic`
/// — when Claude writes a file and the user's next message is one of
/// these, that's a hook candidate (`PostToolUse`). Treat as the *prefix*
/// of a shell command; Forge matches with `startswith`.
pub const DETERMINISTIC_POST_TOOL_COMMANDS: &[&str] = &[
    "prettier",
    "eslint",
    "biome",
    "ruff",
    "ruff format",
    "ruff check",
    "black",
    "isort",
    "cargo fmt",
    "cargo clippy",
    "cargo test",
    "pytest",
    "npm test",
    "npm run test",
    "yarn test",
    "pnpm test",
    "bun test",
    "go fmt",
    "gofmt",
    "go test",
    "go vet",
    "make test",
    "make lint",
];

/// Compaction triggers. Designer-unique. The user invoking `/compact`
/// (Claude Code's slash command) is observable as a special `MessagePosted`
/// in the workspace stream.
pub const COMPACTION_KEYWORDS: &[&str] = &["/compact", "/clear"];

// ---------------------------------------------------------------------------
// `config_gap` — config-file → hook-pattern table.
//
// Each entry is `(filename_pattern, expected_event, expected_command_substr,
// human_label)`. The `filename_pattern` is matched as a glob-ish suffix
// against entries in `<project_root>/`: a leading `*` is wildcard prefix
// match, otherwise it's an exact filename match. `expected_event` is the
// Claude Code hook trigger (`PostToolUse`, `PrePush`, etc.). The detector
// reports a gap when no `hooks.<expected_event>[*].command` field in
// `.claude/settings.json` substring-contains `expected_command_substr`.
//
// Filename patterns are intentionally lenient — `.prettierrc` matches both
// `.prettierrc` and `.prettierrc.json`; the matcher is pure-string so a
// `prettier.config.cjs` is caught by `prettier.config.*` without spinning
// up a glob engine.
//
// Forge has an analog (`config_gap` is in `FORGE_OVERLAP_DETECTORS`); the
// table is Designer's own and migrates the *intent* of Forge's check
// rather than its data structure. When Forge bumps a recognized
// formatter family, mirror it here and bump the detector `VERSION`.
// ---------------------------------------------------------------------------

/// Hook-event names emitted by Claude Code's settings file. Keep in sync
/// with the Claude Code docs §"Hook Events" — the JSON shape is
/// `hooks.<event_name>[*].command`.
pub const CONFIG_GAP_EVENT_POST_TOOL_USE: &str = "PostToolUse";
pub const CONFIG_GAP_EVENT_PRE_COMMIT: &str = "PreCommit";
pub const CONFIG_GAP_EVENT_PRE_PUSH: &str = "PrePush";

/// Single row of the [`CONFIG_GAP_HOOK_PATTERNS`] table. Tuple form keeps
/// the table readable as a `pub const &[…]`; the detector reads positionally.
pub struct ConfigGapPattern {
    /// Filename or glob suffix matched against direct children of
    /// `<project_root>/`. `*.toml` = "ends with `.toml`"; an exact name
    /// like `biome.json` only matches `biome.json`.
    pub filename: &'static str,
    /// Claude Code hook event the missing hook would register under.
    pub event: &'static str,
    /// Substring that must appear in the hook's `command` field for the
    /// hook to count as "covers this config." Matched case-insensitively
    /// against the trimmed command.
    pub command_substr: &'static str,
    /// Human-readable family label for the summary. Lowercase, short.
    pub label: &'static str,
    /// Optional file-content substring that must also be present for the
    /// pattern to apply. `None` means "filename match is sufficient";
    /// `Some("[tool.ruff]")` means "only flag a `pyproject.toml` that
    /// declares a `[tool.ruff]` section." Designer-unique gating —
    /// `pyproject.toml` is too common to flag wholesale.
    pub require_content: Option<&'static str>,
}

/// Designer-unique. Each row encodes one (config file → expected hook)
/// relationship. The table is intentionally short — it covers the
/// formatters / linters / test runners every Designer dogfooder uses.
/// Adding a new family requires a `VERSION` bump on the detector per
/// CONTRIBUTING §3 because old findings stay attached to the prior shape.
pub const CONFIG_GAP_HOOK_PATTERNS: &[ConfigGapPattern] = &[
    ConfigGapPattern {
        filename: ".prettierrc",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".prettierrc.json",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".prettierrc.js",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".prettierrc.cjs",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".prettierrc.yaml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".prettierrc.yml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "prettier.config.js",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "prettier.config.cjs",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "prettier.config.mjs",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "eslint.config.js",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "eslint.config.cjs",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "eslint.config.mjs",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".eslintrc",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".eslintrc.json",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".eslintrc.js",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".eslintrc.cjs",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".eslintrc.yaml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".eslintrc.yml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "biome.json",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "biome",
        label: "biome",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "rustfmt.toml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "cargo fmt",
        label: "cargo fmt",
        require_content: None,
    },
    ConfigGapPattern {
        filename: ".rustfmt.toml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "cargo fmt",
        label: "cargo fmt",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "pyproject.toml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "ruff",
        label: "ruff",
        require_content: Some("[tool.ruff]"),
    },
    ConfigGapPattern {
        filename: "pyproject.toml",
        event: CONFIG_GAP_EVENT_POST_TOOL_USE,
        command_substr: "black",
        label: "black",
        require_content: Some("[tool.black]"),
    },
    ConfigGapPattern {
        filename: "jest.config.js",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "jest",
        label: "jest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "jest.config.cjs",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "jest",
        label: "jest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "jest.config.mjs",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "jest",
        label: "jest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "jest.config.ts",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "jest",
        label: "jest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "vitest.config.js",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "vitest",
        label: "vitest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "vitest.config.ts",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "vitest",
        label: "vitest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "vitest.config.mjs",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "vitest",
        label: "vitest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "pytest.ini",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "pytest",
        label: "pytest",
        require_content: None,
    },
    ConfigGapPattern {
        filename: "Cargo.toml",
        event: CONFIG_GAP_EVENT_PRE_PUSH,
        command_substr: "cargo test",
        label: "cargo test",
        require_content: Some("[[test]]"),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    /// All keyword corpora are non-empty (a stray `&[]` would silently
    /// disable a detector).
    #[test]
    fn keyword_corpora_are_non_empty() {
        assert!(!CORRECTION_KEYWORDS_STRONG.is_empty());
        assert!(!CORRECTION_KEYWORDS_MILD.is_empty());
        assert!(!CONFIRMATION_KEYWORDS.is_empty());
        assert!(!DETERMINISTIC_POST_TOOL_COMMANDS.is_empty());
        assert!(!COMPACTION_KEYWORDS.is_empty());
    }

    #[test]
    fn forge_thresholds_match_source() {
        // Tripwire: if Forge bumps the rule threshold to 4/3, this test
        // fails and forces an explicit cite-update here.
        assert_eq!(RULE_DEFAULTS.min_occurrences, 3);
        assert_eq!(RULE_DEFAULTS.min_sessions, 2);
        assert_eq!(SKILL_DEFAULTS.min_occurrences, 4);
        assert_eq!(SKILL_DEFAULTS.min_sessions, 3);
        assert_eq!(HOOK_DEFAULTS.min_occurrences, 5);
        assert_eq!(HOOK_DEFAULTS.min_sessions, 3);
        assert_eq!(STALENESS_MIN_SESSIONS, 10);
        assert!((STALENESS_MIN_REFERENCE_RATIO - 0.25).abs() < f32::EPSILON);
    }

    #[test]
    fn every_default_carries_a_session_cap() {
        // Phase 21.A1.1 guard: a missing cap means a runaway detector
        // can flood the workspace-home feed.
        for cfg in [
            &SKILL_DEFAULTS,
            &HOOK_DEFAULTS,
            &RULE_DEFAULTS,
            &CLAUDE_MD_ENTRY_DEFAULTS,
            &AGENT_DEFAULTS,
            &APPROVAL_ALWAYS_GRANTED_DEFAULTS,
            &SCOPE_FALSE_POSITIVE_DEFAULTS,
            &COST_HOT_STREAK_DEFAULTS,
            &COMPACTION_PRESSURE_DEFAULTS,
        ] {
            assert!(cfg.max_findings_per_session > 0);
        }
    }
}
