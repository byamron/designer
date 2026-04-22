use designer_git::{GitOps, RealGitOps};
use std::process::Command;

/// Integration smoke. Requires a real `git` binary on PATH; skipped otherwise.
#[tokio::test]
async fn git_commit_and_diff_roundtrip() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path();
    // Init
    Command::new("git")
        .current_dir(path)
        .args(["init", "-b", "main"])
        .output()
        .unwrap();
    Command::new("git")
        .current_dir(path)
        .args(["config", "user.email", "test@example.com"])
        .output()
        .unwrap();
    Command::new("git")
        .current_dir(path)
        .args(["config", "user.name", "tester"])
        .output()
        .unwrap();
    std::fs::write(path.join("a.txt"), "hello\n").unwrap();
    Command::new("git")
        .current_dir(path)
        .args(["add", "."])
        .output()
        .unwrap();
    Command::new("git")
        .current_dir(path)
        .args(["commit", "-m", "init"])
        .output()
        .unwrap();

    let ops = RealGitOps::new();
    std::fs::write(path.join("a.txt"), "hello\nworld\n").unwrap();
    let sha = ops.commit_all(path, "add world").await.unwrap();
    assert_eq!(sha.len(), 40);
    let diff = ops.diff(path, "HEAD~1").await.unwrap();
    assert_eq!(diff.len(), 1);
    assert_eq!(diff[0].path, std::path::PathBuf::from("a.txt"));
    assert_eq!(diff[0].added, 1);
}
