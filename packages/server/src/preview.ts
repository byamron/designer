import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { AGENT_PATH, agentSource, injectAgent } from './agent.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

/** Resolve a request path inside a workspace root, refusing anything that escapes it (.., symlinks). */
export function resolveInside(root: string, rel: string): string | undefined {
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return undefined;
  }
  let target = resolve(real, '.' + sep + decodeURIComponent(rel));
  try {
    if (statSync(target).isDirectory()) target = join(target, 'index.html');
    target = realpathSync(target);
  } catch {
    return undefined;
  }
  const r = relative(real, target);
  if (r.startsWith('..') || resolve(real, r) !== target) return undefined;
  return statSync(target).isFile() ? target : undefined;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'target']);

/** HTML files in a workspace (shallow, bounded) to suggest in the preview bar. */
export function listHtml(root: string, maxDepth = 3, limit = 200): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) depth < maxDepth && walk(p, depth + 1);
      else if (/\.html?$/i.test(e.name)) out.push(relative(root, p));
    }
  };
  walk(root, 0);
  return out.sort();
}

/**
 * Serves workspace files on their own port. A different origin from the app means a page the agent
 * wrote cannot reach the app's WebSocket (the app only accepts its own origin), so previewed code
 * cannot drive the agent.
 */
export function startPreviewServer(port: number, workspacePath: (id: string) => string | undefined, appOrigins: () => string[] = () => []): Promise<Server> {
  const server = createServer((req, res) => {
    const actual = (server.address() as { port: number } | null)?.port;
    if (!req.headers.host || ![`localhost:${actual}`, `127.0.0.1:${actual}`].includes(req.headers.host)) return void res.writeHead(403).end('forbidden');
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === AGENT_PATH) return void res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(agentSource());
    const m = /^\/([\w-]+)\/(.*)$/.exec(url.pathname) ?? /^\/([\w-]+)$/.exec(url.pathname);
    const root = m && workspacePath(m[1]);
    if (!m || !root) return void res.writeHead(404).end('not found');
    let file: string | undefined;
    try {
      file = resolveInside(root, m[2] ?? '');
    } catch {
      file = undefined;
    }
    if (!file || !existsSync(file)) return void res.writeHead(404).end('not found');
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (/^\.html?$/i.test(extname(file))) {
      // HTML gets the Designer page agent (inert unless the Designer app talks to it)
      const body = Buffer.from(injectAgent(readFileSync(file, 'utf8'), appOrigins()), 'utf8');
      return void res.writeHead(200, { ...headers, 'content-length': body.length }).end(body);
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

export interface Probe {
  ok: boolean;
  framable: boolean;
  reason?: string;
}

/** Can this URL be shown in an iframe? Honest answer instead of a blank pane. */
/** Does a CSP frame-ancestors list allow `parent` (the app that wants to show the page) to frame a page at `target`? */
export function ancestorsAllow(list: string, parent: string | undefined, target: URL): boolean {
  const tokens = list.trim().split(/\s+/).filter(Boolean);
  if (tokens.includes("'none'")) return false;
  if (tokens.includes('*')) return true;
  if (tokens.includes("'self'") && parent === target.origin) return true;
  return !!parent && tokens.includes(parent);
}

export async function probe(raw: string, parent?: string): Promise<Probe> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, framable: false, reason: 'Not a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, framable: false, reason: 'Only http and https pages can be shown.' };
  try {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { accept: 'text/html' } });
    await r.body?.cancel();
    const xfo = (r.headers.get('x-frame-options') ?? '').toLowerCase();
    const csp = r.headers.get('content-security-policy') ?? '';
    const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim();
    if (xfo.includes('deny') || xfo.includes('sameorigin')) return { ok: true, framable: false, reason: 'This site does not allow being shown inside another page (X-Frame-Options).' };
    if (fa && !ancestorsAllow(fa, parent, u)) return { ok: true, framable: false, reason: 'This site does not allow being shown inside another page (frame-ancestors).' };
    return { ok: true, framable: true };
  } catch {
    return { ok: false, framable: false, reason: `Cannot reach ${u.origin}. Is the server running?` };
  }
}
