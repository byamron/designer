//! Auto-update plumbing. The actual Tauri updater plugin is wired at the
//! shell binary edge; this module provides a stable trait that the rest of
//! the core uses to check, download, and apply updates. Using a trait means
//! tests can swap in an in-memory updater that never touches the network.
//!
//! **Compliance note:** auto-update must never apply silently. The Tauri
//! updater plugin is configured to require user consent on every install.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub release_notes: String,
    pub download_url: String,
    pub signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStatus {
    UpToDate,
    Available,
    Downloading,
    Ready,
    Failed,
}

#[async_trait]
pub trait Updater: Send + Sync {
    async fn check(&self) -> Result<Option<UpdateInfo>, UpdaterError>;
    async fn download(&self, info: &UpdateInfo) -> Result<(), UpdaterError>;
    async fn apply(&self) -> Result<(), UpdaterError>;
    fn current_version(&self) -> &str;
}

#[derive(Debug, thiserror::Error)]
pub enum UpdaterError {
    #[error("network: {0}")]
    Network(String),
    #[error("signature verification failed")]
    Signature,
    #[error("unsupported platform")]
    UnsupportedPlatform,
}

pub struct NoopUpdater {
    pub version: String,
}

#[async_trait]
impl Updater for NoopUpdater {
    async fn check(&self) -> Result<Option<UpdateInfo>, UpdaterError> {
        Ok(None)
    }
    async fn download(&self, _info: &UpdateInfo) -> Result<(), UpdaterError> {
        Ok(())
    }
    async fn apply(&self) -> Result<(), UpdaterError> {
        Ok(())
    }
    fn current_version(&self) -> &str {
        &self.version
    }
}
