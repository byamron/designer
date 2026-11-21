import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { AGENT_PATH, agentSource, injectAgent } from './agent.js';

/**
 * A local pass-through proxy for ONE target origin, so a page we do not serve (a dev server, a website)
 * can be shown with the Designer agent injected. Each target gets its own port, which is its own
 * browser origin (cookies and storage do not mix between targets).
 *
 * Deliberate changes to what the page receives: the Designer agent is added to HTML, and
 * X-Frame-Options / Content-Security-Policy are dropped so the page can be framed and the agent can run.
 * WebSocket upgrades are tunnelled so dev-server hot reload keeps working.
 */
export interface Proxy {
  port: number;
  target: URL;
  close(): void;
}

const MAX_HTML = 20 << 20;

export function startProxy(target: URL, appOrigins: () => string[]): Promise<Proxy> {
  const isHttps = target.protocol === 'https:';
  const targetPort = Number(target.port) || (isHttps ? 443 : 80);
  const client = isHttps ? https : http;
  let proxyOrigin = '';

  const outHeaders = (h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders => {
    const o: http.OutgoingHttpHeaders = { ...h, host: target.host };
    if (typeof h.origin === 'string') o.origin = target.origin;
    if (typeof h.referer === 'string') o.referer = h.referer.split(proxyOrigin).join(target.origin);
    delete o['if-none-match'];
    delete o['if-modified-since'];
    delete o['accept-encoding']; // ask for plain bodies so HTML can be edited
    return o;
  };

  const server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (!req.headers.host || ![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return void res.writeHead(403).end('forbidden');
    if (req.url === AGENT_PATH) return void res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(agentSource());

    const up = client.request({ hostname: target.hostname, port: targetPort, path: req.url, method: req.method, headers: outHeaders(req.headers) }, (ures) => {
      const h: http.OutgoingHttpHeaders = { ...ures.headers };
      delete h['x-frame-options'];
      delete h['content-security-policy'];
      delete h['content-security-policy-report-only'];
      if (typeof h.location === 'string') h.location = h.location.split(target.origin).join(proxyOrigin);
      if (Array.isArray(h['set-cookie'])) {
        // the page is on http://localhost here, so Secure/Domain would make the browser drop the cookie
        h['set-cookie'] = h['set-cookie'].map((c) => c.replace(/;\s*domain=[^;]*/i, '').replace(/;\s*secure/i, '').replace(/;\s*samesite=none/i, '; SameSite=Lax'));
      }
      const isHtml = /text\/html/i.test(String(ures.headers['content-type'] ?? ''));
      if (!isHtml) {
        res.writeHead(ures.statusCode ?? 502, h);
        ures.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      ures.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_HTML) chunks.push(c);
      });
      ures.on('end', () => {
        const body = Buffer.from(injectAgent(Buffer.concat(chunks).toString('utf8'), appOrigins()), 'utf8');
        delete h['content-length'];
        delete h['content-encoding'];
        delete h['transfer-encoding'];
        h['content-length'] = body.length;
        h['cache-control'] = 'no-store';
        res.writeHead(ures.statusCode ?? 200, h).end(body);
      });
    });
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Designer proxy could not reach ${target.origin}: ${e.message}`);
    });
    req.pipe(up);
  });

  // WebSocket (dev-server hot reload): replay the handshake to the target and pipe both ways.
  server.on('upgrade', (req, clientSocket, head) => {
    const port = (server.address() as AddressInfo).port;
    if (!req.headers.host || ![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return void clientSocket.destroy();
    const onConnect = (upstream: net.Socket) => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      const h = outHeaders(req.headers);
      for (const [k, v] of Object.entries(h)) for (const val of Array.isArray(v) ? v : [v]) if (val !== undefined) lines.push(`${k}: ${val}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    };
    const upstream = isHttps ? tls.connect({ host: target.hostname, port: targetPort, servername: target.hostname }, () => onConnect(upstream)) : net.connect(targetPort, target.hostname, () => onConnect(upstream));
    upstream.on('error', () => clientSocket.destroy());
  });

  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      proxyOrigin = `http://localhost:${port}`;
      ok({ port, target, close: () => (server.closeAllConnections(), server.close()) });
    });
  });
}

/** Hosts that mean "this machine" (including the spellings that all reach a loopback listener). */
function isThisMachine(h: string): boolean {
  const host = h.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::' || host === '::1' || /^127(\.\d+){0,3}$/.test(host);
}

/** One proxy per target origin, created on demand; the oldest is closed past a small cap. */
export class ProxyPool {
  private proxies = new Map<string, Promise<Proxy>>();
  /**
   * `reservedPorts`: other Designer ports on this machine (the preview server). Together with the app origins they can
   * never be a target: a proxy rewrites Host and Origin to the target's own, so proxying Designer would hand a page the
   * very headers the app's Host and Origin checks trust.
   */
  constructor(private appOrigins: () => string[], private max = 8, private reservedPorts: () => number[] = () => []) {}
  private isSelf(url: URL): boolean {
    if (!isThisMachine(url.hostname)) return false;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    return this.reservedPorts().includes(port) || this.appOrigins().some((o) => Number(new URL(o).port) === port);
  }
  async get(url: URL): Promise<Proxy> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https pages can be inspected.');
    if (this.isSelf(url)) throw new Error('Designer itself cannot be inspected through its own proxy.');
    let p = this.proxies.get(url.origin);
    if (!p) {
      p = startProxy(new URL(url.origin), this.appOrigins);
      this.proxies.set(url.origin, p);
      p.catch(() => this.proxies.delete(url.origin));
      if (this.proxies.size > this.max) {
        const oldest = this.proxies.keys().next().value as string;
        void this.proxies.get(oldest)?.then((x) => x.close());
        this.proxies.delete(oldest);
      }
    }
    return p;
  }
  closeAll() {
    for (const p of this.proxies.values()) void p.then((x) => x.close()).catch(() => {});
    this.proxies.clear();
  }
}
