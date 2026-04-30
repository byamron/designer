//! `memory_promotion` — promote a persistent auto-memory note to durable
//! infra (CLAUDE.md, `.claude/rules/*.md`, or `.claude/skills/*/SKILL.md`)
//! when no existing infra file already covers it.
//!
//! Static-style detection over [`SessionAnalysisInput::auto_memory`]. The
//! event stream is ignored — auto-memory is the canonical input. Each
//! qualifying note produces one [`Severity::Notice`] finding pinned to the
//! note's path on disk.
//!
//! ## Pipeline (per note)
//!
//! 1. **Persistence gate.** A note is persistent only when its body
//!    starts with a YAML frontmatter block (`---\n…\n---\n`). The
//!    auto-memory system documented in this repo's `CLAUDE.md`
//!    (§"How to save memories") writes a frontmatter header to every
//!    saved memory; notes without one are scratch / drafts and are
//!    skipped.
//! 2. **Classification.** First-match-wins over the four corpora in
//!    `defaults.rs` (preference → convention → workflow →
//!    debugging-knowledge). A note that matches no class is uncategorized
//!    and skipped.
//! 3. **Coverage check.** The first substantive line of the post-
//!    frontmatter body (capped to [`Self::COVERAGE_PROBE_LEN`] chars,
//!    lowercased) is checked against a concatenated lowercased blob of
//!    `<project_root>/CLAUDE.md`, `<project_root>/.claude/rules/*.md`,
//!    and `<project_root>/.claude/skills/*/SKILL.md`. A substring hit
//!    means infra already covers the note — skip. Cheap by design;
//!    semantic / fuzzy matching is Phase B.
//!
//! ## Forge co-installation
//!
//! Listed in [`crate::FORGE_OVERLAP_DETECTORS`] — Forge ships an
//! equivalent. The AppCore wiring defaults the config to
//! [`DetectorConfig::DISABLED`] when Forge is co-installed.
//!
//! ## Output
//!
//! - `severity: Notice` — A2 default per CONTRIBUTING §6.
//! - `confidence: 0.6` — structural (the note matches a class corpus and
//!   isn't found in infra), not probabilistic.
//! - `summary` is evidence text per the 21.A1.2 surface contract:
//!   passive, ≤1 clause, no second-person. The class label and a ≤40-char
//!   inline quote of the note's first substantive line let the proposal
//!   synthesizer compose a kind tag (`claude-md-entry` / `rule` /
//!   `skill` / `reference-doc`) without re-reading the note.
//! - `evidence` is a single [`Anchor::FilePath`] at the note's path.
//!   `MemoryNote` doesn't carry a source-message id, so the
//!   message-span fallback documented in the roadmap is unused for now.

use std::path::Path;

use async_trait::async_trait;
use designer_core::{Anchor, Finding, FindingId, Severity, Timestamp};

use crate::defaults::{
    MEMORY_PROMOTION_CONVENTION_KEYWORDS, MEMORY_PROMOTION_DEBUGGING_KEYWORDS,
    MEMORY_PROMOTION_PREFERENCE_KEYWORDS, MEMORY_PROMOTION_WORKFLOW_KEYWORDS,
};
use crate::session_input::MemoryNote;
use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};

/// Forge-overlap detector. See module docs for the per-note pipeline.
#[derive(Debug, Default, Clone, Copy)]
pub struct MemoryPromotionDetector;

impl MemoryPromotionDetector {
    pub const NAME: &'static str = "memory_promotion";
    pub const VERSION: u32 = 1;
    /// Structural confidence — either the note matches a class corpus and
    /// is missing from infra, or it isn't. Calibration data may push this
    /// up or down later; bump `VERSION` if it moves.
    const CONFIDENCE: f32 = 0.6;
    /// Maximum visible chars (including the trailing ellipsis) of the
    /// inline quote in the summary. Per the task spec — keeps the
    /// evidence drawer's headline skim-readable.
    const QUOTE_INLINE_BUDGET: usize = 40;
    /// Probe length used to test infra files for substring overlap.
    /// Long enough to be specific, short enough that minor edits to the
    /// source text (a renamed identifier, a re-flowed paragraph) don't
    /// silently break the coverage gate.
    const COVERAGE_PROBE_LEN: usize = 60;
    /// Minimum body length (post-frontmatter, post-marker-strip) for a
    /// note to be a candidate at all. Notes shorter than this are scratch
    /// regardless of any keyword match.
    const MIN_BODY_CHARS: usize = 20;
}

