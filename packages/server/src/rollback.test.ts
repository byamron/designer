// Rolling back a bad update (packages/desktop/shim/rollback.cjs, updater.mjs). Real git repositories, npm stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const desktop = fileURLToPath(new URL('../../desktop/', import.meta.url));
const rb: any = createRequire(import.meta.url)(join(desktop, 'shim', 'rollback.cjs'));
const updater: any = await import(join(desktop, 'updater.mjs'));

const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd }).toString().trim();
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'rb-')));

/** origin (bare) + the installed copy on main + a clone that publishes commits. */
function fixture() {
  const base = tmp();
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  sh(origin, 'init', '-q', '--bare', '-b', 'main');
  const publisher = join(base, 'publisher');
  sh(base, 'clone', '-q', origin, publisher);
  writeFileSync(join(publisher, 'package.json'), '{"name":"designer"}');
  writeFileSync(join(publisher, 'a.txt'), '1');
  writeFileSync(join(publisher, '.gitignore'), 'node_modules/\n');
  sh(publisher, 'add', '.');
  sh(publisher, 'commit', '-qm', 'v1');
  sh(publisher, 'push', '-q', 'origin', 'HEAD:main');
  const root = join(base, 'installed');
  sh(base, 'clone', '-q', origin, root);
  const publish = (file: string, content: string, msg: string) => {
    writeFileSync(join(publisher, file), content);
    sh(publisher, 'add', '.');
    sh(publisher, 'commit', '-qm', msg);
    sh(publisher, 'push', '-q', 'origin', 'HEAD:main');
  };
  const userData = join(base, 'userdata');
  return { root, publish, publisher, userData, head: () => sh(root, 'rev-parse', 'HEAD') };
}
function stubbed(fail?: string, times = Infinity) {
  const calls: string[] = [];
  let failures = 0;
  const r = (cmd: string, args: string[], o: unknown) => {
    if (cmd !== 'npm') return updater.run(cmd, args, o);
    const line = args.join(' ');
    calls.push(line);
    return fail && line.startsWith(fail) && failures++ < times ? Promise.reject(Object.assign(new Error('boom'), { stderr: 'build exploded' })) : Promise.resolve('');
  };
  return { r, calls };
}
/** An update that really happened: v1 -> v2, recorded the way the app records it. */
async function updated(f: ReturnType<typeof fixture>, file = 'a.txt', content = '2') {
  const good = f.head();
  f.publish(file, content, 'v2: the bad one');
  const res = await updater.applyUpdate({ root: f.root, r: stubbed().r });
  assert.equal(res.ok, true);
  rb.recordUpdate(f.userData, { from: res.from, to: res.to, installed: res.installed, electron: res.electron });
  return { good, bad: f.head(), res };
}

test('an update leaves a record of the previous version, with what changed', async () => {
  const f = fixture();
  const { good, bad } = await updated(f);
  const rec = rb.readRecord(f.userData);
  assert.equal(rec.from, good);
  assert.equal(rec.to, bad);
  assert.equal(rec.installed, false);
  assert.equal(rec.healthy, false, 'unproven until the app has started on it');
  assert.ok(!Number.isNaN(Date.parse(rec.time)));
  // package files changed -> says so
  f.publish('package.json', '{"name":"designer","dependencies":{"x":"1"}}', 'v3: dependency');
  const res = await updater.applyUpdate({ root: f.root, r: stubbed().r });
  assert.equal(res.installed, true);
  rb.recordUpdate(f.userData, { from: res.from, to: res.to, installed: res.installed, electron: { from: '45.3.4', to: '45.4.1' } });
  assert.deepEqual([rb.readRecord(f.userData).installed, rb.readRecord(f.userData).electron], [true, { from: '45.3.4', to: '45.4.1' }]);
  // a damaged or foreign file is no record at all (it must never point git at an arbitrary string)
  for (const bad of ['{broken', '{"from":"main","to":"x"}', '{"from":"--hard","to":"' + 'a'.repeat(40) + '"}', '[]']) {
    writeFileSync(rb.recordFile(f.userData), bad);
    assert.equal(rb.readRecord(f.userData), undefined, bad);
  }
});

