//! Token-bucket rate limiter for the foundation helper. Local inference is
//! cheap but not free — multiple simultaneous callers (activity spine, audit,
//! recap, patterns) can overwhelm a single Foundation Models session if we
//! don't throttle.

use parking_lot::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    capacity: f64,
    tokens_per_sec: f64,
    state: Mutex<State>,
}

struct State {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    pub fn new(capacity: u32, tokens_per_sec: u32) -> Self {
        Self {
            capacity: capacity as f64,
            tokens_per_sec: tokens_per_sec as f64,
            state: Mutex::new(State {
                tokens: capacity as f64,
                last: Instant::now(),
            }),
        }
    }

    /// Returns the wait duration before the caller should proceed. A duration
    /// of zero means: proceed immediately.
    pub fn acquire(&self) -> Duration {
        let mut st = self.state.lock();
        let now = Instant::now();
        let elapsed = now.duration_since(st.last).as_secs_f64();
        st.tokens = (st.tokens + elapsed * self.tokens_per_sec).min(self.capacity);
        st.last = now;
        if st.tokens >= 1.0 {
            st.tokens -= 1.0;
            Duration::ZERO
        } else {
            let needed = 1.0 - st.tokens;
            Duration::from_secs_f64(needed / self.tokens_per_sec)
        }
    }
}