#[async_trait]
impl Detector for MemoryPromotionDetector {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemoryClass {
    Preference,
    Convention,
    Workflow,
    DebuggingKnowledge,
}

impl MemoryClass {
    fn label(self) -> &'static str {
        match self {
            Self::Preference => "preference",
            Self::Convention => "convention",
            Self::Workflow => "workflow",
            Self::DebuggingKnowledge => "debugging-knowledge",
        }
    }
}

fn run(input: &SessionAnalysisInput, config: &DetectorConfig) -> Vec<Finding> {
    if !config.enabled || config.max_findings_per_session == 0 {
        return Vec::new();
    }
    if input.auto_memory.is_empty() {
        return Vec::new();
    }

    let infra_lower = input
        .project_root
        .as_deref()
        .map(collect_infra_blob)
        .unwrap_or_default();

    let cap = config.max_findings_per_session as usize;
    let mut findings = Vec::new();

    for note in &input.auto_memory {
        if findings.len() >= cap {
            break;
        }
        let Some(body) = strip_frontmatter(&note.body) else {
            continue;
        };
        if body.chars().count() < MemoryPromotionDetector::MIN_BODY_CHARS {
            continue;
        }
        let Some(class) = classify(body) else {
            continue;
        };
        if covered_by_infra(body, &infra_lower) {
            continue;
        }
        findings.push(build_finding(input, note, class, body));
    }

    findings
}

/// Returns the body content after a leading YAML frontmatter block, or
/// `None` when the note has no frontmatter (treated as ephemeral). Both
/// LF and CRLF line endings are accepted; the closing `---` is matched
/// when it sits at the start of any line.
fn strip_frontmatter(body: &str) -> Option<&str> {
    let trimmed = body.trim_start_matches(|c: char| {
        c == '\u{FEFF}' || c == ' ' || c == '\t' || c == '\n' || c == '\r'
    });
    let after_open = trimmed.strip_prefix("---")?;
    let after_open = after_open
        .strip_prefix('\n')
        .or_else(|| after_open.strip_prefix("\r\n"))?;

    let close_lf = after_open.find("\n---");
    let close_crlf = after_open.find("\r\n---");
    let (close_idx, marker_len) = match (close_lf, close_crlf) {
        (Some(a), Some(b)) if b < a => (b, "\r\n---".len()),
        (Some(a), _) => (a, "\n---".len()),
        (None, Some(b)) => (b, "\r\n---".len()),
        (None, None) => return None,
    };

    let after_close = &after_open[close_idx + marker_len..];
    let after_close = after_close
        .strip_prefix('\n')
        .or_else(|| after_close.strip_prefix("\r\n"))
        .unwrap_or(after_close);
    Some(after_close.trim_start())
}

fn classify(body: &str) -> Option<MemoryClass> {
    let lower = body.to_lowercase();
    if matches_any(&lower, MEMORY_PROMOTION_PREFERENCE_KEYWORDS) {
        return Some(MemoryClass::Preference);
    }
    if matches_any(&lower, MEMORY_PROMOTION_CONVENTION_KEYWORDS) {
        return Some(MemoryClass::Convention);
    }
    if matches_any(&lower, MEMORY_PROMOTION_WORKFLOW_KEYWORDS) {
        return Some(MemoryClass::Workflow);
    }
    if matches_any(&lower, MEMORY_PROMOTION_DEBUGGING_KEYWORDS) {
        return Some(MemoryClass::DebuggingKnowledge);
    }
    None
}

fn matches_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|kw| haystack.contains(kw))
}

