//! Pairing primitives. The user enters a 6-digit code displayed on the host
//! device; the mobile client scans or types it. No cloud involvement.
//!
//! `PairingMaterial` is derived via a 256-bit shared secret generated on the
//! host; the secret is expected to be delivered out-of-band (QR). The
//! `PairingCode` is a short human-readable confirmation derived from the
//! secret's SHA-256 prefix.

use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingMaterial {
    pub secret: [u8; 32],
}

impl PairingMaterial {
    pub fn random() -> Self {
        let mut buf = [0u8; 32];
        // Best-effort OS entropy via `/dev/urandom` read — avoids adding
        // a `rand` dep for such a narrow use. Pairing secrets are not
        // crypto-primitives on their own; they seed a DH/ECDH handshake in
        // the transport. This is a placeholder until Phase-7 transport chooses
        // a specific KEM (Noise, WebRTC DTLS, or MASQUE relay TLS).
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            use std::io::Read;
            let _ = f.read_exact(&mut buf);
        } else {
            let ts = time::OffsetDateTime::now_utc().unix_timestamp_nanos().to_le_bytes();
            buf[..ts.len().min(32)].copy_from_slice(&ts[..ts.len().min(32)]);
        }
        Self { secret: buf }
    }

    pub fn code(&self) -> PairingCode {
        let mut hasher = Sha256::new();
        hasher.update(self.secret);
        let digest = hasher.finalize();
        // Take 6 decimal digits from the first 3 bytes for a short user code.
        let n = u32::from_be_bytes([digest[0], digest[1], digest[2], 0]) % 1_000_000;
        PairingCode(format!("{n:06}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairingCode(pub String);
