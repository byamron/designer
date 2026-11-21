// Adding a folder is validated by the server, the same for a typed path and for one chosen in the desktop app's folder dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMsg } from '@designer/shared';
import { Store } from './store.js';
import { Manager, type Client } from './manager.js';
import { fakeAdapter } from './fake.js';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'fa-')));
function harness() {
  const mgr = new Manager(new Store(tmp()), fakeAdapter, join(tmp(), 'worktrees'));
  const msgs: ServerMsg[] = [];
  const c: Client = { subs: new Set(), send: (m) => void msgs.push(m) };
  mgr.addClient(c);
  return { mgr, msgs, c };
}
const settle = () => new Promise((r) => setTimeout(r, 400));

test('add folder: a missing path and a file are refused with the same plain error; nothing is added', async () => {
  const h = harness();
  const file = join(tmp(), 'a.txt');
  writeFileSync(file, 'x');
  for (const bad of ['/definitely/not/here', file]) h.mgr.handle(h.c, { type: 'add_folder', path: bad });
  await settle();
  assert.deepEqual(h.msgs.filter((m) => m.type === 'error').map((m: any) => m.message), ['Folder not found: /definitely/not/here', `Folder not found: ${file}`]);
  assert.equal(h.msgs.filter((m) => m.type === 'workspace_updated').length, 0);
});

test('add folder: inside a git repo the repo root is used; no notice', async () => {
  const h = harness();
  const repo = tmp();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  mkdirSync(join(repo, 'sub'));
  h.mgr.handle(h.c, { type: 'add_folder', path: join(repo, 'sub') });
  await settle();
  const w = (h.msgs.find((m) => m.type === 'workspace_updated') as any).workspace;
  assert.equal(w.path, repo);
  assert.equal(h.msgs.filter((m) => m.type === 'notice' || m.type === 'error').length, 0);
});

test('add folder: a plain folder is still added, with a plain notice that it is not a git repository', async () => {
  const h = harness();
  const dir = tmp();
  h.mgr.handle(h.c, { type: 'add_folder', path: dir });
  await settle();
  assert.equal((h.msgs.find((m) => m.type === 'workspace_updated') as any).workspace.path, dir, 'added, as before');
  const notice = h.msgs.find((m) => m.type === 'notice') as any;
  assert.match(notice.message, /not a git repository/);
  assert.ok(notice.message.includes(dir));
  assert.equal(h.msgs.filter((m) => m.type === 'error').length, 0, 'not an error: nothing was refused');
});
