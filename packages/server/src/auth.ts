import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The app token authorizes everything privileged (the WebSocket and the API). It lives in a 0600 file so the
 * link stays valid across restarts, and in the browser's per-origin storage once the link has been opened.
 * Delete the file to rotate it.
 */
export function loadToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const f = join(dataDir, 'token');
  if (existsSync(f)) {
    const t = readFileSync(f, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(t)) {
      chmodSync(f, 0o600);
      return t;
    }
  }
  const t = randomBytes(32).toString('hex');
  writeFileSync(f, t + '\n', { mode: 0o600 });
  return t;
}

/** Constant-time comparison so a wrong token leaks nothing through timing. */
export function tokenOk(provided: string | null | undefined, token: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Headers for the app's own pages: no framing (clickjacking), no inline script, no sniffing, nothing leaks via Referer. */
export function pageHeaders(port: number): Record<string, string> {
  const ws = `ws://localhost:${port} ws://127.0.0.1:${port}`;
  return {
    'content-security-policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'", // React sets inline style attributes
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self' ${ws}`,
      'frame-src http://localhost:* http://127.0.0.1:*', // previews and proxied pages live on other local ports
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; '),
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
  };
}