test('rollback: main goes back to the recorded commit, files and build follow, nothing else is touched', async () => {
  const f = fixture();
  const { good, bad } = await updated(f);
  // things a rollback must never touch: another branch, a worktree
  sh(f.root, 'branch', 'feature', good);
  const wt = join(tmp(), 'wt');
  sh(f.root, 'worktree', 'add', '-q', '-b', 'wt-branch', wt, good);
  writeFileSync(join(wt, 'work.txt'), 'unsaved work in a worktree');
  const branchesBefore = sh(f.root, 'branch', '--format=%(refname:short) %(objectname)');
  const s = stubbed();
  const res = await rb.rollbackToPrevious({ root: f.root, userData: f.userData, r: s.r });
  assert.equal(res.ok, true);
  assert.equal(res.installed, false);
  assert.deepEqual(s.calls, ['run build'], 'rebuilt the UI, did not reinstall');
  assert.equal(f.head(), good);
  assert.equal(sh(f.root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), '1');
  assert.equal(sh(f.root, 'status', '--porcelain'), '', 'a clean copy before, a clean copy after');
  assert.equal(readFileSync(join(wt, 'work.txt'), 'utf8'), 'unsaved work in a worktree');
  assert.equal(sh(f.root, 'branch', '--format=%(refname:short) %(objectname)').split('\n').filter((l) => !l.startsWith('main ')).join('\n'), branchesBefore.split('\n').filter((l) => !l.startsWith('main ')).join('\n'), 'other branches are exactly as they were');
  assert.equal(sh(f.root, 'rev-parse', 'origin/main'), bad, 'origin/main is untouched, so the next update can fast-forward again');
  assert.equal(sh(f.root, 'cat-file', '-t', bad), 'commit', 'the commit we left is still in the repository (reflog)');
  assert.equal(rb.readRecord(f.userData), undefined, 'the record is consumed: the previous version is now the current one');
  assert.equal(rb.readDismissed(f.userData), bad, 'the version we left is recorded as skipped');
  assert.match(readFileSync(join(f.userData, 'update.log'), 'utf8'), /rolled back/);
  // and the copy can go forward again with the normal update path
  const c = await updater.checkForUpdate({ root: f.root });
  assert.equal(c.canFastForward, true);
  assert.equal(c.behind, 1);
  assert.equal(updater.blocker(c), undefined);
});

test('rollback reinstalls dependencies only when package files differ', async () => {
  const f = fixture();
  const { good } = await updated(f, 'package.json', '{"name":"designer","dependencies":{"x":"1"}}');
  const s = stubbed();
  const res = await rb.rollbackToPrevious({ root: f.root, userData: f.userData, r: s.r });
  assert.equal(res.installed, true);
  assert.deepEqual(s.calls, ['install --no-audit --no-fund', 'run build']);
  assert.equal(f.head(), good);
});

