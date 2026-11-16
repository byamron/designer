import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
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
  s.writeMeta({ id: 't1', workspaceId: 'w', title: 'x', cwd: '/', provider: 'claude', status: 'idle', createdAt: 1, updatedAt: 1 });
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
  const mgr = new Manager(store, fakeAdapter, join(tmp(), 'worktrees'));
  const msgs: ServerMsg[] = [];
  const c: Client = { subs: new Set(), send: (m) => void msgs.push(m) };
  mgr.addClient(c);
  return { store, mgr, msgs, c };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(f(), 'timed out');
};
/** Add a plain folder as a workspace; returns its first thread. */
async function openFolder(h: ReturnType<typeof harness>, path = tmpdir()) {
  h.mgr.handle(h.c, { type: 'add_folder', path });
  await until(() => h.msgs.some((m) => m.type === 'thread_updated'));
  return (h.msgs.find((m) => m.type === 'thread_updated') as any).thread as import('@designer/shared').ThreadMeta;
}
function gitRepo() {
  const dir = tmp();
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  g('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  g('add', '.');
  g('commit', '-qm', 'init');
  return { dir: realpathSync(dir), g };
}

test('manager: add folder, send, stream, persist, replay on resubscribe', async () => {
  const h = harness();
  const { mgr, msgs, c, store } = h;
  const t = await openFolder(h);
  mgr.handle(c, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  mgr.handle(c, { type: 'send', threadId: t.id, text: 'hello' });
  await until(() => msgs.some((m) => m.type === 'event' && m.event.type === 'turn_done'));
  assert.ok(msgs.some((m) => m.type === 'delta'));
  assert.deepEqual(store.readEvents(t.id).map((e) => e.type), ['user_message', 'assistant_message', 'turn_done']);
  assert.equal(store.readMeta(t.id)!.title, 'hello');
  await until(() => store.readMeta(t.id)!.status === 'idle');
  const late: ServerMsg[] = [];
  mgr.handle({ subs: new Set(), send: (m) => void late.push(m) }, { type: 'subscribe', threadId: t.id, lastSeq: 1 });
  assert.deepEqual(late.filter((m) => m.type === 'event').map((m: any) => m.event.seq), [2, 3]);
});

test('manager: approval round trip; bad folder is an error', async () => {
  const h = harness();
  const { mgr, msgs, c, store } = h;
  mgr.handle(c, { type: 'add_folder', path: '/definitely/not/here' });
  await until(() => msgs.some((m) => m.type === 'error'));
  const t = await openFolder(h);
  mgr.handle(c, { type: 'subscribe', threadId: t.id, lastSeq: 0 });
  mgr.handle(c, { type: 'send', threadId: t.id, text: 'approve please' });
  await until(() => msgs.some((m) => m.type === 'event' && m.event.type === 'approval_request'));
  const req = msgs.find((m) => m.type === 'event' && m.event.type === 'approval_request') as any;
  mgr.handle(c, { type: 'respond', threadId: t.id, requestId: req.event.requestId, decision: 'allow' });
  await until(() => store.readEvents(t.id).some((e) => e.type === 'turn_done'));
  assert.ok(store.readEvents(t.id).some((e) => e.type === 'approval_resolved' && e.decision === 'allow'));
});

test('manager: second send while running is refused', async () => {
  const h = harness();
  const t = await openFolder(h);
  h.mgr.handle(h.c, { type: 'send', threadId: t.id, text: 'long' });
  await new Promise((r) => setTimeout(r, 20));
  h.mgr.handle(h.c, { type: 'send', threadId: t.id, text: 'again' });
  await until(() => h.msgs.some((m) => m.type === 'error'));
  h.mgr.shutdown();
});

test('workspaces: several sessions per workspace; archive hides one', async () => {
  const h = harness();
  const t1 = await openFolder(h);
  h.mgr.handle(h.c, { type: 'create_thread', workspaceId: t1.workspaceId });
  await until(() => h.msgs.filter((m) => m.type === 'thread_updated').length === 2);
  const live = () => h.store.listThreads().filter((t) => t.workspaceId === t1.workspaceId && !t.archived);
  assert.equal(live().length, 2);
  h.mgr.handle(h.c, { type: 'archive_thread', threadId: t1.id });
  assert.equal(live().length, 1);
});

test('worktrees: create from a repo, session runs in it, dirty removal is refused, clean removal works', async () => {
  const h = harness();
  const { dir } = gitRepo();
  const t = await openFolder(h, dir);
  assert.equal(t.cwd, dir);
  h.mgr.handle(h.c, { type: 'create_worktree', fromWorkspaceId: t.workspaceId, name: 'try-1' });
  await until(() => h.msgs.filter((m) => m.type === 'thread_updated').length === 2);
  const ws = h.store.listWorkspaces().find((w) => w.kind === 'worktree')!;
  assert.equal(ws.branch, 'designer/try-1');
  assert.ok(existsSync(join(ws.path, 'a.txt')));
  const wt = h.store.listThreads().find((x) => x.workspaceId === ws.id)!;
  assert.equal(wt.cwd, ws.path);
  assert.equal(execFileSync('git', ['-C', ws.path, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim(), 'designer/try-1');
  // uncommitted work is never destroyed
  writeFileSync(join(ws.path, 'wip.txt'), 'x');
  h.msgs.length = 0;
  h.mgr.handle(h.c, { type: 'remove_workspace', workspaceId: ws.id });
  await until(() => h.msgs.some((m) => m.type === 'error'));
  assert.ok(existsSync(join(ws.path, 'wip.txt')));
  assert.equal(h.store.listWorkspaces().some((w) => w.id === ws.id), true);
  // once clean (commit it), removal succeeds
  execFileSync('git', ['-C', ws.path, 'add', '.']);
  execFileSync('git', ['-C', ws.path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'wip']);
  h.mgr.handle(h.c, { type: 'remove_workspace', workspaceId: ws.id });
  await until(() => h.msgs.some((m) => m.type === 'workspace_removed'));
  assert.equal(existsSync(ws.path), false);
});

test('worktrees: rejects non-repo folders, bad names, duplicate names', async () => {
  const h = harness();
  const t = await openFolder(h, tmp());
  h.mgr.handle(h.c, { type: 'create_worktree', fromWorkspaceId: t.workspaceId, name: 'x' });
  await until(() => h.msgs.some((m) => m.type === 'error' && /not a git repository/.test(m.message)));
  const { dir } = gitRepo();
  const h2 = harness();
  const t2 = await openFolder(h2, dir);
  h2.mgr.handle(h2.c, { type: 'create_worktree', fromWorkspaceId: t2.workspaceId, name: '../evil' });
  await until(() => h2.msgs.some((m) => m.type === 'error'));
  h2.msgs.length = 0;
  h2.mgr.handle(h2.c, { type: 'create_worktree', fromWorkspaceId: t2.workspaceId, name: 'ok' });
  await until(() => h2.msgs.some((m) => m.type === 'workspace_updated'));
  h2.mgr.handle(h2.c, { type: 'create_worktree', fromWorkspaceId: t2.workspaceId, name: 'ok' });
  await until(() => h2.msgs.some((m) => m.type === 'error' && /already exists/.test(m.message)));
});

test('legacy threads without a workspace are grouped by folder on startup', () => {
  const store = new Store(tmp());
  store.writeMeta({ id: 'old', title: 'x', cwd: tmpdir(), provider: 'claude', status: 'running', createdAt: 1, updatedAt: 1 } as any);
  new Manager(store, fakeAdapter, join(tmp(), 'wt'));
  const t = store.readMeta('old')!;
  assert.ok(t.workspaceId);
  assert.equal(t.status, 'idle');
  assert.equal(store.listWorkspaces()[0].path, tmpdir());
});
