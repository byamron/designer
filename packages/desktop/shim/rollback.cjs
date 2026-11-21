// Going back to the previous version of Designer, and the bookkeeping around updates. Self-contained (Node only, no Electron,
// nothing imported from the rest of the checkout): the launcher inside Designer.app uses it when the checkout's own code will
// not even start, which is exactly when a rollback is needed. main.mjs and updater.mjs use the same code.
//
// The git operation is `git reset --keep <previous>` on main: it moves main back and updates the files, and it REFUSES (changing
// nothing) if that would overwrite a local change. `--hard` would silently discard uncommitted work; `git revert` would add
// commits that origin/main does not have, so main would no longer fast-forward and updates would stop working; `git checkout`
// would detach HEAD, which the updater refuses. After `--keep` main is simply behind origin/main, so updating forward is still a
// plain fast-forward, and the commit we left is still in the reflog.
'use strict';
const { execFile } = require('node:child_process');
const { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const REMOTE = 'origin';
const BRANCH = 'main';
const SHA = /^[0-9a-f]{40}$/;

function run(cmd, args, { cwd, env, timeout = 0 } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { cwd, env, timeout, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      if (err) rej(Object.assign(err, { stdout: String(stdout), stderr: String(stderr) }));
      else res(String(stdout).trim());
    });
  });
}

/** Shared with the updater: the copy you run must be on main and have no uncommitted changes, whichever way it moves. */
function checkoutBlocker(c) {
  if (c.branch !== BRANCH) return `This copy is on "${c.branch}", not ${BRANCH}. Switch it to ${BRANCH} first; updates only follow ${BRANCH}.`;
  if (c.dirty) return 'This copy has uncommitted changes, so it will not be touched. The copy you run should never be edited; use a worktree for changes.';
  return undefined;
}

// ---------- what an update leaves behind (in the app's own data folder, never in the repo) ----------
const recordFile = (userData) => join(userData, 'previous-version.json');
const dismissedFile = (userData) => join(userData, 'update-dismissed.txt');

/** { from, to, time, installed, electron: {from,to}|null, healthy, attempts } or undefined when absent or unreadable. */
function readRecord(userData) {
  try {
    const r = JSON.parse(readFileSync(recordFile(userData), 'utf8'));
    if (!SHA.test(r?.from) || !SHA.test(r?.to)) return undefined; // never hand git anything but a full commit id
    return { from: r.from, to: r.to, time: String(r.time ?? ''), installed: !!r.installed, electron: r.electron ?? null, healthy: r.healthy !== false, attempts: Number(r.attempts) || 0 };
  } catch {
    return undefined;
  }
}

