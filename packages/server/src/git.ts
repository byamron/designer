import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: 30_000, maxBuffer: 4 << 20 });
    return stdout.trim();
  } catch (e: any) {
    throw new Error((e.stderr || e.message || 'git failed').toString().trim().split('\n')[0]);
  }
}

/** Top-level directory of the repo containing `dir`, or undefined if it is not in a git repo. */
export async function repoRoot(dir: string): Promise<string | undefined> {
  try {
    return await git(dir, 'rev-parse', '--show-toplevel');
  } catch {
    return undefined;
  }
}

export async function currentBranch(dir: string): Promise<string | undefined> {
  try {
    return (await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')) || undefined;
  } catch {
    return undefined;
  }
}

export const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,48}$/i;

export async function addWorktree(repo: string, path: string, name: string): Promise<string> {
  if (!NAME_RE.test(name) || name.includes('..')) throw new Error('Use letters, numbers, dots, dashes (max 49 chars).');
  try {
    await git(repo, 'rev-parse', '--verify', '-q', 'HEAD');
  } catch {
    throw new Error('This repository has no commits yet, so a worktree cannot be created. Make a first commit, then try again.');
  }
  const branch = `designer/${name}`;
  await git(repo, 'worktree', 'add', '-b', branch, path, 'HEAD');
  return branch;
}

/** Fails if the worktree has uncommitted changes: we never force-remove someone's work. */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  await git(repo, 'worktree', 'remove', path);
}
