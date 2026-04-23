//! Event store. SQLite, WAL mode, append-only. Reads are streamed by stream +
//! sequence; writes check optimistic concurrency (expected sequence).

use crate::error::{Result, StoreError};
use crate::event::{EventEnvelope, EventPayload};
use crate::ids::{EventId, StreamId};
use crate::time::{monotonic_now, rfc3339};
use async_trait::async_trait;
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::path::Path;
use std::sync::Arc;
use tokio::task;
use tracing::{debug, info, instrument};

const MIGRATIONS: &[(i64, &str, &str)] =
    &[(1, "initial", include_str!("../migrations/0001_initial.sql"))];

/// Options when reading events from a stream.
#[derive(Debug, Clone, Default)]
pub struct StreamOptions {
    /// Start reading from (exclusive) this sequence.
    pub after_sequence: Option<u64>,
    /// Stop at (inclusive) this sequence.
    pub until_sequence: Option<u64>,
    /// Limit.
    pub limit: Option<u64>,
}

#[async_trait]
pub trait EventStore: Send + Sync {
    /// Append a new event. Supplies the next sequence within the stream if
    /// `expected_sequence` is `None`, otherwise asserts optimistic concurrency.
    async fn append(
        &self,
        stream: StreamId,
        expected_sequence: Option<u64>,
        actor: crate::domain::Actor,
        payload: EventPayload,
    ) -> Result<EventEnvelope>;

    /// Read events from a stream in sequence order.
    async fn read_stream(
        &self,
        stream: StreamId,
        options: StreamOptions,
    ) -> Result<Vec<EventEnvelope>>;

    /// Read all events globally (ordered by `(stream, sequence)` then
    /// timestamp). Used by the audit log and sync protocol.
    async fn read_all(&self, options: StreamOptions) -> Result<Vec<EventEnvelope>>;

    /// Subscribe to new events via a callback. The implementation may choose
    /// polling or in-memory fan-out; this trait only guarantees best-effort
    /// delivery while the subscriber is alive.
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<EventEnvelope>;
}

#[derive(Clone)]
pub struct SqliteEventStore {
    pool: Pool<SqliteConnectionManager>,
    broadcaster: Arc<tokio::sync::broadcast::Sender<EventEnvelope>>,
}

impl SqliteEventStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // WAL mode is a database-level setting, not a per-connection one. If
        // every pooled connection tries to switch journal mode concurrently,
        // one wins and the others get `database is locked`. We enable WAL
        // once via a one-shot connection before the pool opens, then the
        // per-connection `with_init` only sets non-racing PRAGMAs.
        {
            use rusqlite::Connection;
            let bootstrap = Connection::open(&path).map_err(StoreError::Sqlite)?;
            bootstrap
                .pragma_update(None, "journal_mode", "WAL")
                .map_err(StoreError::Sqlite)?;
            bootstrap
                .pragma_update(None, "synchronous", "NORMAL")
                .map_err(StoreError::Sqlite)?;
        }

        let manager = SqliteConnectionManager::file(&path)
            .with_init(|c| c.execute_batch("PRAGMA foreign_keys=ON;"));
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(|e| StoreError::Pool(e.to_string()))?;
        let store = SqliteEventStore {
            pool,
            broadcaster: Arc::new(tokio::sync::broadcast::channel(1024).0),
        };
        store.migrate()?;
        info!(path = %path.display(), "event store opened");
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let manager = SqliteConnectionManager::memory().with_init(|c| {
            c.execute_batch("PRAGMA foreign_keys=ON;")?;
            Ok(())
        });
        let pool = Pool::builder()
            .max_size(4)
            .build(manager)
            .map_err(|e| StoreError::Pool(e.to_string()))?;
        let store = SqliteEventStore {
            pool,
            broadcaster: Arc::new(tokio::sync::broadcast::channel(1024).0),
        };
        store.migrate()?;
        Ok(store)
    }

    fn conn(&self) -> Result<PooledConnection<SqliteConnectionManager>> {
        self.pool
            .get()
            .map_err(|e| StoreError::Pool(e.to_string()).into())
    }

    #[instrument(skip(self))]
    fn migrate(&self) -> Result<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(StoreError::Sqlite)?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(StoreError::Sqlite)?;
        for (version, name, sql) in MIGRATIONS {
            let already: Option<i64> = tx
                .query_row(
                    "SELECT version FROM schema_migrations WHERE version = ?1",
                    params![version],
                    |r| r.get(0),
                )
                .ok();
            if already.is_none() {
                tx.execute_batch(sql).map_err(StoreError::Sqlite)?;
                tx.execute(
                    "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                    params![version, name, rfc3339(time::OffsetDateTime::now_utc())],
                )
                .map_err(StoreError::Sqlite)?;
                debug!(version, name, "applied migration");
            }
        }
        tx.commit().map_err(StoreError::Sqlite)?;
        Ok(())
    }
}

