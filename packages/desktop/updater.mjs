// Update Designer from its own git checkout: look for new commits on main, fast-forward, reinstall if dependencies
// changed, rebuild, and let the shell relaunch. Never merges, rebases or discards your work: it refuses unless the
// checkout is clean, on main, and can fast-forward. If anything fails it puts the checkout back exactly as it was.
import { execFile } from 'node:child_process';

export function run(cmd, args, { cwd, env, timeout = 0 } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { cwd, env, timeout, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      if (err) rej(Object.assign(err, { stdout: String(stdout), stderr: String(stderr) }));
      else res(String(stdout).trim());
    });
  });
}

const REMOTE = 'origin';
const BRANCH = 'main';

/** What would an update do? Read-only apart from `git fetch`. */
export async function checkForUpdate({ root, r = run }) {
  const git = (...a) => r('git', a, { cwd: root, timeout: 60_000 });
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirty = (await git('status', '--porcelain')).length > 0;
  await git('fetch', REMOTE, BRANCH);
  const head = await git('rev-parse', 'HEAD');
  const remoteHead = await git('rev-parse', `${REMOTE}/${BRANCH}`);
  const behind = Number(await git('rev-list', '--count', `HEAD..${REMOTE}/${BRANCH}`));
  let canFastForward = true;
  try {
    await git('merge-base', '--is-ancestor', 'HEAD', `${REMOTE}/${BRANCH}`);
  } catch {
    canFastForward = false;
  }
  const log = behind ? await git('log', '--format=%h %s', '-n', '30', `HEAD..${REMOTE}/${BRANCH}`) : '';
  return { branch, dirty, head, remoteHead, behind, canFastForward, commits: log ? log.split('\n') : [] };
}

/** Why an update cannot run right now, or undefined if it can. */
export function blocker(c) {
  if (c.branch !== BRANCH) return `This copy is on "${c.branch}", not ${BRANCH}. Switch it to ${BRANCH} first; updates only follow ${BRANCH}.`;
  if (c.dirty) return 'This copy has uncommitted changes, so it will not be touched. The copy you run should never be edited; use a worktree for changes.';
  if (!c.canFastForward) return `This copy has commits that ${REMOTE}/${BRANCH} does not, so it cannot move forward cleanly. Nothing was changed.`;
  if (c.behind === 0) return 'Already up to date.';
  return undefined;
}

/**
 * Apply the update. `env` should carry the PATH that finds npm. Calls `progress(text)` between steps.
 * Returns { ok: true, from, to, installed } or { ok: false, error, rolledBack }.
 */
export async function applyUpdate({ root, env, r = run, progress = () => {} }) {
  const git = (...a) => r('git', a, { cwd: root, timeout: 120_000 });
  const npm = (...a) => r('npm', a, { cwd: root, env, timeout: 15 * 60_000 });
  const check = await checkForUpdate({ root, r });
  const why = blocker(check);
  if (why) return { ok: false, error: why, rolledBack: false };
  const from = check.head;
  try {
    progress('Fetching the new version…');
    await git('merge', '--ff-only', `${REMOTE}/${BRANCH}`);
    const changed = (await git('diff', '--name-only', from, 'HEAD')).split('\n');
    const installed = changed.some((f) => /(^|\/)(package\.json|package-lock\.json)$/.test(f));
    if (installed) {
      progress('Installing new dependencies…');
      await npm('install', '--no-audit', '--no-fund');
    }
    progress('Building…');
    await npm('run', 'build');
    return { ok: true, from, to: await git('rev-parse', 'HEAD'), installed };
  } catch (e) {
    // put the checkout back exactly as it was: it was clean and we only fast-forwarded, so this loses nothing
    let rolledBack = false;
    try {
      await git('reset', '--hard', from);
      rolledBack = true;
      progress('Something failed; restoring the previous version…');
      await npm('install', '--no-audit', '--no-fund').catch(() => {});
      await npm('run', 'build').catch(() => {});
    } catch {
      /* report below */
    }
    const detail = String(e.stderr || e.message || e).trim().split('\n').slice(-6).join('\n');
    return { ok: false, error: `The update failed and was undone.\n${detail}`, rolledBack };
  }
}
