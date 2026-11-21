// Designer.app: a copy of the checkout's own Electron.app, renamed and re-iconed, whose app code is a tiny shim that
// starts packages/desktop/main.mjs from the checkout. The bundle holds no Designer code, so a git update changes what
// runs without touching it; it is rebuilt only when the Electron version changes (see staleReason / refreshBundle).
// No Electron imports here: the builder runs as plain Node (`npm run make-app`) and is unit tested.
import { execFile } from 'node:child_process';
import { chmodSync, cpSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Bump when the shim or the bundle layout changes in a way an existing bundle cannot follow. */
export const FORMAT = 2; // 2: the launcher can offer a rollback when the checkout's code will not start
export const BUNDLE_ID = 'app.designer.chat';
export const BUNDLE_NAME = 'Designer';
export const INFO_FILE = 'designer.json'; // inside Contents/Resources: what this bundle was built for

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Set string values of top-level keys in an XML Info.plist. A key that is not there is an error, never a silent no-op. */
export function patchPlist(xml, values) {
  let out = xml;
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (!re.test(out)) throw new Error(`Info.plist has no string key ${key}`);
    out = out.replace(re, (_m, a, c) => `${a}${esc(value)}${c}`);
  }
  return out;
}

export const electronApp = (checkout) => join(checkout, 'node_modules', 'electron', 'dist', 'Electron.app');

/** The Electron version the checkout asks for (npm's package.json for it). This is what the bundle must match. */
export function electronVersion(checkout) {
  try {
    return JSON.parse(readFileSync(join(checkout, 'node_modules', 'electron', 'package.json'), 'utf8')).version || undefined;
  } catch {
    return undefined;
  }
}