fn row_to_envelope(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventEnvelope> {
    use crate::domain::Actor;
    let id: String = row.get("id")?;
    let stream_kind: String = row.get("stream_kind")?;
    let stream_id: String = row.get("stream_id")?;
    let sequence: i64 = row.get("sequence")?;
    let timestamp_s: String = row.get("timestamp")?;
    let actor_kind: String = row.get("actor_kind")?;
    let actor_team: Option<String> = row.get("actor_team")?;
    let actor_role: Option<String> = row.get("actor_role")?;
    let version: i64 = row.get("version")?;
    let causation_id: Option<String> = row.get("causation_id")?;
    let correlation_id: Option<String> = row.get("correlation_id")?;
    let payload_json: String = row.get("payload_json")?;

    let stream = match stream_kind.as_str() {
        "project" => StreamId::Project(crate::ids::ProjectId::from_uuid(
            uuid::Uuid::parse_str(&stream_id).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?,
        )),
        "workspace" => StreamId::Workspace(crate::ids::WorkspaceId::from_uuid(
            uuid::Uuid::parse_str(&stream_id).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?,
        )),
        _ => StreamId::System,
    };

    let actor = match actor_kind.as_str() {
        "user" => Actor::User,
        "system" => Actor::System,
        "agent" => Actor::Agent {
            team: actor_team.unwrap_or_default(),
            role: actor_role.unwrap_or_default(),
        },
        other => Actor::Agent {
            team: other.into(),
            role: "unknown".into(),
        },
    };

    let payload: EventPayload = serde_json::from_str(&payload_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;

    let timestamp = crate::time::parse_rfc3339(&timestamp_s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;

    let id = EventId::from_uuid(uuid::Uuid::parse_str(&id).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?);
    let causation_id = causation_id
        .map(|c| {
            uuid::Uuid::parse_str(&c)
                .map(EventId::from_uuid)
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        })
        .transpose()?;
    let correlation_id = correlation_id
        .map(|c| {
            uuid::Uuid::parse_str(&c)
                .map(EventId::from_uuid)
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        })
        .transpose()?;

    Ok(EventEnvelope {
        id,
        stream,
        sequence: sequence as u64,
        timestamp,
        actor,
        version: version as u16,
        causation_id,
        correlation_id,
        payload,
    })
}

#[async_trait]
impl EventStore for SqliteEventStore {
    #[instrument(skip(self, payload))]
    async fn append(
        &self,
        stream: StreamId,
        expected_sequence: Option<u64>,
        actor: crate::domain::Actor,
        payload: EventPayload,
    ) -> Result<EventEnvelope> {
        let pool = self.pool.clone();
        let broadcaster = self.broadcaster.clone();

        let result = task::spawn_blocking(move || -> Result<EventEnvelope> {
            let mut conn = pool.get().map_err(|e| StoreError::Pool(e.to_string()))?;
            let tx = conn.transaction().map_err(StoreError::Sqlite)?;

            let stream_kind = stream.discriminant();
            let stream_id_str = stream.raw();

            let current: Option<i64> = tx
                .query_row(
                    "SELECT MAX(sequence) FROM events WHERE stream_kind = ?1 AND stream_id = ?2",
                    params![stream_kind, stream_id_str],
                    |r| r.get(0),
                )
                .ok()
                .flatten();

            let actual = current.map(|c| c as u64).unwrap_or(0);
            if let Some(exp) = expected_sequence {
                if exp != actual {
                    return Err(crate::error::CoreError::Concurrency {
                        expected: exp,
                        actual,
                    });
                }
            }
            let next_sequence = actual + 1;

            let (timestamp, _counter) = monotonic_now();
            let event_id = EventId::new();
            let envelope = EventEnvelope {
                id: event_id,
                stream: stream.clone(),
                sequence: next_sequence,
                timestamp,
                actor: actor.clone(),
                version: 1,
                causation_id: None,
                correlation_id: None,
                payload,
            };

            let (actor_kind, actor_team, actor_role) = match &actor {
                crate::domain::Actor::User => ("user", None, None),
                crate::domain::Actor::System => ("system", None, None),
                crate::domain::Actor::Agent { team, role } => {
                    ("agent", Some(team.clone()), Some(role.clone()))
                }
            };
            let payload_json = serde_json::to_string(&envelope.payload)
                .map_err(|e| StoreError::Append(format!("serialize payload: {e}")))?;

            tx.execute(
                "INSERT INTO events (id, stream_kind, stream_id, sequence, timestamp,
                    actor_kind, actor_team, actor_role, kind, version, causation_id,
                    correlation_id, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    envelope.id.as_uuid().to_string(),
                    stream_kind,
                    stream_id_str,
                    next_sequence as i64,
                    rfc3339(envelope.timestamp),
                    actor_kind,
                    actor_team,
                    actor_role,
                    serde_json::to_string(&envelope.kind())
                        .unwrap_or_default()
                        .trim_matches('"')
                        .to_string(),
                    envelope.version as i64,
                    envelope.causation_id.map(|c| c.as_uuid().to_string()),
                    envelope.correlation_id.map(|c| c.as_uuid().to_string()),
                    payload_json,
                ],
            )
            .map_err(StoreError::Sqlite)?;

            tx.commit().map_err(StoreError::Sqlite)?;
            let _ = broadcaster.send(envelope.clone());
            Ok(envelope)
        })
        .await
        .map_err(|e| StoreError::Append(format!("join: {e}")))??;

        Ok(result)
    }

    async fn read_stream(
        &self,
        stream: StreamId,
        options: StreamOptions,
    ) -> Result<Vec<EventEnvelope>> {
        let pool = self.pool.clone();
        task::spawn_blocking(move || -> Result<Vec<EventEnvelope>> {
            let conn = pool.get().map_err(|e| StoreError::Pool(e.to_string()))?;
            let stream_kind = stream.discriminant();
            let stream_id_str = stream.raw();
            let after = options.after_sequence.unwrap_or(0) as i64;
            let until = options.until_sequence.map(|x| x as i64).unwrap_or(i64::MAX);
            let limit = options.limit.map(|x| x as i64).unwrap_or(i64::MAX);
            let mut stmt = conn
                .prepare(
                    "SELECT * FROM events
                     WHERE stream_kind = ?1 AND stream_id = ?2
                       AND sequence > ?3 AND sequence <= ?4
                     ORDER BY sequence ASC
                     LIMIT ?5",
                )
                .map_err(StoreError::Sqlite)?;
            let rows = stmt
                .query_map(
                    params![stream_kind, stream_id_str, after, until, limit],
                    row_to_envelope,
                )
                .map_err(StoreError::Sqlite)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(StoreError::Sqlite)?);
            }
            Ok(out)
        })
        .await
        .map_err(|e| StoreError::Append(format!("join: {e}")))?
    }

    async fn read_all(&self, options: StreamOptions) -> Result<Vec<EventEnvelope>> {
        let pool = self.pool.clone();
        task::spawn_blocking(move || -> Result<Vec<EventEnvelope>> {
            let conn = pool.get().map_err(|e| StoreError::Pool(e.to_string()))?;
            let limit = options.limit.map(|x| x as i64).unwrap_or(i64::MAX);
            let mut stmt = conn
                .prepare("SELECT * FROM events ORDER BY timestamp ASC, sequence ASC LIMIT ?1")
                .map_err(StoreError::Sqlite)?;
            let rows = stmt
                .query_map(params![limit], row_to_envelope)
                .map_err(StoreError::Sqlite)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(StoreError::Sqlite)?);
            }
            Ok(out)
        })
        .await
        .map_err(|e| StoreError::Append(format!("join: {e}")))?
    }

    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<EventEnvelope> {
        self.broadcaster.subscribe()
    }
}
