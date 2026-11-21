#!/usr/bin/env node
// Install-script guard. `npm install` (which Update & Restart runs on the owner's Mac) executes lifecycle scripts of every
// dependency that has one. This fails a pull request that:
//   1. adds or changes a lockfile package with hasInstallScript that is not in the reviewed allowlist,
//   2. adds or changes a preinstall/install/postinstall/prepare script in the root or a workspace package.json (same rule),
//   3. leaves any lockfile entry that is not fetched over https from registry.npmjs.org with a sha256/384/512 integrity hash.
//
//   node scripts/ci/install-scripts-guard.mjs --base-dir <dir with the base's package*.json> [--head-dir .] [--allowlist <json>]
//   Allowlist: [{ "name": "esbuild", "reason": "why this install script is acceptable" }] (workspace scripts: "@designer/x#postinstall").
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'];
const REGISTRY_HOST = 'registry.npmjs.org';

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

export function pkgName(key, entry) {
  const i = key.lastIndexOf('node_modules/');
  return i >= 0 ? key.slice(i + 'node_modules/'.length) : (entry.name ?? key);
}

export function validateAllowlist(list) {
  if (!Array.isArray(list)) return ['allowlist must be a JSON array'];
  return list.flatMap((e, i) => [
    ...(typeof e?.name === 'string' && e.name ? [] : [`allowlist[${i}]: "name" is required`]),
    ...(typeof e?.reason === 'string' && e.reason.trim().length >= 10 ? [] : [`allowlist[${i}] (${e?.name}): "reason" is required (10+ characters: why this install script is acceptable)`]),
  ]);
}

/** Lockfile entries that are not registry.npmjs.org over https with an integrity hash. */
export function sourceProblems(lock) {
  const out = [];
  for (const [key, e] of Object.entries(lock.packages ?? {})) {
    if (!key.includes('node_modules/') || e.link || e.inBundle) continue; // the root, workspaces and symlinks are local; bundled files ship inside their parent
    const name = pkgName(key, e);
    if (!e.resolved) { out.push(`${name} (${key}): no "resolved" URL in the lockfile`); continue; }
    let u;
    try { u = new URL(e.resolved); } catch { out.push(`${name}: resolved is not a URL (${e.resolved})`); continue; }
    if (u.protocol !== 'https:' || u.hostname !== REGISTRY_HOST || u.username || u.password) out.push(`${name}: resolves from ${e.resolved}, not https://${REGISTRY_HOST}/`);
    if (!/^sha(256|384|512)-[A-Za-z0-9+/=]{20,}$/.test(e.integrity ?? '')) out.push(`${name}: missing or weak integrity hash (${e.integrity ?? 'none'})`);
  }
  return out;
}

const sig = (e) => (e ? `${e.version}|${e.resolved}|${e.integrity}|${e.hasInstallScript ? 1 : 0}` : null);

/** Lockfile packages with an install script that are new or changed against the base. */
export function newInstallScripts(baseLock, headLock) {
  const out = [];
  for (const [key, e] of Object.entries(headLock.packages ?? {})) {
    if (!key || !e.hasInstallScript) continue;
    if (sig(baseLock?.packages?.[key]) !== sig(e)) out.push({ name: pkgName(key, e), version: e.version, key });
  }
  return out;
}

function workspaceDirs(dir, rootPkg) {
  const dirs = [''];
  for (const w of rootPkg?.workspaces?.packages ?? rootPkg?.workspaces ?? []) {
    if (w.endsWith('/*')) {
      const base = w.slice(0, -2);
      if (existsSync(join(dir, base))) for (const d of readdirSync(join(dir, base), { withFileTypes: true })) if (d.isDirectory() && d.name !== 'node_modules') dirs.push(`${base}/${d.name}`);
    } else dirs.push(w);
  }
  return dirs;
}

/** `name#script` -> command, for every lifecycle script in the root and workspace package.json files under `dir`. */
export function lifecycleScripts(dir) {
  const root = readJson(join(dir, 'package.json'));
  const out = {};
  for (const d of workspaceDirs(dir, root)) {
    const p = readJson(join(dir, d, 'package.json'));
    if (!p) continue;
    for (const s of LIFECYCLE) if (p.scripts?.[s]) out[`${p.name ?? (d || 'root')}#${s}`] = p.scripts[s];
  }
  return out;
}

export function check({ baseDir, headDir, allowlist }) {
  const problems = [...validateAllowlist(allowlist)];
  const allowed = new Set((Array.isArray(allowlist) ? allowlist : []).map((e) => e?.name));
  const notes = [];
  const headLock = readJson(join(headDir, 'package-lock.json'));
  if (!headLock) return { problems: [...problems, 'no package-lock.json in the PR head: the lockfile must be committed'], notes };
  const baseLock = baseDir ? readJson(join(baseDir, 'package-lock.json')) : null;
  for (const s of sourceProblems(headLock)) problems.push(`lockfile source: ${s}`);
  for (const p of newInstallScripts(baseLock, headLock)) {
    if (allowed.has(p.name)) notes.push(`${p.name}@${p.version} has an install script; it is on the reviewed allowlist`);
    else problems.push(`${p.name}@${p.version} was added or changed and has an install script (runs on \`npm install\`). Review it, then add "${p.name}" with a reason to scripts/ci/install-scripts-allowlist.json`);
  }
  const base = baseDir ? lifecycleScripts(baseDir) : {};
  for (const [k, cmd] of Object.entries(lifecycleScripts(headDir))) {
    if (base[k] === cmd) continue;
    if (allowed.has(k)) notes.push(`${k} changed; it is on the reviewed allowlist`);
    else problems.push(`${k} is new or changed ("${cmd}") and runs on \`npm install\`. Review it, then add "${k}" with a reason to scripts/ci/install-scripts-allowlist.json`);
  }
  return { problems, notes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const headDir = opt('--head-dir', '.');
  const baseDir = opt('--base-dir');
  const allowFile = opt('--allowlist', join(headDir, 'scripts/ci/install-scripts-allowlist.json'));
  if (!baseDir) (console.error('install-scripts-guard: --base-dir is required (use an empty dir to treat everything as new)'), process.exit(2));
  const r = check({ baseDir, headDir, allowlist: readJson(allowFile) ?? [] });
  for (const n of r.notes) console.log(`install-scripts-guard: ${n}`);
  for (const p of r.problems) console.log(`::error title=Install scripts / lockfile::${p}`);
  if (!r.problems.length) console.log('install-scripts-guard: ok');
  process.exit(r.problems.length ? 1 : 0);
}