function writeRecord(userData, record) {
  mkdirSync(userData, { recursive: true });
  const tmp = `${recordFile(userData)}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(record));
  renameSync(tmp, recordFile(userData)); // never leave a half-written file that would hide the way back
}

function clearRecord(userData) {
  rmSync(recordFile(userData), { force: true });
}

/** Record a finished update. The new version counts as unproven until the app has fully started once on it. */
function recordUpdate(userData, { from, to, installed, electron }) {
  writeRecord(userData, { from, to, time: new Date().toISOString(), installed: !!installed, electron: electron ?? null, healthy: false, attempts: 0 });
}

/** Called at every launch: a launch on an unproven version counts as an attempt. Returns the attempts so far. */
function noteLaunch(userData) {
  const r = readRecord(userData);
  if (!r || r.healthy) return 0;
  writeRecord(userData, { ...r, attempts: r.attempts + 1 });
  return r.attempts + 1;
}

/** Called once the window has loaded the app from a running server: this version works. */
function markHealthy(userData) {
  const r = readRecord(userData);
  if (r && !r.healthy) writeRecord(userData, { ...r, healthy: true, attempts: 0 });
}

/** The app could not start. Offer the way back only after two failed starts in a row on a version that never started. */
function shouldOfferOnFailure(record) {
  return !!record && !record.healthy && record.attempts >= 2;
}

/** "Later" must not nag about a version you already said no to (or just rolled back from); a newer commit is offered again. */
function skipQuietly({ interactive, dismissed, remoteHead }) {
  return !interactive && !!dismissed && dismissed === remoteHead;
}

function writeDismissed(userData, sha) {
  mkdirSync(userData, { recursive: true });
  writeFileSync(dismissedFile(userData), sha);
}

function readDismissed(userData) {
  try {
    return readFileSync(dismissedFile(userData), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function electronVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

const isPackageFile = (f) => /(^|\/)(package\.json|package-lock\.json)$/.test(f);

// ---------- the rollback itself ----------
/** Read-only look at the checkout: no network, no changes. */
async function checkRollback({ root, target, r = run }) {
  const git = (...a) => r('git', a, { cwd: root, timeout: 60_000 });
  const ok = (...a) => git(...a).then(() => true, () => false);
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirty = (await git('status', '--porcelain')).length > 0;
  const head = await git('rev-parse', 'HEAD');
  const targetKnown = SHA.test(target ?? '') && (await ok('cat-file', '-e', `${target}^{commit}`));
  const isAncestor = targetKnown && (await ok('merge-base', '--is-ancestor', target, 'HEAD'));
  return { branch, dirty, head, targetKnown, isAncestor };
}

/** Why a rollback cannot run right now, or undefined if it can. */
function rollbackBlocker(c, record) {
  const base = checkoutBlocker(c);
  if (base) return base;
  if (!record) return 'There is no previous version recorded.';
  if (record.to !== c.head) return 'This copy is no longer at the version Designer last updated to (it was changed outside Designer), so there is nothing to go back to. Nothing was changed.';
  if (!c.targetKnown) return "The previous version is no longer in this copy's history. Nothing was changed.";
  if (!c.isAncestor) return 'The previous version is not an earlier version of this copy. Nothing was changed.';
  return undefined;
}

/** Can the menu item be used now? { available, why, record } */
async function rollbackStatus({ root, userData, r = run }) {
  const record = readRecord(userData);
  if (!record) return { available: false, why: 'There is no previous version recorded.' };
  try {
    const why = rollbackBlocker(await checkRollback({ root, target: record.from, r }), record);
    return { available: !why, why, record };
  } catch (e) {
    return { available: false, why: String(e.stderr || e.message).trim().split('\n').slice(-2).join('\n'), record };
  }
}

/** "abc1234 Subject" for a dialog; falls back to the short sha. */
async function describeVersion({ root, sha, r = run }) {
  try {
    return await r('git', ['log', '-1', '--format=%h %s', sha], { cwd: root, timeout: 30_000 });
  } catch {
    return sha.slice(0, 7);
  }
}

/**
 * Move main back to `record.from`, the mirror image of applyUpdate: refuse unless the copy is clean, on main and still at
 * `record.to`; reinstall only if package files differ; rebuild the UI; and if any step fails put the checkout back exactly as it
 * was (same commit, rebuilt). `env` carries the PATH that finds npm. Returns { ok: true, from, to, installed, electron } or
 * { ok: false, error, rolledBack, rebuilt }.
 */
async function applyRollback({ root, record, env, r = run, progress = () => {} }) {
  const git = (...a) => r('git', a, { cwd: root, timeout: 120_000 });
  const npm = (...a) => r('npm', a, { cwd: root, env, timeout: 15 * 60_000 });
  const tail = (e) => String(e.stderr || e.message || e).trim().split('\n').slice(-6).join('\n');
  const check = await checkRollback({ root, target: record?.from, r });
  const why = rollbackBlocker(check, record);
  if (why) return { ok: false, error: why, rolledBack: false, rebuilt: false };
  const from = check.head; // the version we are leaving (the one that may be bad)
  const to = record.from;
  const electronBefore = electronVersion(root);
  let installed = false;
  try {
    progress('Going back to the previous version…');
    const changed = (await git('diff', '--name-only', from, to)).split('\n');
    installed = changed.some(isPackageFile);
    await git('reset', '--keep', to);
    if (installed) {
      progress('Reinstalling the previous dependencies…');
      await npm('install', '--no-audit', '--no-fund');
    }
    progress('Building…');
    await npm('run', 'build');
    return { ok: true, from, to, installed, electron: { from: electronBefore ?? null, to: electronVersion(root) ?? null } };
  } catch (e) {
    let rolledBack = false;
    let rebuilt = false;
    let restore = '';
    try {
      await git('reset', '--keep', from);
      rolledBack = true;
    } catch (re) {
      restore = `\nPutting the current version back also failed, so ${root} may be in a half-rolled-back state:\n${tail(re)}`;
    }
    if (rolledBack) {
      progress('Something failed; restoring the current version…');
      try {
        if (installed) await npm('install', '--no-audit', '--no-fund');
        await npm('run', 'build');
        rebuilt = true;
      } catch (re) {
        restore = `\nThe current code is back, but rebuilding it failed, so the app may not start correctly. Run "npm install && npm run build" in ${root}.\n${tail(re)}`;
      }
    }
    const head = rolledBack && rebuilt ? 'The rollback failed and was undone.' : 'The rollback failed.';
    return { ok: false, error: `${head}\n${tail(e)}${restore}`, rolledBack, rebuilt };
  }
}

/**
 * The whole thing: roll back to the recorded version, then remember that the version we left was skipped (so it is not offered
 * again as the default) and forget the record (the previous version is now the current one).
 */
async function rollbackToPrevious({ root, userData, env, r = run, progress }) {
  const record = readRecord(userData);
  const res = await applyRollback({ root, record, env, r, progress });
  if (res.ok) {
    writeDismissed(userData, res.from);
    clearRecord(userData);
    try { appendFileSync(join(userData, 'update.log'), `${new Date().toISOString()} rolled back ${res.from} -> ${res.to}\n`); } catch { /* the log is a courtesy */ }
  }
  return res;
}

// ---------- PATH for npm when started from the Dock (a copy of lib.mjs's, because the launcher cannot import from the checkout) ----------
const START = '__DESIGNER_PATH_START__';
const END = '__DESIGNER_PATH_END__';
function loginShellPath({ shell = process.env.SHELL || '/bin/zsh', timeoutMs = 6000, exec = execFile } = {}) {
  return new Promise((res) => {
    exec(shell, ['-ilc', `printf '%s' "${START}\${PATH}${END}"`], { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } }, (err, stdout) => {
      const m = new RegExp(`${START}(.*?)${END}`, 's').exec(String(stdout ?? ''));
      const p = m?.[1].trim();
      res(err && !stdout ? undefined : p && !p.includes('\n') ? p : undefined);
    });
  });
}

/** The environment for npm: login-shell PATH first, and never the Anthropic credentials. */
async function npmEnv(base = process.env, shellPath) {
  const sp = shellPath ?? (await loginShellPath());
  const seen = new Set();
  const PATH = [...(sp ?? '').split(':'), ...(base.PATH ?? '').split(':')].filter((p) => p && !seen.has(p) && seen.add(p)).join(':');
  const env = { ...base, PATH };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

module.exports = {
  REMOTE, BRANCH, run, checkoutBlocker, isPackageFile, electronVersion,
  recordFile, dismissedFile, readRecord, writeRecord, clearRecord, recordUpdate, noteLaunch, markHealthy, shouldOfferOnFailure,
  skipQuietly, writeDismissed, readDismissed,
  checkRollback, rollbackBlocker, rollbackStatus, describeVersion, applyRollback, rollbackToPrevious, loginShellPath, npmEnv,
};
