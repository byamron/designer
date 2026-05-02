//! Designer desktop entry point.
//!
//! Boot sequence (ordered for zero-flash cold boot):
//! 1. Install panic hook → `~/.designer/crashes/`.
//! 2. Read `~/.designer/settings.json` synchronously; resolve theme.
//! 3. Build `AppCore` on a tokio runtime (blocking).
//! 4. Launch the Tauri builder with the resolved theme passed via URL hash so
//!    `index.html` can set `documentElement.dataset.theme` before React loads.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use designer_desktop::commands;
use designer_desktop::commands_agents;
use designer_desktop::commands_friction;
use designer_desktop::commands_git;
use designer_desktop::commands_learn;
use designer_desktop::commands_local;
use designer_desktop::commands_safety;
use designer_desktop::core::AppCoreBoot;
use designer_desktop::core_agents::{coalesce_window_from_env, spawn_message_coalescer};
use designer_desktop::core_proposals::spawn_track_completed_subscriber;
use designer_desktop::events::spawn_event_bridge;
use designer_desktop::menu::{build_menu, MENU_ID_FEEDBACK, MENU_ID_NEW_PROJECT};
use designer_desktop::settings::{ResolvedTheme, Settings};
use designer_desktop::store_watcher::spawn_store_watcher;
use designer_desktop::{crash, AppConfig, AppCore};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder};

const FEEDBACK_URL: &str = "https://github.com/byamron/designer/issues/new";
const MAIN_WINDOW_LABEL: &str = "main";
const EVENT_MENU_NEW_PROJECT: &str = "designer://menu/new-project";

