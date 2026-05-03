//! Fixture-based round-trip tests for `--permission-prompt-tool stdio`
//! (Phase 13.H/F1). The fixtures under `tests/fixtures/permission_prompt/`
//! were captured from real `claude` 2.1.119 invocations — see
//! `core-docs/integration-notes.md` §12.A.

use designer_claude::orchestrator::OrchestratorEvent;
use designer_claude::{ClaudeStreamTranslator, TranslatorOutput};
use designer_core::{TabId, WorkspaceId};
use uuid::Uuid;

fn fixture(name: &str) -> String {
    let path = format!(
        "{}/tests/fixtures/permission_prompt/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read fixture {path}: {e}"))
}

fn ws() -> WorkspaceId {
    WorkspaceId::from_uuid(Uuid::parse_str("00000000-0000-7000-8000-0000000000ff").unwrap())
}

fn tab() -> TabId {
    TabId::from_uuid(Uuid::parse_str("00000000-0000-7000-8000-0000000000aa").unwrap())
}

/// Phase 23.B — control_request lines now also emit an
/// `ActivityChanged { state: AwaitingApproval }` edge alongside the
/// `PermissionPrompt`. These fixture tests are about the prompt
/// translation, so strip the activity edge before asserting on shape.
fn non_activity(out: Vec<TranslatorOutput>) -> Vec<TranslatorOutput> {
    out.into_iter()
        .filter(|o| {
            !matches!(
                o,
                TranslatorOutput::Event(OrchestratorEvent::ActivityChanged { .. })
            )
        })
        .collect()
}

#[test]
fn write_fixture_parses_to_permission_prompt() {
    let line = fixture("write.json");
    let mut t = ClaudeStreamTranslator::new(ws(), tab(), "team-h");
    let out = non_activity(t.translate(line.trim()));
    assert_eq!(out.len(), 1, "expected one output, got {out:?}");
    match &out[0] {
        TranslatorOutput::PermissionPrompt {
            request_id,
            tool,
            input,
            summary,
            tool_use_id,
        } => {
            assert!(!request_id.is_empty());
            assert_eq!(tool, "Write");
            assert_eq!(
                input.get("file_path").and_then(|v| v.as_str()),
                Some("/tmp/prompt-probe/foo.txt")
            );
            assert_eq!(input.get("content").and_then(|v| v.as_str()), Some("hello"));
            assert!(summary.contains("/tmp/prompt-probe/foo.txt"));
            assert!(tool_use_id.is_some());
        }
        other => panic!("unexpected output: {other:?}"),
    }
}

#[test]
fn edit_fixture_parses_to_permission_prompt() {
    let line = fixture("edit.json");
    let mut t = ClaudeStreamTranslator::new(ws(), tab(), "team-h");
    let out = non_activity(t.translate(line.trim()));
    assert_eq!(out.len(), 1);
    match &out[0] {
        TranslatorOutput::PermissionPrompt {
            tool,
            input,
            summary,
            ..
        } => {
            assert_eq!(tool, "Edit");
            assert_eq!(
                input.get("file_path").and_then(|v| v.as_str()),
                Some("/Users/dev/proj/src/lib.rs")
            );
            assert!(summary.contains("/Users/dev/proj/src/lib.rs"));
        }
        other => panic!("unexpected output: {other:?}"),
    }
}

#[test]
fn bash_fixture_parses_to_permission_prompt() {
    let line = fixture("bash.json");
    let mut t = ClaudeStreamTranslator::new(ws(), tab(), "team-h");
    let out = non_activity(t.translate(line.trim()));
    assert_eq!(out.len(), 1);
    match &out[0] {
        TranslatorOutput::PermissionPrompt {
            tool,
            input,
            summary,
            ..
        } => {
            assert_eq!(tool, "Bash");
            assert_eq!(
                input.get("command").and_then(|v| v.as_str()),
                Some("git push origin main")
            );
            assert!(summary.contains("git push origin main"));
        }
        other => panic!("unexpected output: {other:?}"),
    }
}
