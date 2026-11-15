import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMsg } from '@designer/shared';
import { Store } from './store.js';
import { Manager, type Client } from './manager.js';
import { fakeAdapter } from './fake.js';
import { cleanEnv, describeTool } from './claude.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'dc-'));

test('cleanEnv strips API-key vars so the subscription login wins', () => {
  const e = cleanEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' });
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(e.PATH, '/bin');
});

test('describeTool gives short labels', () => {
  assert.equal(describeTool('Bash', { command: 'ls\nrm x' }), 'ls');
  assert.equal(describeTool('Read', { file_path: 'a.ts' }), 'a.ts');
});

test('store assigns increasing seq, replays after a cursor, survives a torn last line', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.writeMeta({ id: 't1', title: 'x', cwd: '/', provider: 'claude', status: 'idle', createdAt: 1, updatedAt: 1 });
  s.append('t1', { type: 'user_message', text: 'a' });
  s.append('t1', { type: 'user_message', text: 'b' });
  appendFileSync(join(dir, 'threads', 't1', 'events.jsonl'), '{"type":"user_mes');
  const s2 = new Store(dir); // fresh process
  assert.deepEqual(s2.readEvents('t1').map((e) => e.seq), [1, 2]);
  assert.deepEqual(s2.readEvents('t1', 1).map((e) => e.seq), [2]);
  assert.equal(s2.append('t1', { type: 'user_message', text: 'c' }).seq, 3);
});

test('store rejects path-like thread ids', () => {
  assert.throws(() => new Store(tmp()).readEvents('../x'));
});

function harness() {
  const store = new Store(tmp());
  const mgr = new Manager(store, fakeAdapter);
  const msgs: ServerMsg[] = [];
  const c: Client = { subs: new Set(), send: (m) => void msgs.push(m) };
  mgr.addClient(c);
  return { store, mgr, msgs, c };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(f(), 'timed out');
};

test('manager: create, send, stream, persist, replay on resubscribe', async () => {
  const { mgr, msgs, c, store } = harness();
  mgr.handle(c, { type: 'create_thread', cwd: tmpdir() });
  const t = (msgs.find((m) => m.type === 'thread_updated') as any).thread;
  mgr.handle(c, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  mgr.handle(c, { type: 'send', threadId: t.id, text: 'hello' });
  await until(() => msgs.some((m) => m.type === 'event' && m.event.type === 'turn_done'));
  assert.ok(msgs.some((m) => m.type === 'delta'));
  const types = store.readEvents(t.id).map((e) => e.type);
  assert.deepEqual(types, ['user_message', 'assistant_message', 'turn_done']);
  assert.equal(store.readMeta(t.id)!.title, 'hello');
  await until(() => store.readMeta(t.id)!.status === 'idle');
  // a reconnecting client with lastSeq=1 only gets what it missed
  const late: ServerMsg[] = [];
  mgr.handle({ subs: new Set(), send: (m) => void late.push(m) }, { type: 'subscribe', threadId: t.id, lastSeq: 1 });
  assert.deepEqual(late.filter((m) => m.type === 'event').map((m: any) => m.event.seq), [2, 3]);
});

test('manager: approval round trip and rejects bad folder', async () => {
  const { mgr, msgs, c, store } = harness();
  mgr.handle(c, { type: 'create_thread', cwd: '/definitely/not/here' });
  assert.ok(msgs.some((m) => m.type === 'error'));
  mgr.handle(c, { type: 'create_thread', cwd: tmpdir() });
  const t = (msgs.find((m) => m.type === 'thread_updated') as any).thread;
  mgr.handle(c, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  mgr.handle(c, { type: 'send', threadId: t.id, text: 'approve please' });
  await until(() => msgs.some((m) => m.type === 'event' && m.event.type === 'approval_request'));
  const req = msgs.find((m) => m.type === 'event' && m.event.type === 'approval_request') as any;
  mgr.handle(c, { type: 'respond', threadId: t.id, requestId: req.event.requestId, decision: 'allow' });
  await until(() => store.readEvents(t.id).some((e) => e.type === 'turn_done'));
  assert.ok(store.readEvents(t.id).some((e) => e.type === 'approval_resolved' && e.decision === 'allow'));
});

test('manager: second send while running is refused', async () => {
  const { mgr, msgs, c } = harness();
  mgr.handle(c, { type: 'create_thread', cwd: tmpdir() });
  const t = (msgs.find((m) => m.type === 'thread_updated') as any).thread;
  mgr.handle(c, { type: 'send', threadId: t.id, text: 'long' });
  await new Promise((r) => setTimeout(r, 20));
  mgr.handle(c, { type: 'send', threadId: t.id, text: 'again' });
  await until(() => msgs.some((m) => m.type === 'error'));
  mgr.shutdown();
});
