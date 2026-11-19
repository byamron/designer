// Images in chat: validation, storage, replay and the token-protected route.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import WebSocket from 'ws';
import type { ImageUpload, ServerMsg, StoredEvent } from '@designer/shared';
import { checkImages, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_WS_PAYLOAD, sniffImage } from './attachments.js';
import { userContent } from './claude.js';
import { fakeAdapter } from './fake.js';
import { Manager, type Client } from './manager.js';
import { Store } from './store.js';

const crc = (b: Buffer) => {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** A real, decodable PNG: a solid colour square. */
export function png(rgb: [number, number, number] = [255, 0, 0], size = 8): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30), Buffer.from([0xff, 0xd9])]);
const gif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0]), Buffer.from([0x3b])]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
const up = (b: Buffer, mime: string): ImageUpload => ({ mime, data: b.toString('base64') });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('magic bytes: png, jpeg, gif and webp are accepted', () => {
  assert.equal(sniffImage(png()), 'image/png');
  assert.equal(sniffImage(jpeg()), 'image/jpeg');
  assert.equal(sniffImage(gif()), 'image/gif');
  assert.equal(sniffImage(webp()), 'image/webp');
});

test('magic bytes: svg, html renamed .png, truncated and empty files are refused', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = Buffer.from('<!doctype html><script>alert(1)</script>');
  for (const [name, b] of [['svg', svg], ['html', html], ['png cut off', png().subarray(0, 20)], ['png signature only', png().subarray(0, 8)], ['gif cut off', gif().subarray(0, 8)], ['webp cut off', webp().subarray(0, 14)], ['empty', Buffer.alloc(0)], ['pdf', Buffer.from('%PDF-1.7 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')]] as const) {
    assert.equal(sniffImage(b), undefined, name);
    assert.throws(() => checkImages([up(b, 'image/png')]), /not a PNG, JPEG, GIF or WebP/, name);
  }
  assert.throws(() => checkImages([up(svg, 'image/svg+xml')]), /not a PNG/);
});

test('the declared type must agree with the bytes', () => {
  assert.throws(() => checkImages([up(png(), 'image/jpeg')]), /not a PNG/);
  assert.throws(() => checkImages([up(png(), 'text/html')]), /not a PNG/);
});

test('limits: at most 5 images, each at most 5 MB, with plain messages', () => {
  const one = up(png(), 'image/png');
  assert.equal(checkImages(Array(MAX_IMAGES).fill(one)).length, MAX_IMAGES);
  assert.throws(() => checkImages(Array(MAX_IMAGES + 1).fill(one)), /up to 5 images/);
  const body = (n: number) => Buffer.concat([png(), Buffer.alloc(n - png().length)]);
  assert.equal(checkImages([up(body(MAX_IMAGE_BYTES), 'image/png')]).length, 1);
  assert.throws(() => checkImages([up(body(MAX_IMAGE_BYTES + 1), 'image/png')]), /larger than 5 MB/);
  assert.throws(() => checkImages([{ mime: 'image/png', data: 'A'.repeat(MAX_IMAGE_BYTES * 2) }]), /larger than 5 MB/);
  assert.throws(() => checkImages([{ mime: 1, data: 2 } as any]), /not sent correctly/);
  assert.deepEqual(checkImages(undefined), []);
});

test('the WebSocket limit fits 5 images of 5 MB as base64 and is not unbounded', () => {
  assert.ok(MAX_WS_PAYLOAD >= Math.ceil((MAX_IMAGES * MAX_IMAGE_BYTES * 4) / 3));
  assert.ok(MAX_WS_PAYLOAD < 64 * 1024 * 1024);
});

test('ids are the content hash: same bytes, same id; different bytes, different id', () => {
  const [a, b, c] = checkImages([up(png(), 'image/png'), up(png(), 'image/png'), up(png([0, 0, 255]), 'image/png')]);
  assert.equal(a.id, sha(png()));
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.match(a.id, /^[0-9a-f]{64}$/);
});