/// Read CLAUDE.md, every `.claude/rules/*.md`, and every
/// `.claude/skills/*/SKILL.md`, concatenate them, and lowercase once.
/// Missing files are silently skipped — the detector treats "no infra"
/// the same as "infra exists but doesn't cover this note."
fn collect_infra_blob(project_root: &Path) -> String {
    let mut buf = String::new();
    if let Ok(s) = std::fs::read_to_string(project_root.join("CLAUDE.md")) {
        buf.push_str(&s);
        buf.push('\n');
    }
    push_dir_md_files(&project_root.join(".claude").join("rules"), &mut buf);

    let skills_dir = project_root.join(".claude").join("skills");
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Ok(s) = std::fs::read_to_string(path.join("SKILL.md")) {
                buf.push_str(&s);
                buf.push('\n');
            }
        }
    }
    buf.to_lowercase()
}

fn push_dir_md_files(dir: &Path, out: &mut String) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Ok(s) = std::fs::read_to_string(&path) {
            out.push_str(&s);
            out.push('\n');
        }
    }
}

fn covered_by_infra(body: &str, infra_lower: &str) -> bool {
    if infra_lower.is_empty() {
        return false;
    }
    let probe: String = first_substantive_line(body)
        .chars()
        .take(MemoryPromotionDetector::COVERAGE_PROBE_LEN)
        .collect::<String>()
        .to_lowercase();
    // Trim trailing punctuation / whitespace so the probe matches the
    // same sentence rendered with different terminal punctuation
    // ("...files." in the note vs. "...files;" or "...files" in the
    // infra doc). Leading whitespace is dropped too — the probe started
    // from `first_substantive_line` but a re-flow may have moved leading
    // markers around.
    let trimmed = probe
        .trim()
        .trim_end_matches(|c: char| !c.is_alphanumeric());
    if trimmed.chars().count() < MemoryPromotionDetector::MIN_BODY_CHARS {
        return false;
    }
    infra_lower.contains(trimmed)
}

/// First non-empty line of `body`, with leading bullet / heading markers
/// trimmed so the substring probe matches the same fact written with a
/// different markup convention.
fn first_substantive_line(body: &str) -> &str {
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| {
            l.trim_start_matches(|c: char| {
                c == '-' || c == '*' || c == '#' || c == '>' || c.is_whitespace()
            })
        })
        .unwrap_or("")
}

fn build_finding(
    input: &SessionAnalysisInput,
    note: &MemoryNote,
    class: MemoryClass,
    body: &str,
) -> Finding {
    let snippet = first_substantive_line(body);
    let summary = summary_line(class, snippet);
    let path_str = display_path(note);
    let class_key = class.label();
    let digest_keys = [class_key, path_str.as_str()];
    let window_digest = window_digest(MemoryPromotionDetector::NAME, &digest_keys);

    Finding {
        id: FindingId::new(),
        detector_name: MemoryPromotionDetector::NAME.to_string(),
        detector_version: MemoryPromotionDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: input
            .events
            .last()
            .map(|e| e.timestamp)
            .unwrap_or(Timestamp::UNIX_EPOCH),
        severity: Severity::Notice,
        confidence: MemoryPromotionDetector::CONFIDENCE,
        summary,
        evidence: vec![Anchor::FilePath {
            path: path_str,
            line_range: None,
        }],
        suggested_action: None,
        window_digest,
    }
}

fn summary_line(class: MemoryClass, snippet: &str) -> String {
    let truncated = truncate_inline(snippet, MemoryPromotionDetector::QUOTE_INLINE_BUDGET);
    format!(
        "Persistent {} note not in CLAUDE.md or rules: '{}'",
        class.label(),
        truncated,
    )
}

fn truncate_inline(s: &str, budget: usize) -> String {
    let normalized: String = s
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    let count = normalized.chars().count();
    if count <= budget {
        return normalized;
    }
    let take = budget.saturating_sub(1);
    let mut out: String = normalized.chars().take(take).collect();
    out.push('\u{2026}');
    out
}

