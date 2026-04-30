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
/// expressed as min_occurrences=3 across min_sessions=3. Severity
/// defaults to `Notice` per CONTRIBUTING §6 (A2 default; raising to
/// `Warning` would need a <5% FP rate on the fixture suite).
pub const COMPACTION_PRESSURE_DEFAULTS: DetectorConfig = DetectorConfig {
    enabled: true,
    min_occurrences: 3,
    min_sessions: 3,
    impact_override: Some(Severity::Notice),
    max_findings_per_session: DEFAULT_MAX_FINDINGS_PER_SESSION,
};

/// `compaction_pressure`: trailing-window length, in days, used to
/// scope the qualifying-session count from the most-recent event. The
/// roadmap pins "3 sessions in a week"; this constant is the "week"
/// half. **Designer-unique** — Forge has no analog detector.
pub const COMPACTION_PRESSURE_LOOKBACK_DAYS: i64 = 7;

/// `compaction_pressure`: idle-gap (in minutes) between adjacent
/// `MessagePosted` events that segments one Designer session from the
/// next. Designer process boundaries aren't observable as a typed
/// event yet, so the idle-window proxy is the cheapest correct
/// definition until a `SessionStarted` payload lands. **Designer-unique**.
pub const COMPACTION_PRESSURE_SESSION_GAP_MINUTES: i64 = 60;

/// Jaccard-similarity floor for `repeated_prompt_opening`. Two
/// session-opening user messages count as a match when their token
/// sets intersect ≥ this fraction of their union.
///
/// Forge: `forge/scripts/analyze-transcripts.py` L1231 ships 0.30 as
/// its `find_repeated_prompts` clustering floor. Designer tunes
/// stricter (0.50) per `core-docs/roadmap.md` §"Phase 21.A2 /
/// repeated_prompt_opening" — the cockpit surface is more attention-
/// scarce than Forge's CI log, so a higher-precision/lower-recall
/// floor keeps the proposal feed clean.
pub const REPEATED_PROMPT_OPENING_JACCARD_MIN: f32 = 0.5;

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

/// Keyword corpus for `domain_specific_in_claude_md`. Lines in the
/// project's `CLAUDE.md` that substring-match any of these are flagged
/// as candidates for extraction into a scoped `.claude/rules/<name>.md`
/// (the `paths:` frontmatter narrows the rule to the file family it
/// actually concerns, instead of polluting every prompt).
///
/// The list is split into three families per the roadmap row:
/// **file-extension hints** (a literal extension is a strong scope
/// signal), **framework names** (rule applies only when the named
/// library / runtime is involved), and **directory anchors** (rule
/// concerns a specific subtree of the repo). Lowercased, anchor-free,
/// no regex metacharacters per CONTRIBUTING §4 — the detector composes
/// case-insensitive substring matching on top.
///
/// Forge-overlap detector. Forge ships an analog (`domain_specific` in
/// `analyze-transcripts.py`); the corpus here intentionally trades
/// Forge's regex weights for a flat keyword list so a future MLX
/// backend has the same vocabulary.
pub const DOMAIN_SPECIFIC_CLAUDE_MD_KEYWORDS: &[&str] = &[
    // File-extension hints.
    ".tsx",
    ".ts",
    ".jsx",
    ".rs",
    ".py",
    ".go",
    ".swift",
    // Framework / library / runtime names.
    "tailwind",
    "radix",
    "tokio",
    "pytest",
    "vite",
    "next.js",
    "react",
    "tauri",
    // Directory anchors (path-shaped tokens).
    "packages/app/",
    "apps/desktop/",
    "src-tauri/",
    "crates/",
];

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

/// Hook-event names emitted by Claude Code's settings file. The JSON
/// shape is `hooks.<event_name>[*].command`; Claude Code requires exact
/// case at runtime, so the enum's `as_str()` is the canonical spelling
/// the detector compares against and renders in summaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookEvent {
    PostToolUse,
    PreCommit,
    PrePush,
}

impl HookEvent {
    pub const fn as_str(self) -> &'static str {
        match self {
            HookEvent::PostToolUse => "PostToolUse",
            HookEvent::PreCommit => "PreCommit",
            HookEvent::PrePush => "PrePush",
        }
    }

    /// Parse the wire form back to the enum. Unknown / typo'd event
    /// names return `None` — `config_gap` treats them as "no hook
    /// registered" so the user gets the gap surfaced instead of the
    /// detector silently claiming coverage for an event Claude Code
    /// will never fire.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "PostToolUse" => Some(HookEvent::PostToolUse),
            "PreCommit" => Some(HookEvent::PreCommit),
            "PrePush" => Some(HookEvent::PrePush),
            _ => None,
        }
    }
}

