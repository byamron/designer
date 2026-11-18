// Pure helpers for the desktop shell (no Electron imports) so they can be unit tested.
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';

/** First free port at or after `start` on loopback. */
export async function findPort(start, tries = 40) {
  const free = (p) => new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
  });
  for (let i = 0; i < tries; i++) {
    // the preview server uses port+1, so both must be free
    if ((await free(start + i * 2)) && (await free(start + i * 2 + 1))) return start + i * 2;
  }
  throw new Error(`no free port near ${start}`);
}

/** Only web and mail links are ever handed to the operating system. */
export function isSafeExternal(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** True when `url` is on the app's own origin (the only place the window may navigate). */
export function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

const START = '__DESIGNER_PATH_START__';
const END = '__DESIGNER_PATH_END__';

/** Pull PATH out of a login shell's output, ignoring whatever noise its startup files print. */
export function parseShellPath(out) {
  const m = new RegExp(`${START}(.*?)${END}`, 's').exec(out);
  const p = m?.[1].trim();
  return p && !p.includes('\n') ? p : undefined;
}

/**
 * An app launched from the Dock does not get the PATH of your terminal (Homebrew, nvm, pnpm are missing), so the
 * commands Claude runs would not be found. Ask your login shell for its PATH and use that.
 */
export function loginShellPath({ shell = process.env.SHELL || '/bin/zsh', timeoutMs = 6000, run = execFile } = {}) {
  return new Promise((res) => {
    run(shell, ['-ilc', `printf '%s' "${START}$PATH${END}"`], { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } }, (err, stdout) => {
      res(err && !stdout ? undefined : parseShellPath(String(stdout)));
    });
  });
}

/** Merge a login-shell PATH after the one we already have, keeping order and dropping duplicates. */
export function mergePaths(current, fromShell, sep = ':') {
  const seen = new Set();
  return [...(fromShell ?? '').split(sep), ...(current ?? '').split(sep)].filter((p) => p && !seen.has(p) && seen.add(p)).join(sep);
}

/** Saved window bounds, validated so a corrupt file or an unplugged monitor cannot open the window off-screen. */
export function sanitizeBounds(b, displays) {
  const ok = (n) => Number.isFinite(n);
  if (!b || ![b.x, b.y, b.width, b.height].every(ok) || b.width < 600 || b.height < 400 || b.width > 10000 || b.height > 10000) return undefined;
  const onScreen = displays.some((d) => b.x < d.x + d.width - 80 && b.x + b.width > d.x + 80 && b.y >= d.y - 10 && b.y < d.y + d.height - 80);
  return onScreen ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : { width: Math.round(b.width), height: Math.round(b.height) };
}

/** Delay before restarting a crashed server: quick at first, then backing off; null means give up. */
export function restartDelay(recentCrashes) {
  const delays = [300, 1000, 3000];
  return recentCrashes < delays.length ? delays[recentCrashes] : null;
}
