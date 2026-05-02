//! Performance budget tests — meant to catch order-of-magnitude regressions,
//! not noise. Generous beats tight; raise a threshold if it ever fires on
//! noise rather than tightening it.
//!
//! Methodology: start each threshold at 2× the maximum observed across
//! 5 local runs. If the threshold then fires on noise (it did, here),
//! raise it until the budget catches order-of-magnitude regressions but
//! survives ordinary runner jitter. Re-measure (and update the comment +
//! the constants) when the shapes of `AppCore::boot` or
//! `cmd_list_projects` change materially — e.g. when projector replay
//! starts touching a new event family, or when list_projects fans out
//! to a new helper subsystem.
//!
//! Measured 2026-05-01 on darwin/aarch64 (Apple Silicon, debug build,
//! `cargo test -p designer-desktop --test perf_budget`) over ~30 runs,
//! including default (parallel) and `--test-threads=1` modes:
//!
//!   cold_start (ms):
//!     typical 2.4 – 5.4 serial, 10 – 30 under parallel contention
//!     (both tests boot SQLite + replay concurrently); observed max
//!     103.5 ms when the runner was loaded and parallel execution
//!     piled on
//!     → COLD_START_BUDGET = 250 ms. Earlier values of 25 ms and
//!       100 ms each fired on contention spikes. 250 ms still flags
//!       order-of-magnitude regressions (typical ~3 ms × 80) while
//!       absorbing the runner-jitter and parallel-test contention
//!       this suite legitimately produces.
//!
//!   ipc_list_projects p99 (µs):
//!     typical 20 – 30, noisy-run highs 87 / 111 / 425 / 626 (with
//!     a max single-sample outlier of 5.5 ms once when a parallel
//!     boot was in flight)
//!     → IPC_P99_BUDGET = 2 ms. p99 (sample[98]) tolerates one
//!       outlier sample without firing; 2 ms still catches anything
//!       remotely resembling an order-of-magnitude projector-walk
//!       regression (typical p99 ~22 µs × 90).
//!
//! If either budget fires on noise rather than a real regression,
//! re-measure 5+ runs and raise the constant. Tightening these is a
//! fool's errand: a `criterion`-style harness with warm-up + many
//! iterations would be the right move, and was explicitly out of
//! scope here (stdlib only).

use designer_claude::ClaudeCodeOptions;
use designer_desktop::core::AppCoreBoot;
use designer_desktop::{ipc, AppConfig, AppCore};
use designer_safety::CostCap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::tempdir;

/// Cold start = `AppCore::boot()` returning, which includes opening the
/// SQLite event store and the first `projector.replay(&history)` pass.
const COLD_START_BUDGET: Duration = Duration::from_millis(250);

/// p99 of 100 sequential `cmd_list_projects` calls on a populated AppCore
/// (10 projects × 3 workspaces). Pure projector reads — should be fast.
const IPC_P99_BUDGET: Duration = Duration::from_millis(2);

fn test_config(data_dir: std::path::PathBuf) -> AppConfig {
    AppConfig {
        data_dir,
        // Skip the real Claude orchestrator — boot must not depend on
        // a `claude` binary on the test machine. As a side effect, the
        // process-global `INBOX_HANDLER` (`core_safety.rs`) is never
        // wired into the orchestrator under mock, so the OnceCell race
        // between parallel test boots is inert here.
        use_mock_orchestrator: true,
        claude_options: ClaudeCodeOptions::default(),
        default_cost_cap: CostCap {
            max_dollars_cents: None,
            max_tokens: None,
        },
        // Force NullHelper — keeps boot off any local Swift build.
        helper_binary_path: None,
    }
}

// Drop-order note: each test below declares `dir` before the AppCore. Rust
// drops locals in reverse, so the AppCore (and its open SQLite handles)
// drops first; the tempdir is removed only after. No need for the
// `std::mem::forget(dir)` pattern used in `boot_test_core` (`core.rs`),
// which returns the Arc to an outer scope and so must leak the tempdir.

#[tokio::test]
async fn cold_start_under_budget() {
    let dir = tempdir().unwrap();
    let config = test_config(dir.path().to_path_buf());

    let start = Instant::now();
    let _core = AppCore::boot(config).await.expect("boot");
    let elapsed = start.elapsed();

    eprintln!("cold_start elapsed: {elapsed:?} (budget {COLD_START_BUDGET:?})");
    assert!(
        elapsed < COLD_START_BUDGET,
        "cold start exceeded budget: {elapsed:?} >= {COLD_START_BUDGET:?}"
    );
}

#[tokio::test]
async fn ipc_list_projects_p99_under_budget() {
    let dir = tempdir().unwrap();
    let config = test_config(dir.path().to_path_buf());
    let core: Arc<AppCore> = AppCore::boot(config).await.expect("boot");

    // Realistic small-instance load. Exercises both reads
    // `cmd_list_projects` performs (projects + per-project workspace count).
    for pi in 0..10 {
        let p = core
            .create_project(format!("project-{pi}"), "/tmp".into())
            .await
            .expect("create_project");
        for wi in 0..3 {
            core.create_workspace(p.id, format!("ws-{wi}"), "main".into())
                .await
                .expect("create_workspace");
        }
    }

    let mut samples: Vec<Duration> = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        let out = ipc::cmd_list_projects(&core)
            .await
            .expect("cmd_list_projects");
        let elapsed = start.elapsed();
        assert_eq!(out.len(), 10);
        samples.push(elapsed);
    }

    samples.sort();
    // 100 samples sorted ascending → index 98 is the 99th-percentile cutoff
    // (99 of 100 samples ≤ samples[98]). Index 99 is the max.
    let p99 = samples[98];
    let max = samples[99];
    let median = samples[49];
    eprintln!(
        "ipc_list_projects: median {median:?}, p99 {p99:?}, max {max:?} (budget {IPC_P99_BUDGET:?})"
    );

    assert!(
        p99 < IPC_P99_BUDGET,
        "ipc list_projects p99 exceeded budget: {p99:?} >= {IPC_P99_BUDGET:?}"
    );
}
