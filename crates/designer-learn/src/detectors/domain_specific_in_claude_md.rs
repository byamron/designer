//! `domain_specific_in_claude_md` — find CLAUDE.md lines tied to a
//! single file extension, framework, or directory.
//!
//! Static detection. Reads `<project_root>/CLAUDE.md` from disk once and
//! ignores the event stream entirely. Each line that substring-matches a
//! keyword in [`crate::defaults::DOMAIN_SPECIFIC_CLAUDE_MD_KEYWORDS`]
//! produces one [`Severity::Notice`] finding pointing at that line via
//! [`Anchor::FilePath`] with a single-line `line_range`.
//!
//! ## Output kind
//!
//! `rule-extraction` per the roadmap row — a CLAUDE.md line that only
//! applies to `.tsx` files / Tailwind / `crates/` is a candidate for
//! demotion to a scoped `.claude/rules/<name>.md` so the `paths:`
//! frontmatter narrows it to the file family it actually concerns.
//! Phase A leaves `suggested_action: None`; Phase B's synthesizer picks
//! the rule name + paths frontmatter.
//!
//! ## Forge co-installation
//!
//! Listed in [`crate::FORGE_OVERLAP_DETECTORS`] — Forge ships an analog.
//! AppCore wiring defaults the config to [`DetectorConfig::DISABLED`]
//! when Forge is co-installed; running with that config short-circuits
//! to an empty `Vec` here.
//!
//! ## False-positive posture
//!
//! Heuristic — confidence is fixed at 0.6. Two CLAUDE.md lines that
//! happen to spell `react` in passing (one a domain-specific rule, the
//! other a sentence about "react to feedback") will both fire; the
//! synthesizer is expected to prune the latter when it composes the
//! proposal. Per CONTRIBUTING §6 the cockpit's noise tolerance is low,
//! but this detector's findings live behind a proposal evidence drawer
//! rather than as their own home-tab row, which justifies the looser
//! posture.
//!
//! ## Cap behavior
//!
//! The chokepoint at `core_learn::report_finding` enforces
//! `max_findings_per_session`. Per the Phase 21.A2 instructions for
//! this detector, the analyze function emits one finding per matching
//! line and lets the chokepoint refuse the overflow — the file is small
//! enough that producing the full list is cheap.
//!
//! ## Summary copy
//!
//! Per the 21.A1.2 CONTRIBUTING addendum: passive evidence text, ≤80
//! chars, no second-person, no directive. Form is
//! `"CLAUDE.md L<n> references <keyword>"`.

use async_trait::async_trait;
use designer_core::{Anchor, Finding, FindingId, Severity, Timestamp};

use crate::defaults::DOMAIN_SPECIFIC_CLAUDE_MD_KEYWORDS;
use crate::{window_digest, Detector, DetectorConfig, DetectorError, SessionAnalysisInput};

#[derive(Debug, Default, Clone, Copy)]
pub struct DomainSpecificInClaudeMdDetector;

impl DomainSpecificInClaudeMdDetector {
    pub const NAME: &'static str = "domain_specific_in_claude_md";
    pub const VERSION: u32 = 1;
    /// Heuristic confidence — keyword presence is a candidate signal,
    /// not a structural certainty. Bump `VERSION` if calibration
    /// suggests a different floor.
    const CONFIDENCE: f32 = 0.6;
    /// Char budget for the evidence summary. Matches the 21.A1.2
    /// "Summary copy" guidance (≤80 chars).
    const SUMMARY_BUDGET: usize = 80;
    /// Filename relative to `project_root` the detector reads.
    const CLAUDE_MD: &'static str = "CLAUDE.md";
}

#[async_trait]
impl Detector for DomainSpecificInClaudeMdDetector {
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
    let path = project_root.join(DomainSpecificInClaudeMdDetector::CLAUDE_MD);
    let Ok(body) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };

    let mut findings = Vec::new();
    for (idx, line) in body.lines().enumerate() {
        let line_number = u32::try_from(idx + 1).unwrap_or(u32::MAX);
        let lower = line.to_ascii_lowercase();
        let Some(keyword) = first_keyword_hit(&lower) else {
            continue;
        };
        findings.push(build_finding(input, line_number, keyword));
    }
    findings
}

/// Return the first keyword from the corpus found in `lower`. Iteration
/// order is the corpus order, so the same line always reports the same
/// keyword — keeps the `window_digest` stable across runs.
fn first_keyword_hit(lower: &str) -> Option<&'static str> {
    DOMAIN_SPECIFIC_CLAUDE_MD_KEYWORDS
        .iter()
        .copied()
        .find(|kw| lower.contains(kw))
}

fn build_finding(input: &SessionAnalysisInput, line_number: u32, keyword: &str) -> Finding {
    let summary = trim_summary(format!(
        "CLAUDE.md L{line_number} references {keyword}",
        line_number = line_number,
        keyword = keyword,
    ));
    let line_str = line_number.to_string();
    let digest_keys = [keyword, line_str.as_str()];
    let window_digest = window_digest(DomainSpecificInClaudeMdDetector::NAME, &digest_keys);

    Finding {
        id: FindingId::new(),
        detector_name: DomainSpecificInClaudeMdDetector::NAME.to_string(),
        detector_version: DomainSpecificInClaudeMdDetector::VERSION,
        project_id: input.project_id,
        workspace_id: input.workspace_id,
        timestamp: input
            .events
            .last()
            .map(|e| e.timestamp)
            .unwrap_or(Timestamp::UNIX_EPOCH),
        severity: Severity::Notice,
        confidence: DomainSpecificInClaudeMdDetector::CONFIDENCE,
        summary,
        evidence: vec![Anchor::FilePath {
            path: DomainSpecificInClaudeMdDetector::CLAUDE_MD.to_string(),
            line_range: Some((line_number, line_number)),
        }],
        suggested_action: None,
        window_digest,
    }
}

