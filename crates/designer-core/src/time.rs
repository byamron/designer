//! Time primitives. All timestamps are UTC `OffsetDateTime` serialized as
//! RFC3339. A monotonic counter composed with wall time handles intra-process
//! ordering; see Phase 7 sync notes for vector-clock escalation.

use std::sync::atomic::{AtomicU64, Ordering};
use time::OffsetDateTime;

pub type Timestamp = OffsetDateTime;

static MONOTONIC_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn monotonic_now() -> (Timestamp, u64) {
    let now = OffsetDateTime::now_utc();
    let counter = MONOTONIC_COUNTER.fetch_add(1, Ordering::SeqCst);
    (now, counter)
}

pub fn rfc3339(ts: Timestamp) -> String {
    ts.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| ts.unix_timestamp().to_string())
}

pub fn parse_rfc3339(s: &str) -> Result<Timestamp, time::error::Parse> {
    OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
}