fn main() {
    let mut config = AppConfig::default_in_home();
    // Install the panic hook before tracing so a logger init panic is
    // captured by the crash file.
    crash::install_panic_hook(config.data_dir.join("crashes"));
    let _log_guard = init_tracing(&config.data_dir);

    // Settings load is synchronous-by-design: we need the resolved theme
    // *before* the window opens so the first paint is already the right color.
    let settings = Settings::load(&config.data_dir);
    let theme = settings.resolve();

    // Resolve which orchestrator runs this session. Precedence: env var >
    // settings.json > AppConfig default. Logged below so the boot mode is
    // unambiguous in support bundles.
    let orchestrator_source = if let Ok(v) = std::env::var("DESIGNER_USE_MOCK") {
        let mock = matches!(v.as_str(), "1" | "true" | "yes");
        config.use_mock_orchestrator = mock;
        "DESIGNER_USE_MOCK"
    } else if let Some(mock) = settings.use_mock_orchestrator {
        config.use_mock_orchestrator = mock;
        "settings.json"
    } else {
        "AppConfig default"
    };
    let orchestrator_label = if config.use_mock_orchestrator {
        "mock simulator"
    } else {
        "real Claude"
    };

    // Preflight against the configured `claude` binary when running in
    // real-Claude mode. A missing or unauth'd binary won't crash boot —
    // we degrade with a loud warning so the UI's first claude tool call
    // can surface a clean error instead of a generic spawn failure.
    let claude_version = if !config.use_mock_orchestrator {
        let bin = config
            .claude_options
            .binary_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("claude"));
        match std::process::Command::new(&bin).arg("--version").output() {
            Ok(out) if out.status.success() => {
                Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
            }
            Ok(out) => {
                tracing::warn!(
                    binary = %bin.display(),
                    status = ?out.status,
                    stderr = %String::from_utf8_lossy(&out.stderr),
                    "claude --version returned a non-zero exit; agent calls will fail until this is resolved"
                );
                None
            }
            Err(err) => {
                tracing::warn!(
                    binary = %bin.display(),
                    error = %err,
                    "could not run `claude --version` (is the binary installed and on PATH?); agent calls will fail until this is resolved"
                );
                None
            }
        }
    } else {
        None
    };

    tracing::info!(
        theme = ?theme,
        data_dir = %config.data_dir.display(),
        orchestrator = orchestrator_label,
        orchestrator_source,
        claude_version = claude_version.as_deref(),
        "designer starting"
    );

    // Build AppCore on a dedicated runtime. Tauri's `async_runtime` wraps tokio
    // and shares this runtime for subsequent async work.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let core: Arc<AppCore> = match runtime.block_on(AppCore::boot(config.clone())) {
        Ok(core) => core,
        Err(err) => {
            tracing::error!(error = %err, "failed to boot AppCore");
            eprintln!("designer: failed to start — {err}");
            std::process::exit(1);
        }
    };

    // Install the runtime as Tauri's async runtime so `tauri::async_runtime::spawn`
    // uses it, not a fresh pool.
    tauri::async_runtime::set(runtime.handle().clone());

    let core_for_state = core.clone();

    tauri::Builder::default()
        // Native dialog plugin — backs the Finder folder picker in
        // CreateProjectModal. No fs/shell permissions are granted; the
        // dialog returns a path string that the existing
        // `cmd_validate_project_path` IPC validates server-side before
        // any project state is created.
        .plugin(tauri_plugin_dialog::init())
        // Auto-updater plugin (DP-A). Reads the GitHub Releases manifest
        // on demand; the frontend triggers the check via the plugin's
        // JS API and renders the prompt. Public key + endpoint live in
        // tauri.conf.json `plugins.updater`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Process plugin gives the frontend `relaunch()` after the
        // updater applies a new bundle.
        .plugin(tauri_plugin_process::init())
        .manage(core_for_state)
        .invoke_handler(tauri::generate_handler![
            commands::close_tab,
            commands::create_project,
            commands::create_workspace,
            commands::get_artifact,
            commands::get_theme,
            commands::list_artifacts,
            commands::list_pinned_artifacts,
            commands::list_projects,
            commands::list_spine_artifacts,
            commands::list_workspaces,
            commands::open_tab,
            commands::request_approval,
            commands::resolve_approval,
            commands::reveal_in_finder,
            commands::set_theme,
            commands::spine,
            commands::toggle_pin_artifact,
            commands::validate_project_path,
            commands_agents::post_message,
            commands_friction::cmd_address_friction,
            commands_friction::cmd_capture_viewport,
            commands_friction::cmd_list_friction,
            commands_friction::cmd_reopen_friction,
            commands_friction::cmd_report_friction,
            commands_friction::cmd_resolve_friction,
            commands_git::cmd_get_track,
            commands_git::cmd_link_repo,
            commands_git::cmd_list_tracks,
            commands_git::cmd_request_merge,
            commands_git::cmd_start_track,
            commands_git::cmd_unlink_repo,
            commands_learn::cmd_list_findings,
            commands_learn::cmd_list_proposals,
            commands_learn::cmd_resolve_proposal,
            #[allow(deprecated)]
            commands_learn::cmd_signal_finding,
            commands_learn::cmd_signal_proposal,
            commands_local::cmd_audit_artifact,
            commands_local::cmd_recap_workspace,
            commands_safety::cmd_get_cost_chip_preference,
            commands_safety::cmd_get_cost_status,
            commands_safety::cmd_get_feature_flags,
            commands_safety::cmd_get_keychain_status,
            commands_safety::cmd_list_pending_approvals,
            commands_safety::cmd_set_cost_chip_preference,
            commands_safety::cmd_set_feature_flag,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            make_main_window(&handle, theme)?;

            let menu = build_menu(&handle)?;
            app.set_menu(menu)?;

            // Start the Rust → frontend event bridge. Shares the managed
            // `Arc<AppCore>` — if `AppCore` is ever rebuilt at runtime, this
            // task should be torn down and re-spawned.
            let core: tauri::State<'_, Arc<AppCore>> = app.state();
            spawn_event_bridge(handle.clone(), core.inner().clone());

            // Phase 13.D: spawn the message coalescer. Subscribes to the
            // orchestrator's broadcast channel and turns bursts of agent
            // `MessagePosted` events into one `ArtifactCreated { kind:
            // Message }` per (workspace, author_role) once idle. Window
            // overridable via `DESIGNER_MESSAGE_COALESCE_MS` for tests.
            spawn_message_coalescer(core.inner().clone(), coalesce_window_from_env());

            // Phase 21.A1.2: subscribe to the event store for
            // `TrackCompleted` events. Each one schedules a debounced
            // proposal-synthesis pass for the track's project. Runs at
            // boundaries (track-complete + first-view-of-day) so the
            // user-facing surface refreshes between contexts, not
            // mid-task.
            spawn_track_completed_subscriber(core.inner().clone());

            // Watch `<data_dir>/events.db` for external mutations (the
            // `designer` CLI, manual sqlite edits during dogfood, etc.)
            // and emit `designer://store-changed` so derived UIs like
            // the Friction triage list re-fetch without a tab bounce.
            spawn_store_watcher(handle.clone(), core.inner().config.data_dir.clone());

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_ID_NEW_PROJECT => {
                // Forward to frontend; App.tsx listens and opens the creation
                // affordance (same flow as the "+" button in the strip).
                let _ = app.emit(EVENT_MENU_NEW_PROJECT, ());
            }
            MENU_ID_FEEDBACK => {
                if let Err(err) = open_url(FEEDBACK_URL) {
                    tracing::warn!(error = %err, "failed to open feedback URL");
                }
            }
            #[cfg(debug_assertions)]
            "designer.devtools" => {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("tauri build")
        .run(|app, event| {
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                // macOS dock-click convention: when no window is visible,
                // rebuild it. Quit remains explicit via Cmd+Q.
                if !has_visible_windows && app.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
                    let theme =
                        Settings::load(&app.state::<Arc<AppCore>>().config.data_dir).resolve();
                    if let Err(err) = make_main_window(app, theme) {
                        tracing::warn!(error = %err, "failed to rebuild main window on reopen");
                    }
                }
            }
        });
}

