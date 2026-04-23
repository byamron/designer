//! Boot-path tests for `SwiftFoundationHelper` + the supervisor. Uses the
//! `stub_helper` binary (compiled from `src/bin/stub_helper.rs` by Cargo at
//! test time) so these tests run on every host, not just Apple-Intelligence-
//! capable Macs.
//!
//! See `src/bin/stub_helper.rs` for the full mode table.

use designer_local_models::{
    probe_helper, FoundationHelper, HelperError, HelperEvent, HelperTuning, JobKind,
    SwiftFoundationHelper,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn stub_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_stub_helper"))
}

fn fast_tuning() -> HelperTuning {
    HelperTuning::new(vec![10, 10, 10, 10, 10], 5, Duration::from_secs(1))
}

fn fresh_helper_with_mode(mode: &str) -> Arc<SwiftFoundationHelper> {
    // Pass the mode as a CLI arg (per-spawn) rather than an env var (global).
    // Parallel tokio tests would otherwise stomp on each other's state.
    Arc::new(SwiftFoundationHelper::with_tuning(
        stub_path(),
        vec!["--mode".into(), mode.into()],
        fast_tuning(),
    ))
}

#[tokio::test]
async fn happy_path_ping_and_generate() {
    let helper = fresh_helper_with_mode("ok");
    let pretty = helper.ping().await.expect("ping");
    assert!(pretty.contains("stub-model"));

    let text = helper
        .generate(JobKind::Recap, "summarize yesterday")
        .await
        .expect("generate");
    assert!(text.starts_with("stub generated"));

    let health = helper.health();
    assert!(
        health.running,
        "should be running after a successful round-trip"
    );
    assert_eq!(health.consecutive_failures, 0);
    assert!(health.version.is_some());
}

#[tokio::test]
async fn probe_helper_times_out_on_slow_ping() {
    let helper = fresh_helper_with_mode("slow_ping");
    let err = probe_helper(helper, Duration::from_millis(300))
        .await
        .expect_err("probe should time out");
    match err {
        HelperError::Timeout(d) => {
            assert_eq!(d, Duration::from_millis(300));
        }
        other => panic!("expected Timeout, got {other:?}"),
    }
}

#[tokio::test]
async fn supervisor_restarts_after_child_dies() {
    let helper = fresh_helper_with_mode("die_after_ping");
    let _ = helper.ping().await.expect("first ping ok");

    // Second call fails (broken pipe or short-read). Either the write races
    // ahead and succeeds or it fails immediately; in both cases the read
    // errors out and we record a failure.
    let mid = helper.ping().await;
    assert!(mid.is_err(), "expected failure after child exit");

    // Poll until the backoff window clears (fast_tuning: 10ms).
    tokio::time::sleep(Duration::from_millis(30)).await;
    let recovered = helper.ping().await.expect("post-restart ping ok");
    assert!(recovered.contains("stub-model"));
}

#[tokio::test]
async fn supervisor_demotes_after_max_failures() {
    let helper = fresh_helper_with_mode("always_die");
    // Drive pings until demotion. Each failure must wait out the backoff
    // window (10ms with fast_tuning) before the next attempt registers.
    // Bounded by wall-clock so the test can never hang.
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        let res = helper.ping().await;
        assert!(
            res.is_err(),
            "always_die must never produce a successful ping"
        );
        let h = helper.health();
        if !h.running && h.consecutive_failures >= 5 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }

    let health = helper.health();
    assert!(
        !health.running,
        "demoted helper should not be running; got {health:?}"
    );
    assert!(
        health.consecutive_failures >= 5,
        "should have hit max-failures; got {health:?}",
    );

    // And from here on every request fast-fails with Unavailable regardless
    // of timing.
    let err = helper.ping().await.expect_err("should stay demoted");
    assert!(matches!(err, HelperError::Unavailable(_)));
}

#[tokio::test]
async fn backoff_window_rejects_fast() {
    // `always_die` guarantees a failure on the very first exchange, which puts
    // the supervisor into a cooling-off window. The *next* immediate call must
    // return quickly (well under the full backoff) with Unavailable — this is
    // the "fail fast, don't block the UI" guarantee.
    let helper = fresh_helper_with_mode("always_die");
    let _ = helper.ping().await;

    let start = Instant::now();
    let err = helper.ping().await.expect_err("cooling-off window");
    let elapsed = start.elapsed();
    assert!(matches!(err, HelperError::Unavailable(_)));
    assert!(
        elapsed < Duration::from_millis(100),
        "fail-fast expected; took {elapsed:?}"
    );
}

#[tokio::test]
async fn stderr_is_captured_on_failure() {
    let helper = fresh_helper_with_mode("panic_to_stderr");
    let err = helper.ping().await.expect_err("ping should fail");
    assert!(matches!(
        err,
        HelperError::Unavailable(_) | HelperError::Io(_)
    ));
    let health = helper.health();
    assert!(health.consecutive_failures >= 1);
}

#[tokio::test]
async fn events_emit_ready_on_first_success_and_degraded_on_failure() {
    let helper = fresh_helper_with_mode("die_after_ping");
    let mut rx = helper.subscribe_events();

    let _ = helper.ping().await.expect("first ping ok");

    // First event should be Ready with a version string.
    let first = tokio::time::timeout(Duration::from_millis(200), rx.recv())
        .await
        .expect("recv within budget")
        .expect("event");
    match first {
        HelperEvent::Ready { version, model } => {
            assert!(!version.is_empty());
            assert!(model.contains("stub"));
        }
        other => panic!("expected Ready, got {other:?}"),
    }

    // Next ping fails (child exited). Expect a Degraded event.
    let _ = helper.ping().await;
    let second = tokio::time::timeout(Duration::from_millis(200), rx.recv())
        .await
        .expect("recv within budget")
        .expect("event");
    assert!(matches!(second, HelperEvent::Degraded { .. }));
}

#[tokio::test]
async fn events_emit_demoted_once_threshold_crossed() {
    let helper = fresh_helper_with_mode("always_die");
    let mut rx = helper.subscribe_events();

    // Drive failures until we see a Demoted event or hit the wall-clock.
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut saw_demoted = false;
    while Instant::now() < deadline && !saw_demoted {
        let _ = helper.ping().await;
        // Drain events without blocking indefinitely.
        while let Ok(ev) = tokio::time::timeout(Duration::from_millis(5), rx.recv()).await {
            if matches!(ev, Ok(HelperEvent::Demoted)) {
                saw_demoted = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    assert!(saw_demoted, "expected Demoted event within 2s");
}
