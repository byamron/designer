//! Foundation helper runner — Rust side of the Swift ↔ Rust bridge.

use crate::cache::{CacheKey, ResponseCache};
use crate::protocol::{HelperRequest, HelperResponse, JobKind};
use crate::ratelimit::RateLimiter;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::warn;

#[derive(Debug, Error)]
pub enum HelperError {
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("helper reported: {0}")]
    Reported(String),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("unavailable: {0}")]
    Unavailable(String),
}

pub type HelperResult<T> = Result<T, HelperError>;

#[async_trait]
pub trait FoundationHelper: Send + Sync {
    async fn ping(&self) -> HelperResult<String>;
    async fn generate(&self, job: JobKind, prompt: &str) -> HelperResult<String>;
}

/// Swift helper runner: keeps a persistent subprocess and talks JSON-over-
/// stdio with 4-byte length framing.
pub struct SwiftFoundationHelper {
    binary: PathBuf,
    child: Mutex<Option<Child>>,
    cache: Arc<ResponseCache>,
    rate: Arc<RateLimiter>,
}

impl SwiftFoundationHelper {
    pub fn new(binary: PathBuf) -> Self {
        Self {
            binary,
            child: Mutex::new(None),
            cache: Arc::new(ResponseCache::new(
                Duration::from_secs(60 * 10),
                1024,
            )),
            rate: Arc::new(RateLimiter::new(10, 5)),
        }
    }

    async fn ensure_child(&self) -> HelperResult<()> {
        let mut guard = self.child.lock().await;
        if guard.is_some() {
            return Ok(());
        }
        let child = Command::new(&self.binary)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| HelperError::Spawn(format!("{}: {e}", self.binary.display())))?;
        *guard = Some(child);
        Ok(())
    }

    async fn exchange(&self, req: HelperRequest) -> HelperResult<HelperResponse> {
        self.ensure_child().await?;
        let mut guard = self.child.lock().await;
        let child = guard
            .as_mut()
            .ok_or_else(|| HelperError::Unavailable("no helper child".into()))?;
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| HelperError::Unavailable("no stdin".into()))?;
        let body = serde_json::to_vec(&req)?;
        let mut framed = (body.len() as u32).to_be_bytes().to_vec();
        framed.extend_from_slice(&body);
        stdin.write_all(&framed).await?;
        stdin.flush().await?;

        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| HelperError::Unavailable("no stdout".into()))?;
        let mut len_buf = [0u8; 4];
        stdout.read_exact(&mut len_buf).await?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut body = vec![0u8; len];
        stdout.read_exact(&mut body).await?;
        let resp: HelperResponse = serde_json::from_slice(&body)?;
        Ok(resp)
    }
}

#[async_trait]
impl FoundationHelper for SwiftFoundationHelper {
    async fn ping(&self) -> HelperResult<String> {
        match self.exchange(HelperRequest::Ping).await? {
            HelperResponse::Pong { version, model } => Ok(format!("{version} / {model}")),
            HelperResponse::Error { message } => Err(HelperError::Reported(message)),
            other => Err(HelperError::Protocol(format!("unexpected {other:?}"))),
        }
    }

    async fn generate(&self, job: JobKind, prompt: &str) -> HelperResult<String> {
        let key = CacheKey::new(job, prompt);
        if let Some(cached) = self.cache.get(&key) {
            return Ok(cached);
        }
        let wait = self.rate.acquire();
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        match self
            .exchange(HelperRequest::Generate {
                job,
                prompt: prompt.into(),
            })
            .await?
        {
            HelperResponse::Text { text } => {
                self.cache.put(key, text.clone());
                Ok(text)
            }
            HelperResponse::Error { message } => Err(HelperError::Reported(message)),
            other => Err(HelperError::Protocol(format!("unexpected {other:?}"))),
        }
    }
}

/// Fallback when the helper isn't installed. Returns deterministic placeholder
/// responses so the rest of the app still works. Emits a WARN on first use.
pub struct NullHelper {
    warned: parking_lot::Mutex<bool>,
}

impl Default for NullHelper {
    fn default() -> Self {
        Self {
            warned: parking_lot::Mutex::new(false),
        }
    }
}

impl NullHelper {
    fn warn_once(&self) {
        let mut w = self.warned.lock();
        if !*w {
            warn!("local-model helper unavailable; using null fallback");
            *w = true;
        }
    }
}

#[async_trait]
impl FoundationHelper for NullHelper {
    async fn ping(&self) -> HelperResult<String> {
        self.warn_once();
        Ok("null / disabled".into())
    }

    async fn generate(&self, job: JobKind, prompt: &str) -> HelperResult<String> {
        self.warn_once();
        let preview = prompt.chars().take(80).collect::<String>();
        Ok(format!("[offline {:?}] {preview}", job))
    }
}