fn trim_summary(summary: String) -> String {
    if summary.chars().count() <= DomainSpecificInClaudeMdDetector::SUMMARY_BUDGET {
        return summary;
    }
    let mut out: String = summary
        .chars()
        .take(DomainSpecificInClaudeMdDetector::SUMMARY_BUDGET - 1)
        .collect();
    out.push('\u{2026}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::ProjectId;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn write_claude_md(dir: &Path, body: &str) {
        fs::write(dir.join("CLAUDE.md"), body).expect("write CLAUDE.md");
    }

    fn run_against(dir: &Path) -> Vec<Finding> {
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .project_root(dir)
            .build();
        super::run(&input, &DetectorConfig::default())
    }

    #[test]
    fn fires_on_extension_framework_and_directory_lines() {
        let tmp = TempDir::new().unwrap();
        let body = concat!(
            "# Project conventions\n",
            "Prefer functional components in .tsx files.\n",
            "Style with Tailwind tokens; do not invent CSS.\n",
            "Backend code in crates/ uses tokio runtime.\n",
            "Be intentional about every change.\n",
        );
        write_claude_md(tmp.path(), body);

        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 3, "got {findings:?}");

        for f in &findings {
            assert_eq!(f.detector_name, DomainSpecificInClaudeMdDetector::NAME);
            assert_eq!(f.severity, Severity::Notice);
            assert!((f.confidence - 0.6).abs() < f32::EPSILON);
            assert!(f.summary.starts_with("CLAUDE.md L"));
            assert!(f.summary.chars().count() <= 80);
            assert!(!f.summary.to_lowercase().contains(" you "));
            assert_eq!(f.evidence.len(), 1);
            match &f.evidence[0] {
                Anchor::FilePath { path, line_range } => {
                    assert_eq!(path, "CLAUDE.md");
                    assert!(line_range.is_some());
                    let (start, end) = line_range.unwrap();
                    assert_eq!(start, end, "single-line range");
                }
                other => panic!("expected FilePath anchor, got {other:?}"),
            }
        }
    }

    #[test]
    fn quiet_on_generic_claude_md() {
        let tmp = TempDir::new().unwrap();
        write_claude_md(
            tmp.path(),
            concat!(
                "# Principles\n",
                "Be intentional about every change.\n",
                "Prefer clarity over cleverness.\n",
                "Summarize by default; drill on demand.\n",
            ),
        );
        let findings = run_against(tmp.path());
        assert!(findings.is_empty(), "got {findings:?}");
    }

    #[test]
    fn quiet_when_claude_md_missing() {
        let tmp = TempDir::new().unwrap();
        let findings = run_against(tmp.path());
        assert!(findings.is_empty());
    }

    #[test]
    fn quiet_when_disabled() {
        let tmp = TempDir::new().unwrap();
        write_claude_md(tmp.path(), "Use Tailwind for styles.\n");
        let input = SessionAnalysisInput::builder(ProjectId::new())
            .project_root(tmp.path())
            .build();
        let findings = super::run(&input, &DetectorConfig::DISABLED);
        assert!(findings.is_empty());
    }

    #[test]
    fn no_project_root_emits_nothing() {
        let input = SessionAnalysisInput::builder(ProjectId::new()).build();
        let findings = super::run(&input, &DetectorConfig::default());
        assert!(findings.is_empty());
    }

    #[test]
    fn matches_are_case_insensitive() {
        let tmp = TempDir::new().unwrap();
        write_claude_md(tmp.path(), "Compose UI with TAILWIND tokens.\n");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
        assert!(findings[0].summary.contains("tailwind"));
    }

    #[test]
    fn one_finding_per_line_even_when_multiple_keywords_match() {
        let tmp = TempDir::new().unwrap();
        write_claude_md(tmp.path(), "Tailwind in apps/desktop/ uses tokio.\n");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1, "one line → one finding");
    }

    #[test]
    fn line_numbers_are_one_indexed() {
        let tmp = TempDir::new().unwrap();
        write_claude_md(tmp.path(), "Header line\nUse Tailwind tokens.\n");
        let findings = run_against(tmp.path());
        assert_eq!(findings.len(), 1);
        match &findings[0].evidence[0] {
            Anchor::FilePath { line_range, .. } => {
                assert_eq!(line_range.unwrap(), (2, 2));
            }
            other => panic!("expected FilePath anchor, got {other:?}"),
        }
    }

    #[test]
    fn window_digest_is_stable_per_line_and_keyword() {
        let tmp = TempDir::new().unwrap();
        write_claude_md(tmp.path(), "Use Tailwind tokens.\n");
        let first = run_against(tmp.path());
        let second = run_against(tmp.path());
        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
        assert_eq!(first[0].window_digest, second[0].window_digest);
    }
}
