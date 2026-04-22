//! Designer desktop binary. When the Tauri dependency is added, the
//! `tauri::Builder` takes ownership of this `main` and registers IPC commands
//! from `ipc.rs`. Until then, this binary runs a minimal demo that exercises
//! `AppCore` so the shell is exercisable from the CLI.

use designer_desktop::{core::AppCoreBoot, AppConfig, AppCore};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = AppConfig::default_in_home();
    let core = AppCore::boot(config).await?;

    // Minimal self-check.
    let project = core
        .create_project("Designer".into(), PathBuf::from("."))
        .await?;
    let ws = core
        .create_workspace(project.id, "onboarding".into(), "main".into())
        .await?;
    println!(
        "ready: project={} workspace={} ({})",
        project.name, ws.name, ws.base_branch
    );
    Ok(())
}