/** The version of the Electron binary that is actually downloaded (electron 45+ fetches it on first use, not at npm install). */
export function installedElectronVersion(checkout) {
  try {
    return readFileSync(join(checkout, 'node_modules', 'electron', 'dist', 'version'), 'utf8').trim().replace(/^v/, '') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Make sure the Electron binary for the installed package is on disk. electron's own install.js does the work and does
 * nothing when it is already there, so this is cheap to call every time. `node` may be Electron running as plain Node.
 */
export async function ensureElectron({ checkout, node = process.execPath, env = process.env, run: r = run }) {
  if (installedElectronVersion(checkout) === electronVersion(checkout)) return;
  const clean = { ...env, ELECTRON_RUN_AS_NODE: '1' };
  delete clean.ANTHROPIC_API_KEY;
  delete clean.ANTHROPIC_AUTH_TOKEN;
  try {
    await r(node, [join(checkout, 'node_modules', 'electron', 'install.js')], { cwd: checkout, env: clean, timeout: 10 * 60_000 });
  } catch (e) {
    throw new Error(`Could not download Electron ${electronVersion(checkout)}: ${String(e.stderr || e.message).trim().split('\n').slice(-3).join('\n')}`);
  }
}

export function isCheckout(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'designer' && existsSync(join(dir, 'packages', 'desktop', 'main.mjs'));
  } catch {
    return false;
  }
}

function bundleIdentifier(bundle) {
  try {
    return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}

/** Ad-hoc signature (no certificate, no Apple account): Apple Silicon will not run a binary whose plist was edited and not re-signed. */
async function adHocSign(bundle) {
  if (process.platform !== 'darwin') return; // other platforms cannot run it anyway; tests inject their own
  await new Promise((res, rej) => execFile('codesign', ['--force', '--deep', '--sign', '-', bundle], (e, _o, stderr) => (e ? rej(new Error(`codesign failed: ${String(stderr).trim() || e.message}`)) : res())));
}

/**
 * Build the bundle at `out`. It is assembled and signed next to its final place and moved in with a rename, so a failure at
 * any step leaves an existing app exactly as it was. Replacing an app that is not a Designer shell app needs `force`.
 */
export async function buildBundle({ checkout, out, force = false, sign = adHocSign, ensure = ensureElectron }) {
  checkout = resolve(checkout);
  out = resolve(out);
  if (!isCheckout(checkout)) throw new Error(`${checkout} is not a Designer checkout (no package.json named "designer" with packages/desktop).`);
  const src = electronApp(checkout);
  const version = electronVersion(checkout);
  if (!version) throw new Error(`Electron is not installed in ${checkout}. Run "npm install" there first.`);
  await ensure({ checkout });
  if (!existsSync(src) || installedElectronVersion(checkout) !== version) throw new Error(`Electron ${version} is not downloaded in ${checkout}. Run "node node_modules/electron/install.js" there.`);
  if (existsSync(out)) {
    const id = bundleIdentifier(out);
    if (id !== BUNDLE_ID && !force) throw new Error(`${out} already exists and is not a Designer shell app (${id ?? 'no bundle id'}), so it was left alone. Choose another place with --out, or pass --force to replace it.`);
  }
  const parent = dirname(out);
  mkdirSync(parent, { recursive: true });
  const staged = join(parent, `.${basename(out)}.new-${process.pid}`);
  const old = join(parent, `.${basename(out)}.old-${process.pid}`);
  rmSync(staged, { recursive: true, force: true });
  try {
    // clone-on-write on APFS (instant, no extra disk); frameworks are full of symlinks that must stay symlinks
    cpSync(src, staged, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    const contents = join(staged, 'Contents');
    renameSync(join(contents, 'MacOS', 'Electron'), join(contents, 'MacOS', BUNDLE_NAME));
    chmodSync(join(contents, 'MacOS', BUNDLE_NAME), 0o755);
    const plistFile = join(contents, 'Info.plist');
    writeFileSync(plistFile, patchPlist(readFileSync(plistFile, 'utf8'), {
      CFBundleName: BUNDLE_NAME, CFBundleDisplayName: BUNDLE_NAME, CFBundleExecutable: BUNDLE_NAME, CFBundleIdentifier: BUNDLE_ID,
      CFBundleIconFile: 'Designer.icns', CFBundleShortVersionString: '2.0', CFBundleVersion: '2.0',
    }));
    const resources = join(contents, 'Resources');
    rmSync(join(resources, 'electron.icns'), { force: true });
    cpSync(join(here, 'assets', 'Designer.icns'), join(resources, 'Designer.icns'));
    cpSync(join(here, 'shim'), join(resources, 'app'), { recursive: true });
    writeFileSync(join(resources, INFO_FILE), JSON.stringify({ format: FORMAT, checkout, electron: version }));
    await sign(staged);
    if (existsSync(out)) renameSync(out, old);
    try {
      renameSync(staged, out);
    } catch (e) {
      if (existsSync(old)) renameSync(old, out); // put the previous app back
      throw e;
    }
    rmSync(old, { recursive: true, force: true });
  } catch (e) {
    rmSync(staged, { recursive: true, force: true });
    throw e;
  }
  return { out, electron: version, checkout, staged };
}

export function readBundleInfo(bundle) {
  try {
    return JSON.parse(readFileSync(join(bundle, 'Contents', 'Resources', INFO_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

/** The Designer.app this process runs from, or null (plain `npm run app`, tests, anything that is not our bundle). */
export function runningBundle(execPath) {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return m && readBundleInfo(m[1]) ? m[1] : null;
}

/** Why the bundle must be rebuilt for this checkout, or undefined when it is current. */
export function staleReason({ bundle, checkout }) {
  const info = readBundleInfo(bundle);
  if (!info) return 'The Designer app shell is unreadable and needs a rebuild.';
  if (typeof info.format !== 'number' || info.format < FORMAT) return 'The Designer app shell is older than this version of Designer and needs a rebuild.';
  const want = electronVersion(checkout);
  if (want && want !== info.electron) return `Designer now needs Electron ${want} (the app shell has Electron ${info.electron}).`;
  return undefined;
}

export function run(cmd, args, { cwd, env, timeout = 0 } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { cwd, env, timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      if (err) rej(Object.assign(err, { stdout: String(stdout), stderr: String(stderr) }));
      else res(String(stdout).trim());
    });
  });
}

/**
 * Rebuild the bundle if it is stale, using the checkout's own (just updated) builder, run as plain Node by the app's own
 * Electron binary. Never throws: returns { refreshed } or { refreshed: false, error }. The old bundle survives any failure.
 */
export async function refreshBundle({ bundle, checkout, execPath, env, run: r = run }) {
  if (!staleReason({ bundle, checkout })) return { refreshed: false };
  const clean = { ...env, ELECTRON_RUN_AS_NODE: '1' };
  delete clean.ANTHROPIC_API_KEY; // the builder needs none, and this runs install-adjacent code from the checkout
  delete clean.ANTHROPIC_AUTH_TOKEN;
  try {
    await r(execPath, [join(checkout, 'scripts', 'make-app.mjs'), '--out', bundle, '--checkout', checkout], { env: clean, timeout: 5 * 60_000 });
    return { refreshed: true };
  } catch (e) {
    return { refreshed: false, error: String(e.stderr || e.message).trim().split('\n').slice(-6).join('\n') };
  }
}
