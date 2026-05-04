//! Phase 24 §11.0 P2 spike — does sending SIGINT to a `claude`
//! subprocess spawned with PIPED stdio (no PTY) cleanly interrupt a
//! streaming turn? D7 of phase-24-pass-through-chat.md says ESC during
//! a mid-turn agent stream sends SIGINT; the spec flagged this for
//! verification before workspace dispatch.
//!
//! Usage:
//!   cargo run -p designer-claude --features claude_live \
//!     --bin sigint_spike -- <mechanism>
//!
//! Mechanisms:
//!   sigint     POSIX SIGINT via libc::kill (the spec's first choice)
//!   control    in-band {"type":"control_request","subtype":"interrupt"}
//!   sigterm    POSIX SIGTERM
//!   eof        close stdin and observe
//!   all        runs all four sequentially with a fresh subprocess each
//!
//! Feature-gated to `claude_live` so a `cargo build --workspace` never
//! compiles it. Throwaway.

use std::process::Stdio;
use std::time::Duration;

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::time::{sleep, timeout};
use uuid::Uuid;

const PROMPT: &str = "Write a long, detailed essay (at least 3000 words) \
                      explaining the history of the printing press from \
                      Gutenberg to the present day. Include specific dates, \
                      names, and inventions. Write the full essay; do not \
                      summarize.";

const STREAM_BEFORE_INTERRUPT: Duration = Duration::from_secs(10);
const STREAM_AFTER_INTERRUPT: Duration = Duration::from_secs(8);
const EXIT_WAIT: Duration = Duration::from_secs(6);

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let mechanism = std::env::args().nth(1).unwrap_or_else(|| "all".to_string());

    match mechanism.as_str() {
        "all" => {
            for m in ["sigint", "control", "sigterm", "eof"] {
                println!("\n========== mechanism: {m} ==========\n");
                if let Err(e) = run_one(m).await {
                    println!("[spike] run_one({m}) error: {e:#}");
                }
                sleep(Duration::from_secs(2)).await;
            }
        }
        m => run_one(m).await?,
    }
    Ok(())
}

async fn run_one(mechanism: &str) -> anyhow::Result<()> {
    let session_id = Uuid::new_v4();
    println!("[spike] mechanism={mechanism} session_id={session_id}");

    let mut child = spawn_claude(session_id)?;
    let pid = child.id().expect("spawned child has pid");
    println!("[spike] spawned claude pid={pid}");

    let mut stdin: Option<ChildStdin> = Some(child.stdin.take().expect("piped stdin"));
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                println!("[spike][stderr] {line}");
            }
        }
    });

    let user_envelope = json!({
        "type": "user",
        "message": { "role": "user", "content": PROMPT },
    });
    let mut bytes = serde_json::to_vec(&user_envelope)?;
    bytes.push(b'\n');
    {
        let s = stdin.as_mut().expect("stdin available");
        s.write_all(&bytes).await?;
        s.flush().await?;
    }
    println!("[spike] user prompt sent ({} bytes)", bytes.len());

    let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let reader_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = line_tx.send(line);
        }
        drop(line_tx);
    });

    let pre = collect_lines(&mut line_rx, STREAM_BEFORE_INTERRUPT, "pre").await;
    println!(
        "[spike] phase 1 (pre-interrupt): {} lines, {} message envelopes, last={:?}",
        pre.total, pre.message_count, pre.last_envelope_type
    );
    if pre.total == 0 {
        println!(
            "[spike] WARNING: nothing arrived in {STREAM_BEFORE_INTERRUPT:?}; \
             interrupt test will not be meaningful"
        );
    }

    println!("[spike] applying mechanism={mechanism}");
    match mechanism {
        "sigint" => send_signal(pid, libc::SIGINT)?,
        "sigterm" => send_signal(pid, libc::SIGTERM)?,
        "control" => {
            let request = json!({
                "type": "control_request",
                "request_id": Uuid::new_v4().to_string(),
                "request": { "subtype": "interrupt" },
            });
            let mut bytes = serde_json::to_vec(&request)?;
            bytes.push(b'\n');
            let s = stdin.as_mut().expect("stdin available");
            s.write_all(&bytes).await?;
            s.flush().await?;
            println!("[spike] sent control_request interrupt over stdin");
        }
        "eof" => {
            stdin.take();
            println!("[spike] closed stdin (EOF)");
        }
        other => anyhow::bail!("unknown mechanism: {other}"),
    }

    let post = collect_lines(&mut line_rx, STREAM_AFTER_INTERRUPT, "post").await;
    println!(
        "[spike] phase 3 (post-interrupt): {} lines, {} message envelopes, \
         last={:?}, saw_result={}, result_stop_reason={:?}",
        post.total,
        post.message_count,
        post.last_envelope_type,
        post.saw_result,
        post.result_stop_reason
    );

    drop(stdin);

    match timeout(EXIT_WAIT, child.wait()).await {
        Ok(Ok(status)) => {
            use std::os::unix::process::ExitStatusExt;
            println!(
                "[spike] subprocess exited: success={} code={:?} signal={:?}",
                status.success(),
                status.code(),
                status.signal()
            );
        }
        Ok(Err(e)) => println!("[spike] wait error: {e}"),
        Err(_) => {
            println!("[spike] subprocess STILL ALIVE after {EXIT_WAIT:?} — force-killing");
            child.start_kill().ok();
            let _ = timeout(Duration::from_secs(2), child.wait()).await;
        }
    }

    let _ = reader_task.await;
    Ok(())
}

