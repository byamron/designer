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
use designer_desktop::core::AppCoreBoot;
use designer_desktop::events::spawn_event_bridge;
use designer_desktop::menu::{build_menu, MENU_ID_FEEDBACK, MENU_ID_NEW_PROJECT};
use designer_desktop::settings::{ResolvedTheme, Settings};
use designer_desktop::{crash, AppConfig, AppCore};
use std::sync::Arc;
use tauri::{Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder};

const FEEDBACK_URL: &str = "https://github.com/byamron/designer/issues/new";
const MAIN_WINDOW_LABEL: &str = "main";
const EVENT_MENU_NEW_PROJECT: &str = "designer://menu/new-project";

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = AppConfig::default_in_home();
    crash::install_panic_hook(config.data_dir.join("crashes"));

    // Settings load is synchronous-by-design: we need the resolved theme
    // *before* the window opens so the first paint is already the right color.
    let settings = Settings::load(&config.data_dir);
    let theme = settings.resolve();
    tracing::info!(
        theme = ?theme,
        data_dir = %config.data_dir.display(),
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
        .manage(core_for_state)
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::list_workspaces,
            commands::create_workspace,
            commands::open_tab,
            commands::spine,
            commands::request_approval,
            commands::resolve_approval,
            commands::get_theme,
            commands::set_theme,
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
