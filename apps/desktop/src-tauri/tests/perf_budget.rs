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
//! `cargo test -p designer-desktop --test perf_budget`) over ~28 runs:
//!
//!   cold_start (ms):
//!     typical 2.4 – 5.4, observed max 24.97 (one runner-stall spike;
//!     second-highest 12.82)
//!     → 2× quiet max ≈ 11 ms; 2× outlier max ≈ 50 ms; bumped to
//!       COLD_START_BUDGET = 100 ms after a tighter (25 ms) bound
//!       fired on a single noise spike that came within 30 µs of the
//!       budget. 100 ms still flags any order-of-magnitude regression
//!       (typical ~3 ms × 30) and gives plenty of headroom for slower
//!       / contended runners.
//!
//!   ipc_list_projects p99 (µs):
//!     typical 20 – 30, noisy-run highs 87 / 111 / 425 (with one
//!     max-sample outlier of 948 µs in the noisiest run)
//!     → 2× noisy max ≈ 850 µs; rounded to IPC_P99_BUDGET = 1 ms.
//!       That's ~50× the typical p99 — still inside the
//!       "order-of-magnitude regression" window (a 100× regression
//!       would push p99 to ~2 ms and trip).
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
const COLD_START_BUDGET: Duration = Duration::from_millis(100);

/// p99 of 100 sequential `cmd_list_projects` calls on a populated AppCore
/// (10 projects × 3 workspaces). Pure projector reads — should be fast.
const IPC_P99_BUDGET: Duration = Duration::from_millis(1);

fn test_config(data_dir: std::path::PathBuf) -> AppConfig {
    AppConfig {
        data_dir,
        // Skip the real Claude orchestrator — boot must not depend on
        // a `claude` binary on the test machine.
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
