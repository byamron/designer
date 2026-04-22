//! Stub foundation helper for tests. Speaks the same framed JSON protocol as
//! `helpers/foundation/Sources/main.swift` so the Rust supervisor can be
//! exercised on machines without Apple Intelligence hardware.
//!
//! Behavior is controlled by the first CLI arg (`--mode <name>`). Args are
//! per-spawn, which makes this safe across parallel tokio tests — env vars
//! would be process-global and racy.
//!
//! | mode                 | effect                                                   |
//! |----------------------|----------------------------------------------------------|
//! | `ok` (default)       | Respond to `ping` and `generate` normally.               |
//! | `slow_ping`          | Sleep 2s before responding to `ping`. Exercises timeout. |
//! | `die_after_ping`     | Respond to one `ping`, then exit. Exercises restart.     |
//! | `always_die`         | Exit immediately on startup. Exercises max-failure.      |
//! | `panic_to_stderr`    | Write "stub panicked" to stderr and exit.                |
//! | `bad_frame`          | Respond with a length-prefix that lies. Exercises IO err.|
//!
//! Generate responses echo `stub generated: <body prefix>`.

use serde_json::Value;
use std::io::{Read, Write};
use std::time::Duration;

fn mode() -> String {
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--mode" {
            if let Some(v) = args.next() {
                return v;
            }
        }
    }
    "ok".into()
}

fn read_frame() -> Option<Vec<u8>> {
    let mut stdin = std::io::stdin().lock();
    let mut len_buf = [0u8; 4];
    if stdin.read_exact(&mut len_buf).is_err() {
        return None;
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut body = vec![0u8; len];
    if stdin.read_exact(&mut body).is_err() {
        return None;
    }
    Some(body)
}

fn write_frame(bytes: &[u8]) {
    let mut stdout = std::io::stdout().lock();
    let len = (bytes.len() as u32).to_be_bytes();
    let _ = stdout.write_all(&len);
    let _ = stdout.write_all(bytes);
    let _ = stdout.flush();
}

fn write_bad_frame() {
    let mut stdout = std::io::stdout().lock();
    // Advertise 100 bytes but write 4. The reader will block / fail.
    let len = 100u32.to_be_bytes();
    let _ = stdout.write_all(&len);
    let _ = stdout.write_all(b"oops");
    let _ = stdout.flush();
}

fn pong() -> Vec<u8> {
    br#"{"kind":"pong","version":"0.1.0-stub","model":"stub-model"}"#.to_vec()
}

fn text(body: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "kind": "text",
        "text": body,
    }))
    .expect("json encode")
}

fn error(msg: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "kind": "error",
        "message": msg,
    }))
    .expect("json encode")
}

fn kind_of(body: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_slice(body).ok()?;
    v.get("kind")?.as_str().map(str::to_string)
}

fn main() {
    let mode = mode();

    if mode == "always_die" {
        std::process::exit(1);
    }
    if mode == "panic_to_stderr" {
        eprintln!("stub panicked");
        std::process::exit(2);
    }

    let mut pings_served: u32 = 0;

    while let Some(body) = read_frame() {
        match kind_of(&body).as_deref() {
            Some("ping") => {
                if mode == "slow_ping" {
                    std::thread::sleep(Duration::from_secs(2));
                }
                if mode == "bad_frame" {
                    write_bad_frame();
                } else {
                    write_frame(&pong());
                }
                pings_served += 1;
                if mode == "die_after_ping" && pings_served >= 1 {
                    std::process::exit(0);
                }
            }
            Some("generate") => {
                // Echo the first 60 bytes of the request as the "generated"
                // text. Good enough for the supervisor tests; the real helper
                // does actual inference.
                let preview: String = String::from_utf8_lossy(&body).chars().take(60).collect();
                write_frame(&text(&format!("stub generated: {preview}")));
            }
            Some(_other) => {
                write_frame(&error("unknown-request"));
            }
            None => {
                write_frame(&error("invalid-request"));
            }
        }
    }
}