/// How a config-file name is matched against direct children of the
/// project root. The roadmap's spec uses prefix patterns
/// (`.prettierrc*`, `prettier.config.*`); enumerating every extension
/// would lock the table to a particular point-in-time list of formats.
#[derive(Debug, Clone, Copy)]
pub enum FileMatch {
    /// Match the filename verbatim (e.g. `biome.json`).
    Exact(&'static str),
    /// Match any filename starting with the given prefix
    /// (e.g. `Prefix(".prettierrc")` matches `.prettierrc`,
    /// `.prettierrc.json`, `.prettierrc.toml`, …).
    Prefix(&'static str),
}

impl FileMatch {
    /// Return `true` when `name` (a single path component, not a
    /// full path) matches this pattern.
    pub fn matches(&self, name: &str) -> bool {
        match self {
            FileMatch::Exact(s) => name == *s,
            FileMatch::Prefix(s) => name.starts_with(s),
        }
    }
}

/// Single row of the [`CONFIG_GAP_HOOK_PATTERNS`] table.
pub struct ConfigGapPattern {
    /// How to match this row's config file against the project root.
    pub file: FileMatch,
    /// Claude Code hook event the missing hook would register under.
    pub event: HookEvent,
    /// Substring that must appear in the hook's `command` field for the
    /// hook to count as "covers this config." Matched case-insensitively.
    pub command_substr: &'static str,
    /// Human-readable family label for the summary. Lowercase, short.
    pub label: &'static str,
    /// Optional file-content substring that must also be present for the
    /// pattern to apply. `None` means "filename match is sufficient";
    /// `Some("[tool.ruff]")` means "only flag a `pyproject.toml` that
    /// declares a `[tool.ruff]` section." Designer-unique gating —
    /// `pyproject.toml` and `Cargo.toml` are too common to flag wholesale.
    pub require_content: Option<&'static str>,
}

/// Designer-unique. Each row encodes one (config file → expected hook)
/// relationship. Adding a new family requires a `VERSION` bump on the
/// detector per CONTRIBUTING §3 because old findings stay attached to
/// the prior shape.
pub const CONFIG_GAP_HOOK_PATTERNS: &[ConfigGapPattern] = &[
    ConfigGapPattern {
        file: FileMatch::Prefix(".prettierrc"),
        event: HookEvent::PostToolUse,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Prefix("prettier.config."),
        event: HookEvent::PostToolUse,
        command_substr: "prettier",
        label: "prettier",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Prefix(".eslintrc"),
        event: HookEvent::PostToolUse,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Prefix("eslint.config."),
        event: HookEvent::PostToolUse,
        command_substr: "eslint",
        label: "eslint",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Exact("biome.json"),
        event: HookEvent::PostToolUse,
        command_substr: "biome",
        label: "biome",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Exact("rustfmt.toml"),
        event: HookEvent::PostToolUse,
        command_substr: "cargo fmt",
        label: "cargo fmt",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Exact(".rustfmt.toml"),
        event: HookEvent::PostToolUse,
        command_substr: "cargo fmt",
        label: "cargo fmt",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Exact("pyproject.toml"),
        event: HookEvent::PostToolUse,
        command_substr: "ruff",
        label: "ruff",
        require_content: Some("[tool.ruff]"),
    },
    ConfigGapPattern {
        file: FileMatch::Exact("pyproject.toml"),
        event: HookEvent::PostToolUse,
        command_substr: "black",
        label: "black",
        require_content: Some("[tool.black]"),
    },
    ConfigGapPattern {
        file: FileMatch::Prefix("jest.config."),
        event: HookEvent::PrePush,
        command_substr: "jest",
        label: "jest",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Prefix("vitest.config."),
        event: HookEvent::PrePush,
        command_substr: "vitest",
        label: "vitest",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Exact("pytest.ini"),
        event: HookEvent::PrePush,
        command_substr: "pytest",
        label: "pytest",
        require_content: None,
    },
    ConfigGapPattern {
        file: FileMatch::Exact("Cargo.toml"),
        event: HookEvent::PrePush,
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
