// Designer.app: the bundle builder (packages/desktop/bundle.mjs) and the shim that runs inside the bundle.
// Everything here is headless: a fake Electron.app stands in for the real one, and codesign is replaced by a recorder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const desktop = fileURLToPath(new URL('../../desktop/', import.meta.url));
const b: any = await import(join(desktop, 'bundle.mjs'));
const locate: any = createRequire(import.meta.url)(join(desktop, 'shim', 'locate.cjs'));

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Electron</string>
\t<key>CFBundleExecutable</key>
\t<string>Electron</string>
\t<key>CFBundleIconFile</key>
\t<string>electron.icns</string>
\t<key>CFBundleIdentifier</key>
\t<string>com.github.Electron</string>
\t<key>CFBundleName</key>
\t<string>Electron</string>
\t<key>CFBundleShortVersionString</key>
\t<string>45.3.4</string>
\t<key>CFBundleVersion</key>
\t<string>45.3.4</string>
\t<key>NSHighResolutionCapable</key>
\t<true/>
</dict>
</plist>
`;

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'dapp-')));
const write = (p: string, s = '') => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, s));

/** A Designer checkout with an installed (fake) Electron of the given version. */
function checkout(electron = '45.3.4') {
  const dir = tmp();
  write(join(dir, 'package.json'), '{"name":"designer"}');
  write(join(dir, 'packages/desktop/main.mjs'), '// main');
  write(join(dir, 'scripts/make-app.mjs'), '// builder');
  const app = join(dir, 'node_modules/electron/dist/Electron.app');
  write(join(app, 'Contents/Info.plist'), PLIST);
  write(join(app, 'Contents/MacOS/Electron'), '#!/bin/sh\n');
  chmodSync(join(app, 'Contents/MacOS/Electron'), 0o755);
  write(join(app, 'Contents/Resources/electron.icns'), 'old icon');
  write(join(app, 'Contents/Resources/default_app.asar'), 'asar');
  write(join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'), 'fw');
  symlinkSync('A', join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'));
  write(join(dir, 'node_modules/electron/package.json'), JSON.stringify({ name: 'electron', version: electron }));
  write(join(dir, 'node_modules/electron/dist/version'), electron);
  return dir;
}

/** npm install moves electron's package.json to the new version; the binary only arrives when install.js runs. */
const bump = (co: string, v: string) => write(join(co, 'node_modules/electron/package.json'), JSON.stringify({ name: 'electron', version: v }));
const installed: string[] = [];
const ensure = async ({ checkout: co }: { checkout: string }) => {
  const want = JSON.parse(readFileSync(join(co, 'node_modules/electron/package.json'), 'utf8')).version;
  if (readFileSync(join(co, 'node_modules/electron/dist/version'), 'utf8') !== want) (installed.push(want), write(join(co, 'node_modules/electron/dist/version'), want));
};
const signed: string[] = [];
const sign = async (p: string) => void signed.push(p);

test('plist patching: sets known keys, keeps the rest, refuses a key that is not there', () => {
  const out = b.patchPlist(PLIST, { CFBundleName: 'Designer', CFBundleIdentifier: 'app.designer.chat' });
  assert.match(out, /<key>CFBundleName<\/key>\s*<string>Designer<\/string>/);
  assert.match(out, /<key>CFBundleIdentifier<\/key>\s*<string>app.designer.chat<\/string>/);
  assert.match(out, /<key>NSHighResolutionCapable<\/key>\s*<true\/>/);
  assert.match(out, /<key>CFBundleExecutable<\/key>\s*<string>Electron<\/string>/);
  assert.throws(() => b.patchPlist(PLIST, { NoSuchKey: 'x' }), /NoSuchKey/);
  assert.match(b.patchPlist(PLIST, { CFBundleName: 'A & <B>' }), /A &amp; &lt;B&gt;/, 'values are escaped');
});

test('bundle layout: a Designer-named copy of Electron whose app code is a shim pointing at the checkout', async () => {
  const co = checkout();
  const out = join(tmp(), 'Designer.app');
  signed.length = 0;
  const r = await b.buildBundle({ checkout: co, out, sign, ensure });
  assert.equal(r.electron, '45.3.4');
  const c = join(out, 'Contents');
  assert.ok(existsSync(join(c, 'MacOS/Designer')), 'executable renamed');
  assert.ok(!existsSync(join(c, 'MacOS/Electron')));
  assert.ok(statSync(join(c, 'MacOS/Designer')).mode & 0o100, 'and still executable');
  const plist = readFileSync(join(c, 'Info.plist'), 'utf8');
  for (const [k, v] of [['CFBundleName', 'Designer'], ['CFBundleDisplayName', 'Designer'], ['CFBundleExecutable', 'Designer'], ['CFBundleIdentifier', 'app.designer.chat'], ['CFBundleIconFile', 'Designer.icns']]) {
    assert.match(plist, new RegExp(`<key>${k}</key>\\s*<string>${v.replace('.', '\\.')}</string>`), k);
  }
  assert.ok(!plist.includes('com.github.Electron'), 'does not claim the generic Electron identity');
  assert.ok(existsSync(join(c, 'Resources/Designer.icns')) && !existsSync(join(c, 'Resources/electron.icns')), 'Designer icon replaces the Electron one');
  assert.ok(existsSync(join(c, 'Resources/default_app.asar')), 'Electron resources are left as they were');
  assert.ok(lstatSync(join(c, 'Frameworks/Electron Framework.framework/Versions/Current')).isSymbolicLink(), 'framework symlinks survive the copy');
  // the app code is the shim, not the checkout: nothing in the bundle changes when the checkout updates
  const pkg = JSON.parse(readFileSync(join(c, 'Resources/app/package.json'), 'utf8'));
  assert.equal(pkg.main, 'main.cjs');
  assert.equal(pkg.productName, 'Designer');
  assert.ok(existsSync(join(c, 'Resources/app/main.cjs')) && existsSync(join(c, 'Resources/app/locate.cjs')));
  assert.deepEqual(JSON.parse(readFileSync(join(c, 'Resources/designer.json'), 'utf8')), { format: b.FORMAT, checkout: co, electron: '45.3.4' });
  assert.deepEqual(signed, [r.staged ?? signed[0]], 'signed exactly once, before it was moved into place');
  assert.ok(!signed[0].endsWith('Designer.app'), 'signed in the staging directory, not at the final path');
  // the installed Electron itself is untouched
  assert.match(readFileSync(join(co, 'node_modules/electron/dist/Electron.app/Contents/Info.plist'), 'utf8'), /com.github.Electron/);
  assert.deepEqual(readdirSync(dirname(out)), ['Designer.app'], 'no temporary leftovers');
});

test('missing pieces are reported plainly', async () => {
  const noElectron = tmp();
  write(join(noElectron, 'package.json'), '{"name":"designer"}');
  write(join(noElectron, 'packages/desktop/main.mjs'));
  await assert.rejects(b.buildBundle({ checkout: noElectron, out: join(tmp(), 'Designer.app'), sign }), /npm install/);
  await assert.rejects(b.buildBundle({ checkout: tmp(), out: join(tmp(), 'Designer.app'), sign }), /not a Designer checkout/);
});

test('an app that is not ours is never replaced without --force; ours is replaced in place', async () => {
  const co = checkout();
  const dir = tmp();
  const out = join(dir, 'Designer.app');
  write(join(out, 'Contents/Info.plist'), PLIST.replace('com.github.Electron', 'com.example.other'));
  await assert.rejects(b.buildBundle({ checkout: co, out, sign, ensure }), /not a Designer shell app/);
  assert.match(readFileSync(join(out, 'Contents/Info.plist'), 'utf8'), /com.example.other/, 'left exactly as it was');
  await b.buildBundle({ checkout: co, out, sign, ensure, force: true });
  assert.ok(existsSync(join(out, 'Contents/MacOS/Designer')));
  // a second build over our own bundle needs no flag, and picks up a new Electron
  bump(co, '46.0.0');
  const again = await b.buildBundle({ checkout: co, out, sign, ensure });
  assert.equal(again.electron, '46.0.0');
  assert.deepEqual(readdirSync(dir), ['Designer.app']);
});

test('a failed build (for example codesign) leaves the existing app untouched and cleans up', async () => {
  const co = checkout();
  const dir = tmp();
  const out = join(dir, 'Designer.app');
  await b.buildBundle({ checkout: co, out, sign, ensure });
  bump(co, '46.0.0');
  await assert.rejects(b.buildBundle({ checkout: co, out, ensure, sign: async () => { throw new Error('codesign exploded'); } }), /codesign exploded/);
  assert.equal(JSON.parse(readFileSync(join(out, 'Contents/Resources/designer.json'), 'utf8')).electron, '45.3.4', 'still the old working bundle');
  assert.deepEqual(readdirSync(dir), ['Designer.app']);
});

test('electron 45+ downloads its binary lazily: the builder fetches it when the package moved ahead of the binary, and says so if that fails', async () => {
  const co = checkout();
  const out = join(tmp(), 'Designer.app');
  installed.length = 0;
  await b.buildBundle({ checkout: co, out, sign, ensure });
  assert.deepEqual(installed, [], 'binary already current: nothing to download');
  bump(co, '46.2.0'); // what `npm install` does after a version bump: package.json moves, dist stays
  assert.equal(b.installedElectronVersion(co), '45.3.4');
  const r = await b.buildBundle({ checkout: co, out, sign, ensure });
  assert.deepEqual(installed, ['46.2.0']);
  assert.equal(r.electron, '46.2.0');
  // the real step: electron's own install.js, run as plain Node, without Anthropic credentials
  const calls: any[] = [];
  bump(co, '46.3.0');
  await b.ensureElectron({ checkout: co, node: '/x/Designer', env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk', ANTHROPIC_AUTH_TOKEN: 't' }, run: async (cmd: string, args: string[], o: any) => void calls.push({ cmd, args, env: o.env }) });
  assert.equal(calls[0].cmd, '/x/Designer');
  assert.deepEqual(calls[0].args, [join(co, 'node_modules/electron/install.js')]);
  assert.equal(calls[0].env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(!('ANTHROPIC_API_KEY' in calls[0].env) && !('ANTHROPIC_AUTH_TOKEN' in calls[0].env));
  await assert.rejects(b.ensureElectron({ checkout: co, run: async () => { throw Object.assign(new Error('x'), { stderr: 'getaddrinfo ENOTFOUND github.com' }); } }), /Could not download Electron 46\.3\.0.*ENOTFOUND/s);
  // no download happened and none was possible: refuse to build an app around a missing binary
  await assert.rejects(b.buildBundle({ checkout: co, out: join(tmp(), 'Designer.app'), sign, ensure: async () => {} }), /not downloaded/);
});

test('stale detection: an Electron bump or a newer bundle format means the app shell must be rebuilt', async () => {
  const co = checkout();
  const out = join(tmp(), 'Designer.app');
  await b.buildBundle({ checkout: co, out, sign, ensure });
  assert.equal(b.staleReason({ bundle: out, checkout: co }), undefined);
  bump(co, '46.1.0');
  assert.match(b.staleReason({ bundle: out, checkout: co }), /Electron 46\.1\.0.*Electron 45\.3\.4/);
  bump(co, '45.3.4');
  const infoFile = join(out, 'Contents/Resources/designer.json');
  writeFileSync(infoFile, JSON.stringify({ format: b.FORMAT - 1, checkout: co, electron: '45.3.4' }));
  assert.match(b.staleReason({ bundle: out, checkout: co }), /older/);
  writeFileSync(infoFile, '{broken');
  assert.match(b.staleReason({ bundle: out, checkout: co }), /unreadable|rebuild/i);
});

test('which bundle is running: derived from the executable path, and only when it is one of ours', async () => {
  const co = checkout();
  const out = join(tmp(), 'Designer.app');
  await b.buildBundle({ checkout: co, out, sign, ensure });
  assert.equal(b.runningBundle(join(out, 'Contents/MacOS/Designer')), out);
  assert.equal(b.runningBundle(join(co, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')), null, 'plain Electron from npm run app');
  assert.equal(b.runningBundle('/usr/local/bin/node'), null);
});

test('after an update the bundle is rebuilt only when stale, by the new checkout\'s own builder, as plain Node', async () => {
  const co = checkout();
  const out = join(tmp(), 'Designer.app');
  await b.buildBundle({ checkout: co, out, sign, ensure });
  const calls: any[] = [];
  const run = async (cmd: string, args: string[], opts: any) => void calls.push({ cmd, args, env: opts.env });
  assert.deepEqual(await b.refreshBundle({ bundle: out, checkout: co, execPath: '/x/Designer', env: { PATH: '/bin' }, run }), { refreshed: false });
  assert.equal(calls.length, 0, 'up to date: nothing is rebuilt');
  bump(co, '46.0.0');
  const r = await b.refreshBundle({ bundle: out, checkout: co, execPath: '/x/Designer', env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-secret', ANTHROPIC_AUTH_TOKEN: 'tok' }, run });
  assert.equal(r.refreshed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, '/x/Designer');
  assert.deepEqual(calls[0].args, [join(co, 'scripts/make-app.mjs'), '--out', out, '--checkout', co]);
  assert.equal(calls[0].env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(!('ANTHROPIC_API_KEY' in calls[0].env) && !('ANTHROPIC_AUTH_TOKEN' in calls[0].env), 'no Anthropic credentials for the builder');
  const failing = await b.refreshBundle({ bundle: out, checkout: co, execPath: '/x/Designer', env: {}, run: async () => { throw Object.assign(new Error('x'), { stderr: 'boom: no space left' }); } });
  assert.equal(failing.refreshed, false);
  assert.match(failing.error, /boom: no space left/);
});

test('shim: finds the checkout it was built for, and says what to do when it is gone or moved', () => {
  const co = checkout();
  const res = tmp();
  const hooks = (checkoutPath: string) => writeFileSync(join(res, 'designer.json'), JSON.stringify({ format: 1, checkout: checkoutPath, electron: '45.3.4' }));
  hooks(co);
  assert.deepEqual(locate.locate({ resources: res, env: {} }), { ok: true, checkout: co });
  const moved = join(co, 'does-not-exist');
  hooks(moved);
  const gone = locate.locate({ resources: res, env: {} });
  assert.equal(gone.ok, false);
  assert.equal(gone.checkout, moved);
  assert.ok(gone.message.includes(moved), 'names the path it looked in');
  assert.match(gone.message, /npm run make-app/, 'says how to fix it');
  hooks(tmp()); // a folder that exists but is not Designer
  assert.equal(locate.locate({ resources: res, env: {} }).ok, false);
  assert.equal(locate.locate({ resources: tmp(), env: {} }).ok, false, 'no designer.json at all');
  assert.deepEqual(locate.locate({ resources: res, env: { DESIGNER_CHECKOUT: co } }), { ok: true, checkout: co }, 'override for testing');
  assert.equal(locate.isCheckout(co), true);
  assert.equal(locate.isCheckout(join(co, 'packages')), false);
});

test('the Anthropic credentials are still dropped before the server starts, and the shell still holds its safety checks', () => {
  // main.mjs imports electron so it cannot be loaded here; pin the lines that matter, as the desktop e2e does at run time.
  const main = readFileSync(join(desktop, 'main.mjs'), 'utf8');
  assert.match(main, /delete env\.ANTHROPIC_API_KEY/);
  assert.match(main, /delete env\.ANTHROPIC_AUTH_TOKEN/);
  assert.match(main, /mode: 0o700/);
  for (const must of ['webviewTag: false', 'sandbox: true', 'contextIsolation: true', 'nodeIntegration: false', 'requestSingleInstanceLock']) assert.ok(main.includes(must), must);
  // the shim starts no server; where it runs a child (the builder) it removes the credentials and never logs or reads them
  const shim = readFileSync(join(desktop, 'shim', 'main.cjs'), 'utf8');
  assert.match(shim, /delete env\.ANTHROPIC_API_KEY/);
  assert.match(shim, /delete env\.ANTHROPIC_AUTH_TOKEN/);
  assert.ok(!/console\.|appendFileSync\([^)]*ANTHROPIC/.test(shim), 'the shim logs nothing');
});
