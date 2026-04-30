//! Fixture-driven tests for the `memory_promotion` detector.
//!
//! The detector reads from two inputs: `SessionAnalysisInput::auto_memory`
//! (auto-memory notes) and `SessionAnalysisInput::project_root` (so it
//! can check coverage against `CLAUDE.md`, `.claude/rules/*.md`, and
//! `.claude/skills/*/SKILL.md`). The on-disk fixtures hold the project
//! tree; the auto-memory notes live in `fixture_data` since they have no
//! event-stream representation.
//!
//! Three cases per CONTRIBUTING §5 (positive trigger + two negative
//! edges):
//!
//! - `positive/` — persistent classified note not covered by infra.
//!   Expects exactly one `Finding`.
//! - `negative_already_covered/` — same persistent note, but `CLAUDE.md`
//!   already records the same fact. Expects zero findings.
//! - `negative_ephemeral/` — note has no frontmatter (the persistence
//!   gate skips it). Expects zero findings.

use designer_core::{Anchor, Finding, ProjectId, Severity};
use designer_learn::{
    defaults::CLAUDE_MD_ENTRY_DEFAULTS, detectors::memory_promotion::MemoryPromotionDetector,
    session_input::MemoryNote, Detector, SessionAnalysisInput,
};
use std::fs;
use std::path::{Path, PathBuf};

const NOTE_PATH: &str = "/Users/u/.claude/projects/abc/memory/code-style.md";

mod fixture_data {
    use super::*;

    pub fn persistent_note() -> MemoryNote {
        MemoryNote {
            path: PathBuf::from(NOTE_PATH),
            body: "---\nname: code-style\ntype: feedback\n---\n\nI prefer two-space indentation in TypeScript files.\n".into(),
        }
    }

    /// Same content as the persistent note, but missing the YAML
    /// frontmatter delimiters — the persistence gate skips it.
    pub fn ephemeral_note() -> MemoryNote {
        MemoryNote {
            path: PathBuf::from(NOTE_PATH),
            body: "I prefer two-space indentation in TypeScript files.\n".into(),
        }
    }
}

#[derive(serde::Deserialize)]
struct ExpectedFile {
    findings: Vec<serde_json::Value>,
}

fn fixture_dir(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests");
    p.push("fixtures");
    p.push("memory_promotion");
    p.push(name);
    p
}

fn load_expected(name: &str) -> Vec<serde_json::Value> {
    let path = fixture_dir(name).join("expected.json");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    let parsed: ExpectedFile =
        serde_json::from_str(&raw).unwrap_or_else(|err| panic!("parse {}: {err}", path.display()));
    parsed.findings
}

fn assert_fixture_dir(p: &Path) {
    assert!(
        p.is_dir(),
        "fixture directory missing: {} — run from the repo root",
        p.display(),
    );
}

async fn run_fixture(name: &str, notes: Vec<MemoryNote>) -> (Vec<Finding>, usize) {
    let dir = fixture_dir(name);
    assert_fixture_dir(&dir);
    let input = SessionAnalysisInput::builder(ProjectId::new())
        .project_root(&dir)
        .auto_memory(notes)
        .build();
    let detector = MemoryPromotionDetector;
    #[cfg(feature = "local-ops")]
    let findings = detector
        .analyze(&input, &CLAUDE_MD_ENTRY_DEFAULTS, None)
        .await
        .expect("detector ran");
    #[cfg(not(feature = "local-ops"))]
    let findings = detector
        .analyze(&input, &CLAUDE_MD_ENTRY_DEFAULTS)
        .await
        .expect("detector ran");
    let expected = load_expected(name).len();
    assert_eq!(
        findings.len(),
        expected,
        "{name}: detector emitted {} findings, expected.json has {}",
        findings.len(),
        expected,
    );
    (findings, expected)
}

#[tokio::test]
async fn positive_fires_on_uncovered_persistent_note() {
    let (findings, _) = run_fixture("positive", vec![fixture_data::persistent_note()]).await;
    assert_eq!(findings.len(), 1, "{findings:?}");
    let f = &findings[0];
    assert_eq!(f.detector_name, "memory_promotion");
    assert_eq!(f.detector_version, 1);
    assert_eq!(f.severity, Severity::Notice);
    assert!(
        f.summary.starts_with("Persistent preference note"),
        "summary should be evidence text: {}",
        f.summary,
    );
    assert!(
        f.summary.contains("CLAUDE.md or rules"),
        "summary should name the infra surfaces: {}",
        f.summary,
    );
    let lower = f.summary.to_lowercase();
    assert!(
        !lower.starts_with("you ") && !lower.contains(" you "),
        "summary uses second-person: {}",
        f.summary,
    );
    assert_eq!(f.evidence.len(), 1);
    match &f.evidence[0] {
        Anchor::FilePath { path, line_range } => {
            assert_eq!(path, NOTE_PATH);
            assert!(line_range.is_none());
        }
        other => panic!("expected FilePath anchor, got {other:?}"),
    }
}

#[tokio::test]
async fn negative_already_covered_does_not_fire() {
    let (findings, expected) = run_fixture(
        "negative_already_covered",
        vec![fixture_data::persistent_note()],
    )
    .await;
    assert_eq!(expected, 0);
    assert!(
        findings.is_empty(),
        "covered note should not fire, got {findings:?}",
    );
}

#[tokio::test]
async fn negative_ephemeral_note_does_not_fire() {
    let (findings, expected) =
        run_fixture("negative_ephemeral", vec![fixture_data::ephemeral_note()]).await;
    assert_eq!(expected, 0);
    assert!(
        findings.is_empty(),
        "ephemeral (no frontmatter) note should not fire, got {findings:?}",
    );
}