test('rollback refuses, changing nothing, on a dirty, non-main, moved or unrelated copy', async () => {
  const f = fixture();
  const { good, bad } = await updated(f);
  const nothingChanged = async (why: RegExp) => {
    const s = stubbed();
    const res = await rb.applyRollback({ root: f.root, record: rb.readRecord(f.userData), r: s.r });
    assert.equal(res.ok, false);
    assert.match(res.error, why);
    assert.deepEqual(s.calls, [], 'no npm call');
  };
  // dirty (same message and rule as the updater's blocker)
  writeFileSync(join(f.root, 'a.txt'), 'edited by hand');
  await nothingChanged(/uncommitted changes/);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'edited by hand', 'the edit is still there');
  assert.equal(f.head(), bad);
  sh(f.root, 'checkout', '-q', '--', 'a.txt');
  // not on main
  sh(f.root, 'checkout', '-q', '-b', 'other');
  await nothingChanged(/not main/);
  sh(f.root, 'checkout', '-q', 'main');
  // the copy was moved by someone else after the update: the record no longer applies
  f.publish('b.txt', 'x', 'v3');
  sh(f.root, 'pull', '-q', '--ff-only');
  await nothingChanged(/no longer at the version/);
  // record pointing at something that is not an earlier version of this copy
  sh(f.root, 'checkout', '-q', '-b', 'side', good);
  writeFileSync(join(f.root, 'side.txt'), 's');
  sh(f.root, 'add', '.');
  sh(f.root, 'commit', '-qm', 'side');
  const side = sh(f.root, 'rev-parse', 'HEAD');
  sh(f.root, 'checkout', '-q', 'main');
  rb.writeRecord(f.userData, { from: side, to: f.head(), time: 'now', installed: false, electron: null, healthy: true, attempts: 0 });
  await nothingChanged(/not an earlier version/);
  rb.writeRecord(f.userData, { from: 'f'.repeat(40), to: f.head(), time: 'now', installed: false, electron: null, healthy: true, attempts: 0 });
  await nothingChanged(/no longer in this copy's history/);
  rb.clearRecord(f.userData);
  await nothingChanged(/no previous version/);
  // same answers, without running anything, for the menu
  assert.equal((await rb.rollbackStatus({ root: f.root, userData: f.userData })).available, false);
});

test('git reset --keep is why a local change can never be lost: even if the blocker were bypassed, git refuses', async () => {
  const f = fixture();
  const { good, bad } = await updated(f);
  writeFileSync(join(f.root, 'a.txt'), 'precious uncommitted edit');
  assert.throws(() => sh(f.root, 'reset', '--keep', good), /not uptodate|overwritten/i);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'precious uncommitted edit');
  assert.equal(f.head(), bad);
});

test('a failed rollback puts the checkout back exactly as it was, and says what happened', async () => {
  const f = fixture();
  const { bad } = await updated(f);
  const s = stubbed('run build', 1); // the build of the OLD version fails once, the rebuild of the current one works
  const res = await rb.rollbackToPrevious({ root: f.root, userData: f.userData, r: s.r });
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  assert.equal(res.rebuilt, true);
  assert.match(res.error, /rollback failed and was undone/);
  assert.match(res.error, /build exploded/);
  assert.equal(f.head(), bad, 'still on the version we started from');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), '2');
  assert.deepEqual(s.calls, ['run build', 'run build']);
  assert.ok(rb.readRecord(f.userData), 'the record is kept so you can try again');
  assert.equal(rb.readDismissed(f.userData), undefined, 'and nothing was marked as skipped');
  // restore itself failing is reported, never hidden
  const f2 = fixture();
  await updated(f2);
  const s2 = stubbed('run build'); // always fails
  const res2 = await rb.rollbackToPrevious({ root: f2.root, userData: f2.userData, r: s2.r });
  assert.equal(res2.ok, false);
  assert.equal(res2.rolledBack, true);
  assert.equal(res2.rebuilt, false);
  assert.match(res2.error, /rebuilding it failed/);
  assert.match(res2.error, /npm install && npm run build/);
});

test('after a rollback the same commit is not offered again by default; a newer one is; Check for Updates still can', async () => {
  const f = fixture();
  const { bad } = await updated(f);
  await rb.rollbackToPrevious({ root: f.root, userData: f.userData, r: stubbed().r });
  let c = await updater.checkForUpdate({ root: f.root });
  assert.equal(c.remoteHead, bad);
  const dismissed = rb.readDismissed(f.userData);
  assert.equal(rb.skipQuietly({ interactive: false, dismissed, remoteHead: c.remoteHead }), true, 'the quiet launch check stays silent');
  assert.equal(rb.skipQuietly({ interactive: true, dismissed, remoteHead: c.remoteHead }), false, 'Check for Updates still offers it');
  f.publish('a.txt', '3', 'v3: the fix');
  c = await updater.checkForUpdate({ root: f.root });
  assert.equal(rb.skipQuietly({ interactive: false, dismissed, remoteHead: c.remoteHead }), false, 'a newer commit is offered again');
  assert.equal(c.behind, 2);
});