#[derive(Default, Debug)]
struct LineStats {
    total: usize,
    message_count: usize,
    last_envelope_type: Option<String>,
    saw_result: bool,
    result_stop_reason: Option<String>,
}

async fn collect_lines(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
    window: Duration,
    tag: &str,
) -> LineStats {
    let mut stats = LineStats::default();
    let deadline = tokio::time::Instant::now() + window;
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = deadline - now;
        match timeout(remaining, rx.recv()).await {
            Ok(Some(line)) => {
                stats.total += 1;
                let parsed: Option<serde_json::Value> = serde_json::from_str(&line).ok();
                let env_type = parsed
                    .as_ref()
                    .and_then(|v| v.get("type"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                if env_type.as_deref() == Some("assistant") || env_type.as_deref() == Some("user") {
                    stats.message_count += 1;
                }
                if env_type.as_deref() == Some("result") {
                    stats.saw_result = true;
                    if let Some(v) = parsed.as_ref() {
                        stats.result_stop_reason = v
                            .get("stop_reason")
                            .or_else(|| v.get("subtype"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                    }
                }
                if let Some(t) = env_type {
                    stats.last_envelope_type = Some(t);
                }
                if stats.total <= 3 || stats.total % 25 == 0 || line.contains("\"result\"") {
                    print_line(tag, stats.total, &line);
                }
            }
            Ok(None) => {
                println!("[spike][{tag}] stdout EOF after {} lines", stats.total);
                break;
            }
            Err(_) => break,
        }
    }
    stats
}

fn print_line(tag: &str, idx: usize, line: &str) {
    let trimmed = if line.len() > 240 {
        format!("{}…", &line[..240])
    } else {
        line.to_string()
    };
    println!("[spike][{tag}][{idx:04}] {trimmed}");
}

fn spawn_claude(session_id: Uuid) -> anyhow::Result<Child> {
    // Mirrors crates/designer-claude/src/claude_code.rs build_command:
    // same flags, same defaults for setting-sources / max-turns /
    // permission-mode, same piped stdio (no PTY). Differences:
    //   - no env injection (DESIGNER_WORKSPACE_ID etc.) — the spike
    //     does not exercise the orchestrator side
    //   - no cwd override — runs in the workspace cwd, fine for the
    //     interrupt question
    //   - no model override — lets `claude` pick its default
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .args(["--output-format", "stream-json"])
        .arg("--verbose")
        .args(["--input-format", "stream-json"])
        .args(["--session-id", &session_id.to_string()])
        .args(["--permission-prompt-tool", "stdio"])
        .args(["--setting-sources", "user,project,local"])
        .args(["--max-turns", "32"])
        .args(["--permission-mode", "default"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(cmd.spawn()?)
}

fn send_signal(pid: u32, sig: libc::c_int) -> anyhow::Result<()> {
    // SAFETY: `pid` came from `Child::id()` on a tokio child this
    // process owns. `kill(2)` is signal-safe.
    let rc = unsafe { libc::kill(pid as libc::pid_t, sig) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        anyhow::bail!("kill({pid}, {sig}) failed: {err}");
    }
    println!("[spike] sent signal {sig} to pid {pid}");
    Ok(())
}