const tmp = () => mkdtempSync(join(tmpdir(), 'att-'));
const until = async (f: () => boolean) => {
  for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(f(), 'timed out');
};
function harness() {
  const store = new Store(tmp());
  const mgr = new Manager(store, fakeAdapter, join(tmp(), 'worktrees'));
  const msgs: ServerMsg[] = [];
  const c: Client = { subs: new Set(), send: (m) => void msgs.push(m) };
  mgr.addClient(c);
  return { store, mgr, msgs, c };
}
async function thread(h: ReturnType<typeof harness>) {
  h.mgr.handle(h.c, { type: 'add_folder', path: tmpdir() });
  await until(() => h.msgs.some((m) => m.type === 'thread_updated'));
  const t = (h.msgs.find((m) => m.type === 'thread_updated') as any).thread;
  h.mgr.handle(h.c, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  return t.id as string;
}

test('stored owner-only under the thread, once per hash; the path is built from hashes only', async () => {
  const h = harness();
  const id = await thread(h);
  const red = png();
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: 'look', images: [up(red, 'image/png'), up(red, 'image/png')] });
  await until(() => h.store.readEvents(id).some((e) => e.type === 'turn_done'));
  const dir = join((h.store as any).root, 'threads', id, 'attachments');
  assert.deepEqual(readdirSync(dir), [`${sha(red)}.png`]);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, `${sha(red)}.png`)).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(join(dir, `${sha(red)}.png`)), red);
});

test('path traversal through ids or thread ids reads nothing', async () => {
  const h = harness();
  const id = await thread(h);
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: 'x', images: [up(png(), 'image/png')] });
  await until(() => h.store.readEvents(id).some((e) => e.type === 'turn_done'));
  const good = sha(png());
  assert.ok(h.store.readAttachment(id, good));
  for (const bad of ['../meta.json', `../${good}`, `${good}/../${good}`, `${good}.png`, good.toUpperCase(), good.slice(1), '', '..', '/etc/passwd', `${good}\0`]) {
    assert.equal(h.store.readAttachment(id, bad), undefined, JSON.stringify(bad));
  }
  for (const bad of ['..', '../x', 'a/b', '', 'a b']) assert.equal(h.store.readAttachment(bad, good), undefined, JSON.stringify(bad));
  assert.throws(() => h.store.saveAttachment(id, '../evil', 'image/png', png()));
  assert.throws(() => h.store.saveAttachment(id, good, 'image/svg+xml', png()));
});

test('manager: text + 2 images persist with ids, the provider sees them, replay returns them', async () => {
  const h = harness();
  const id = await thread(h);
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: 'two pics', images: [up(png(), 'image/png'), up(png([0, 255, 0]), 'image/png')] });
  await until(() => h.store.readEvents(id).some((e) => e.type === 'turn_done'));
  const events = h.store.readEvents(id);
  const user = events[0] as Extract<StoredEvent, { type: 'user_message' }>;
  assert.equal(user.text, 'two pics');
  assert.deepEqual(user.images, [{ id: sha(png()), mime: 'image/png' }, { id: sha(png([0, 255, 0])), mime: 'image/png' }]);
  assert.match((events.find((e) => e.type === 'assistant_message') as any).text, /Got 2 images/);
  assert.ok(!JSON.stringify(events).includes(png().toString('base64')), 'bytes are never written to the event log');
  const late: ServerMsg[] = [];
  h.mgr.handle({ subs: new Set(), send: (m) => void late.push(m) }, { type: 'subscribe', threadId: id, lastSeq: 0 });
  const replayed = late.find((m) => m.type === 'event' && m.event.type === 'user_message') as any;
  assert.equal(replayed.event.images.length, 2);
  assert.ok(h.store.readAttachment(id, replayed.event.images[0].id));
});

test('manager: an image-only message is allowed; nothing at all is not', async () => {
  const h = harness();
  const id = await thread(h);
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: '', images: [] });
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: '  ' });
  assert.equal(h.store.readEvents(id).length, 0);
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: '', images: [up(png(), 'image/png')] });
  await until(() => h.store.readEvents(id).some((e) => e.type === 'turn_done'));
  assert.equal(h.store.readMeta(id)!.title, 'Image');
});

test('manager: a refused image tells the sender and starts no turn', async () => {
  const h = harness();
  const id = await thread(h);
  h.mgr.handle(h.c, { type: 'send', threadId: id, text: 'hi', images: [up(Buffer.from('<svg/>'), 'image/png')] });
  const err = h.msgs.find((m) => m.type === 'error') as any;
  assert.match(err.message, /not a PNG, JPEG, GIF or WebP/);
  assert.equal(h.store.readEvents(id).length, 0);
  assert.equal(h.store.readMeta(id)!.status, 'idle');
  assert.equal(h.store.readMeta(id)!.title, 'New chat');
});

test('claude: message content is plain text without images, text block + image blocks with them', () => {
  assert.equal(userContent('hi', []), 'hi');
  const r = png();
  assert.deepEqual(userContent('what colour?', [up(r, 'image/png')]), [
    { type: 'text', text: 'what colour?' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: r.toString('base64') } },
  ]);
  assert.deepEqual((userContent('  ', [up(r, 'image/png')]) as { type: string }[]).map((b) => b.type), ['image']);
});