fn display_path(note: &MemoryNote) -> String {
    note.path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::CLAUDE_MD_ENTRY_DEFAULTS;
    use designer_core::ProjectId;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn write(dir: &Path, rel: &str, body: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(&path, body).expect("write");
    }

    fn note(path: &str, body: &str) -> MemoryNote {
        MemoryNote {
            path: PathBuf::from(path),
            body: body.to_string(),
        }
    }

    fn run_with(notes: Vec<MemoryNote>, project_root: Option<&Path>) -> Vec<Finding> {
        let mut builder = SessionAnalysisInput::builder(ProjectId::new()).auto_memory(notes);
        if let Some(root) = project_root {
            builder = builder.project_root(root);
        }
        let input = builder.build();
        run(&input, &CLAUDE_MD_ENTRY_DEFAULTS)
    }

    #[test]
    fn fires_on_persistent_classified_note_not_in_infra() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "CLAUDE.md",
            "# Project notes\nNothing relevant.\n",
        );
        let n = note(
            "/Users/u/.claude/projects/abc/memory/prefs.md",
            "---\nname: code style\ntype: feedback\n---\n\nI prefer two-space indentation in TypeScript files.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert_eq!(findings.len(), 1, "{findings:?}");
        let f = &findings[0];
        assert_eq!(f.detector_name, MemoryPromotionDetector::NAME);
        assert_eq!(f.detector_version, MemoryPromotionDetector::VERSION);
        assert_eq!(f.severity, Severity::Notice);
        assert!((f.confidence - MemoryPromotionDetector::CONFIDENCE).abs() < f32::EPSILON);
        assert!(f.summary.contains("preference"));
        assert!(
            f.summary.contains("'I prefer two-space"),
            "summary: {}",
            f.summary
        );
        assert_eq!(f.evidence.len(), 1);
        match &f.evidence[0] {
            Anchor::FilePath { path, line_range } => {
                assert_eq!(path, "/Users/u/.claude/projects/abc/memory/prefs.md");
                assert!(line_range.is_none());
            }
            other => panic!("expected FilePath anchor, got {other:?}"),
        }
    }

    #[test]
    fn quiet_when_claude_md_already_covers_note() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            "CLAUDE.md",
            "# Project conventions\n\n- I prefer two-space indentation in TypeScript files.\n",
        );
        let n = note(
            "/m/prefs.md",
            "---\nname: code style\n---\n\nI prefer two-space indentation in TypeScript files.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert!(
            findings.is_empty(),
            "covered note should not fire: {findings:?}"
        );
    }

    #[test]
    fn quiet_when_rules_already_cover_note() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            ".claude/rules/style.md",
            "# Style\nWe use two-space indentation throughout the repo.\n",
        );
        let n = note(
            "/m/style.md",
            "---\nname: style\n---\n\nWe use two-space indentation throughout the repo.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn quiet_when_skill_already_covers_note() {
        let tmp = TempDir::new().unwrap();
        write(
            tmp.path(),
            ".claude/skills/release/SKILL.md",
            "# Release\nEvery time we cut a release, run the smoke suite first.\n",
        );
        let n = note(
            "/m/release.md",
            "---\nname: release\n---\n\nEvery time we cut a release, run the smoke suite first.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn quiet_for_ephemeral_note_without_frontmatter() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# nothing here\n");
        let n = note(
            "/m/scratch.md",
            "I prefer two-space indentation in TypeScript files.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert!(
            findings.is_empty(),
            "ephemeral (no frontmatter) note should not fire: {findings:?}"
        );
    }

    #[test]
    fn quiet_for_uncategorized_note() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# nothing\n");
        let n = note(
            "/m/random.md",
            "---\nname: misc\n---\n\nThe weather today seems like it might rain a bit.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn classifier_first_match_wins_preference_over_workflow() {
        // Body matches both a preference keyword ("i prefer") and a
        // workflow keyword ("every time"). First-match-wins: preference.
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# unrelated\n");
        let n = note(
            "/m/x.md",
            "---\nname: x\n---\n\nI prefer to use ripgrep every time I search this codebase.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert_eq!(findings.len(), 1);
        assert!(
            findings[0].summary.contains("preference"),
            "summary: {}",
            findings[0].summary
        );
    }

    #[test]
    fn convention_class_promotes_into_summary() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# unrelated\n");
        let n = note(
            "/m/c.md",
            "---\nname: conventions\n---\n\nWe use snake_case for every Python module name.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("convention"));
    }

    #[test]
    fn debugging_knowledge_class_promotes_into_summary() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# unrelated\n");
        let n = note(
            "/m/d.md",
            "---\nname: debug\n---\n\nKnown issue: the test runner hangs when the sqlite WAL is full.\n",
        );
        let findings = run_with(vec![n], Some(tmp.path()));
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("debugging-knowledge"));
    }

    #[test]
    fn empty_auto_memory_is_a_no_op() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# anything\n");
        let findings = run_with(vec![], Some(tmp.path()));
        assert!(findings.is_empty());
    }

    #[test]
    fn no_project_root_still_fires_on_classified_persistent_note() {
        // Without a project root, the infra blob is empty — a classified
        // persistent note has nothing to be "covered by," so the
        // detector still surfaces it.
        let n = note(
            "/m/p.md",
            "---\nname: p\n---\n\nI prefer biome over prettier on this codebase.\n",
        );
        let findings = run_with(vec![n], None);
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn disabled_config_emits_nothing() {
        let n = note(
            "/m/p.md",
            "---\nname: p\n---\n\nI prefer biome over prettier.\n",
        );
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .auto_memory(vec![n])
            .build();
        let findings = run(&input, &DetectorConfig::DISABLED);
        assert!(findings.is_empty());
    }

    #[test]
    fn cap_short_circuits_finding_count() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "CLAUDE.md", "# unrelated\n");
        let notes = vec![
            note(
                "/m/a.md",
                "---\nname: a\n---\n\nI prefer biome on this codebase.\n",
            ),
            note(
                "/m/b.md",
                "---\nname: b\n---\n\nWe use snake_case throughout the python packages.\n",
            ),
            note(
                "/m/c.md",
                "---\nname: c\n---\n\nKnown issue: the indexer drops events on rotate.\n",
            ),
        ];
        let mut cfg = CLAUDE_MD_ENTRY_DEFAULTS;
        cfg.max_findings_per_session = 2;
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .auto_memory(notes)
            .project_root(tmp.path())
            .build();
        let findings = run(&input, &cfg);
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn summary_is_passive_and_no_second_person() {
        let s = summary_line(MemoryClass::Preference, "I prefer biome");
        assert!(s.starts_with("Persistent preference"));
        let lower = s.to_lowercase();
        assert!(!lower.starts_with("you "));
        assert!(!lower.contains(" you "));
    }

    #[test]
    fn truncate_inline_adds_ellipsis_past_budget() {
        let long = "abcdefghijklmnop";
        let out = truncate_inline(long, 5);
        let count = out.chars().count();
        assert_eq!(count, 5);
        assert!(out.ends_with('\u{2026}'));
    }

    #[test]
    fn truncate_inline_passes_short_input_through() {
        let out = truncate_inline("hi", 10);
        assert_eq!(out, "hi");
    }

    #[test]
    fn strip_frontmatter_recognizes_lf_and_crlf() {
        let lf = strip_frontmatter("---\nname: x\n---\n\nbody\n").unwrap();
        assert_eq!(lf, "body\n");

        let crlf = strip_frontmatter("---\r\nname: x\r\n---\r\n\r\nbody\r\n").unwrap();
        assert_eq!(crlf, "body\r\n");
    }

    #[test]
    fn strip_frontmatter_returns_none_without_block() {
        assert!(strip_frontmatter("plain note body").is_none());
    }

    #[test]
    fn first_substantive_line_strips_bullets_and_headings() {
        assert_eq!(first_substantive_line("- the rule"), "the rule");
        assert_eq!(first_substantive_line("# heading\nbody"), "heading");
        assert_eq!(first_substantive_line("\n\n* second"), "second");
    }
}
