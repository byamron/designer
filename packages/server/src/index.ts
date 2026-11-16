import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '@designer/shared';
import { claudeAdapter } from './claude.js';
import { fakeAdapter } from './fake.js';
import { Manager, type Client } from './manager.js';
import { listHtml, probe, startPreviewServer } from './preview.js';
import { Store } from './store.js';

const PORT = Number(process.env.PORT ?? 4317);
const HOST = '127.0.0.1';
const DATA = process.env.DESIGNER_DATA ?? join(homedir(), '.designer-chat');
const WEB_DIST = resolve(fileURLToPath(new URL('../../web/dist', import.meta.url)));
const DEV_PORT = 5173;
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? PORT + 1);

const store = new Store(DATA);
const manager = new Manager(store, process.env.DESIGNER_FAKE ? fakeAdapter : claudeAdapter, join(DATA, 'worktrees'));

// The server can run commands on this machine, so only the local UI may talk to it:
// check Host (DNS rebinding) and Origin (other web pages) on every request.
const okHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `localhost:${DEV_PORT}`, `127.0.0.1:${DEV_PORT}`]);
const okOrigins = new Set([...okHosts].map((h) => `http://${h}`));
const hostOk = (h?: string) => !!h && okHosts.has(h);

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

const http = createServer((req, res) => {
  if (!hostOk(req.headers.host)) return void res.writeHead(403).end('forbidden');
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) return void api(req, res, url);
  let file = normalize(join(WEB_DIST, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(WEB_DIST) || !existsSync(file) || !statSync(file).isFile()) file = join(WEB_DIST, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end('UI not built. Run `npm run build` (or `npm run dev` and open :5173).');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});

// Same-origin UI calls only: probe() fetches arbitrary URLs, so other web pages must not be able to trigger it.
async function api(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return void res.writeHead(403).end('forbidden');
  const json = (o: unknown, code = 200) => res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(o));
  if (url.pathname === '/api/probe') return json(await probe(url.searchParams.get('url') ?? ''));
  if (url.pathname === '/api/html') {
    const root = manager.workspacePath(url.searchParams.get('workspace') ?? '');
    return json(root ? listHtml(root) : []);
  }
  json({ error: 'not found' }, 404);
}

const wss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!hostOk(req.headers.host) || (origin && !okOrigins.has(origin)) || new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => connect(ws));
});

function connect(ws: WebSocket) {
  const client: Client = {
    subs: new Set(),
    send: (m: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)),
  };
  manager.addClient(client);
  client.send({ type: 'hello', defaultCwd: process.env.DESIGNER_CWD ?? process.cwd(), previewPort: PREVIEW_PORT });
  manager.handle(client, { type: 'list_workspaces' });
  client.send({ type: 'threads', threads: store.listThreads() });
  ws.on('message', (data) => {
    try {
      manager.handle(client, JSON.parse(String(data)) as ClientMsg);
    } catch (e) {
      client.send({ type: 'error', message: e instanceof Error ? e.message : 'bad message' });
    }
  });
  ws.on('close', () => manager.removeClient(client));
}

await startPreviewServer(PREVIEW_PORT, (id) => manager.workspacePath(id));
http.listen(PORT, HOST, () => console.log(`designer-chat on http://localhost:${PORT} (data: ${DATA})${process.env.DESIGNER_FAKE ? ' [fake provider]' : ''}`));
process.on('SIGINT', () => (manager.shutdown(), process.exit(0)));
process.on('SIGTERM', () => (manager.shutdown(), process.exit(0)));