// ---- the real server: token, headers, 404s ----
let child: ChildProcess;
let port = 0;
let data = '';
let token = '';
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
async function freePort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    const ok = await Promise.all([p, p + 1].map((q) => new Promise<boolean>((res) => {
      const s = createServer().once('error', () => res(false)).listen(q, '127.0.0.1', () => s.close(() => res(true)));
    })));
    if (ok.every(Boolean)) return p;
  }
  throw new Error('no free port');
}
before(async () => {
  port = await freePort();
  data = mkdtempSync(join(tmpdir(), 'attsrv-'));
  mkdirSync(join(data, 'x'));
  child = spawn(tsx, ['src/index.ts'], { cwd, env: { ...process.env, PORT: String(port), DESIGNER_DATA: data, DESIGNER_FAKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 15000);
    child.stdout!.on('data', (d) => /Open this link/.test(String(d)) && (clearTimeout(t), res()));
    child.on('exit', () => rej(new Error('server exited')));
  });
  token = readFileSync(join(data, 'token'), 'utf8').trim();
});
after(() => {
  try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already gone */ }
});
function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, any>; body: Buffer }> {
  return new Promise((res, rej) => {
    request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (r) => {
      const parts: Buffer[] = [];
      r.on('data', (c) => parts.push(c));
      r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(parts) }));
    }).on('error', rej).end();
  });
}

test('route: send over the real WebSocket, then fetch with the token; headers are locked down', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`);
  const got: ServerMsg[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once('open', r));
  const waitFor = async (f: () => boolean) => { for (let i = 0; i < 400 && !f(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(f(), 'timed out'); };
  ws.send(JSON.stringify({ type: 'add_folder', path: tmpdir() }));
  await waitFor(() => got.some((m) => m.type === 'thread_updated'));
  const t = (got.find((m) => m.type === 'thread_updated') as any).thread;
  ws.send(JSON.stringify({ type: 'subscribe', threadId: t.id, lastSeq: 0 }));
  // five 5 MB images fit through the socket
  const big = Buffer.concat([png(), Buffer.alloc(MAX_IMAGE_BYTES - png().length)]);
  const imgs = Array.from({ length: 5 }, (_, i) => { const b = Buffer.from(big); b[b.length - 1] = i + 1; return up(b, 'image/png'); });
  ws.send(JSON.stringify({ type: 'send', threadId: t.id, text: 'five big ones', images: imgs }));
  await waitFor(() => got.some((m) => m.type === 'event' && m.event.type === 'turn_done'));
  const ev = (got.find((m) => m.type === 'event' && m.event.type === 'user_message') as any).event;
  assert.equal(ev.images.length, 5);
  ws.close();

  const url = `/api/attachment/${t.id}/${ev.images[0].id}`;
  assert.equal((await get(url)).status, 401, 'no token');
  assert.equal((await get(url, { 'x-designer-token': 'f'.repeat(64) })).status, 401, 'wrong token');
  assert.equal((await get(url, { 'x-designer-token': token, 'sec-fetch-site': 'cross-site' })).status, 403, 'other sites');
  assert.equal((await get(url, { 'x-designer-token': token, host: 'evil.example' })).status, 403, 'rebinding');
  const ok = await get(url, { 'x-designer-token': token, 'sec-fetch-site': 'same-origin' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.equal(ok.headers['content-security-policy'], 'sandbox');
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.equal(ok.body.length, MAX_IMAGE_BYTES);

  const h = { 'x-designer-token': token };
  assert.equal((await get(`/api/attachment/${t.id}/${'0'.repeat(64)}`, h)).status, 404, 'unknown id');
  assert.equal((await get(`/api/attachment/nope/${ev.images[0].id}`, h)).status, 404, 'wrong thread');
  assert.equal((await get(`/api/attachment/${t.id}/..%2Fmeta.json`, h)).status, 404, 'traversal');
  assert.equal((await get(`/api/attachment/..%2F${t.id}/${ev.images[0].id}`, h)).status, 404, 'traversal in thread');
  assert.equal((await get(`/api/attachment/${t.id}/${ev.images[0].id}/x`, h)).status, 404, 'extra segment');
});

test('route: a message above the socket limit closes the connection', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`);
  await new Promise((r) => ws.once('open', r));
  const closed = new Promise<number>((r) => ws.once('close', r));
  ws.send(JSON.stringify({ type: 'list_threads', pad: 'x'.repeat(MAX_WS_PAYLOAD + 1) }));
  assert.equal(await closed, 1009);
});