test('a version that never starts: the way back is offered after two failed starts in a row, never before, never once it has worked', async () => {
  const f = fixture();
  assert.equal(rb.noteLaunch(f.userData), 0, 'no record: nothing is counted');
  await updated(f);
  assert.equal(rb.shouldOfferOnFailure(rb.readRecord(f.userData)), false);
  assert.equal(rb.noteLaunch(f.userData), 1);
  assert.equal(rb.shouldOfferOnFailure(rb.readRecord(f.userData)), false, 'one failure is not enough');
  assert.equal(rb.noteLaunch(f.userData), 2);
  assert.equal(rb.shouldOfferOnFailure(rb.readRecord(f.userData)), true);
  rb.markHealthy(f.userData);
  assert.equal(rb.shouldOfferOnFailure(rb.readRecord(f.userData)), false, 'it started once, so it is not "broken on start"');
  assert.equal(rb.noteLaunch(f.userData), 0, 'a healthy version is not counted any more');
  assert.equal(rb.readRecord(f.userData).attempts, 0);
  assert.equal((await rb.rollbackStatus({ root: f.root, userData: f.userData })).available, true, 'the menu item stays available for a working version');
  // and the offer really works on a version that never started
  const g = fixture();
  await updated(g);
  rb.noteLaunch(g.userData);
  rb.noteLaunch(g.userData);
  assert.equal(rb.shouldOfferOnFailure(rb.readRecord(g.userData)), true);
  assert.equal((await rb.rollbackToPrevious({ root: g.root, userData: g.userData, r: stubbed().r })).ok, true);
});

test('the update flow still reports electron changes and shares its blocker with rollback', async () => {
  const f = fixture();
  mkdirSync(join(f.root, 'node_modules', 'electron'), { recursive: true });
  writeFileSync(join(f.root, 'node_modules', 'electron', 'package.json'), '{"version":"45.3.4"}');
  f.publish('a.txt', '2', 'v2');
  const res = await updater.applyUpdate({ root: f.root, r: stubbed().r });
  assert.deepEqual(res.electron, { from: '45.3.4', to: '45.3.4' });
  // the same words for the same situation
  const dirty = { branch: 'main', dirty: true, canFastForward: true, behind: 1 };
  assert.equal(updater.blocker(dirty), rb.checkoutBlocker(dirty));
  assert.equal(updater.blocker({ branch: 'x', dirty: false, canFastForward: true, behind: 1 }), rb.checkoutBlocker({ branch: 'x', dirty: false }));
  assert.ok(existsSync(join(desktop, 'shim', 'rollback.cjs')) && readdirSync(join(desktop, 'shim')).includes('rollback.cjs'), 'the launcher copies it into Designer.app with the rest of the shim');
});

test('npm for the rollback gets the login-shell PATH and no Anthropic credentials', async () => {
  const env = await rb.npmEnv({ PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'sk', ANTHROPIC_AUTH_TOKEN: 't', HOME: '/h' }, '/opt/homebrew/bin:/usr/bin');
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
  assert.ok(!('ANTHROPIC_API_KEY' in env) && !('ANTHROPIC_AUTH_TOKEN' in env));
  assert.equal(env.HOME, '/h');
  const real = await rb.loginShellPath({ shell: '/bin/bash' });
  assert.ok(real?.includes('/usr/bin'), 'a real login shell gives a PATH (the variable name must not swallow the end marker)');
});