/// Build the main window. Kept a free function (not inside `.setup()`) so the
/// reopen handler can reuse the exact same configuration — the cold boot and
/// dock-reopen code paths cannot drift.
fn make_main_window<R: Runtime, M: Manager<R>>(app: &M, theme: ResolvedTheme) -> tauri::Result<()> {
    let url = WebviewUrl::App(format!("index.html#theme={}", theme.as_str()).into());
    let (r, g, b, a) = theme.background_rgba();
    let tauri_theme = match theme {
        ResolvedTheme::Light => tauri::Theme::Light,
        ResolvedTheme::Dark => tauri::Theme::Dark,
    };
    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, url)
        .title("Designer")
        .inner_size(1280.0, 832.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .background_color(tauri::webview::Color(r, g, b, a))
        .theme(Some(tauri_theme))
        .build()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(url).status()?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_url(_url: &str) -> std::io::Result<()> {
    Ok(())
}

/// Initialize the tracing subscriber with both stderr and a daily-rotating
/// file appender at `<data_dir>/logs/designer.log.<YYYY-MM-DD>`.
///
/// The bundled `.app` is launched by launchd, which routes stdout/stderr
/// to `/dev/null`. Without an on-disk sink, every chat-flow regression
/// in the bundle is invisible — exactly the gap that delayed root-causing
/// the chat-hang reported in friction
/// frc_019de701-d11f-7c40-825e-8c0b1a7c0a23. The returned guard must be
/// held by `main` for the appender to flush on graceful exit; dropping
/// it eagerly silently truncates the trailing log lines.
///
/// Default level: `info`. Override via `RUST_LOG=designer=debug,…` for a
/// dev-only deeper trace; the env var is honored if set.
///
/// **Privacy.** At the default `info` level the file captures workspace
/// IDs, subprocess PIDs, the resolved `claude` binary path, message
/// *lengths* (`body_len`), and any stderr the `claude` subprocess emits.
/// It deliberately does NOT capture user prompt bodies or claude reply
/// bodies — `cmd_post_message` and the orchestrator's send-paths log
/// `body_len`, never `body`. A `RUST_LOG=trace` envelope could surface
/// more — only enable that during a deliberate diagnostic session.
fn init_tracing(data_dir: &std::path::Path) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let stderr_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true);

    let log_dir = data_dir.join("logs");
    let mk_file_layer = || -> std::io::Result<_> {
        std::fs::create_dir_all(&log_dir)?;
        let file_appender = tracing_appender::rolling::daily(&log_dir, "designer.log");
        let (writer, guard) = tracing_appender::non_blocking(file_appender);
        let layer = tracing_subscriber::fmt::layer()
            .with_writer(writer)
            .with_target(true)
            .with_ansi(false);
        Ok((layer, guard))
    };

    match mk_file_layer() {
        Ok((file_layer, guard)) => {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(stderr_layer)
                .with(file_layer)
                .init();
            tracing::info!(dir = %log_dir.display(), "log file appender armed");
            Some(guard)
        }
        Err(err) => {
            // Fall back to stderr-only. Don't panic the boot just because
            // we can't write logs — the app can still run; we'll just
            // miss the diagnostics.
            tracing_subscriber::registry()
                .with(env_filter)
                .with(stderr_layer)
                .init();
            tracing::warn!(error = %err, dir = %log_dir.display(), "could not arm file appender; logs go to stderr only");
            None
        }
    }
}
