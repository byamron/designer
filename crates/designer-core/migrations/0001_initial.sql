-- Designer core schema — append-only event log + minimal projection cache.
-- PRAGMAs are applied by the connection pool (see SqliteEventStore::open)
-- because they cannot be issued inside a transaction.

CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    stream_kind     TEXT NOT NULL,
    stream_id       TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    timestamp       TEXT NOT NULL,
    actor_kind      TEXT NOT NULL,
    actor_team      TEXT,
    actor_role      TEXT,
    kind            TEXT NOT NULL,
    version         INTEGER NOT NULL,
    causation_id    TEXT,
    correlation_id  TEXT,
    payload_json    TEXT NOT NULL,
    UNIQUE (stream_kind, stream_id, sequence)
);

CREATE INDEX IF NOT EXISTS events_stream_idx
    ON events (stream_kind, stream_id, sequence);

CREATE INDEX IF NOT EXISTS events_kind_idx
    ON events (kind, timestamp);

CREATE INDEX IF NOT EXISTS events_timestamp_idx
    ON events (timestamp);

-- Projection cache. Projections can rebuild from `events` any time; this table
-- simply persists the last-seen state so startup is fast.
CREATE TABLE IF NOT EXISTS projection_state (
    name            TEXT PRIMARY KEY,
    last_event_id   TEXT,
    last_sequence   INTEGER,
    snapshot_json   TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- Migration ledger. `refinery`-free; we manage our own lightweight bookkeeping
-- so the store is dependency-light.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version         INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    applied_at      TEXT NOT NULL
);
