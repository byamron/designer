//! Response cache keyed on (job, prompt hash). Keeps repeated prompts cheap
//! and deterministic — especially useful for pattern detection where the same
//! activity window gets summarized many times.

use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::protocol::JobKind;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub job: JobKind,
    pub prompt_hash: String,
}

impl CacheKey {
    pub fn new(job: JobKind, prompt: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(prompt.as_bytes());
        Self {
            job,
            prompt_hash: hex::encode(hasher.finalize()),
        }
    }
}

struct Entry {
    value: String,
    inserted_at: Instant,
}

pub struct ResponseCache {
    ttl: Duration,
    inner: RwLock<HashMap<CacheKey, Entry>>,
    capacity: usize,
}

impl ResponseCache {
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        Self {
            ttl,
            inner: RwLock::new(HashMap::new()),
            capacity,
        }
    }

    pub fn get(&self, key: &CacheKey) -> Option<String> {
        let inner = self.inner.read();
        let entry = inner.get(key)?;
        if entry.inserted_at.elapsed() > self.ttl {
            None
        } else {
            Some(entry.value.clone())
        }
    }

    pub fn put(&self, key: CacheKey, value: String) {
        let mut inner = self.inner.write();
        if inner.len() >= self.capacity {
            // Drop the oldest 10% when we hit the cap.
            let mut items: Vec<(CacheKey, Instant)> = inner
                .iter()
                .map(|(k, v)| (k.clone(), v.inserted_at))
                .collect();
            items.sort_by_key(|(_, t)| *t);
            let to_drop = (self.capacity / 10).max(1);
            for (k, _) in items.into_iter().take(to_drop) {
                inner.remove(&k);
            }
        }
        inner.insert(
            key,
            Entry {
                value,
                inserted_at: Instant::now(),
            },
        );
    }
}
