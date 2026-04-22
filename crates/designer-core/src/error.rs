//! Core error types. We use `thiserror` for ergonomic derives and keep the
//! surface small — consumers should not match on specific variants beyond the
//! high-level categories listed here.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("event store error: {0}")]
    Store(#[from] StoreError),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("invalid id: {0}")]
    InvalidId(String),

    #[error("projection error: {0}")]
    Projection(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invariant violated: {0}")]
    Invariant(String),

    #[error("concurrency conflict: expected sequence {expected}, found {actual}")]
    Concurrency { expected: u64, actual: u64 },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("pool error: {0}")]
    Pool(String),

    #[error("migration error: {0}")]
    Migration(String),

    #[error("append failed: {0}")]
    Append(String),
}

impl From<r2d2::Error> for StoreError {
    fn from(e: r2d2::Error) -> Self {
        StoreError::Pool(e.to_string())
    }
}
