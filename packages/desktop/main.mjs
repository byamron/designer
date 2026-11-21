// Designer desktop shell. A thin supervisor: it starts the local Designer server, shows the app in a locked-down
// window, restarts the server if it crashes, and stops everything (including running agents) when you quit.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, dialog, screen, session, shell } from 'electron';
import { findPort, isSafeExternal, loginShellPath, mergePaths, restartDelay, sameOrigin, sanitizeBounds, updateEnv } from './lib.mjs';
import { refreshBundle, runningBundle, staleReason } from './bundle.mjs';
import { applyUpdate, blocker, checkForUpdate } from './updater.mjs';

// update bookkeeping and rollback live in plain CommonJS so the launcher inside Designer.app can use them when this file cannot even load
const rb = createRequire(import.meta.url)('./shim/rollback.cjs');
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..'); // the checkout this app runs from
const DATA = process.env.DESIGNER_DATA ?? join(homedir(), '.designer-chat'); // same place as the browser version
if (process.env.DESIGNER_USER_DATA) app.setPath('userData', process.env.DESIGNER_USER_DATA); // tests keep their own settings

app.setName('Designer');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit(); // a second launch just focuses the first window

let win;
let server;
let port;
let origin;
let quitting = false;
let serverUp = false; // the server answered, so a loaded page is a working app
const crashes = [];

const pidFile = () => join(DATA, 'desktop-server.pid');

/** Tests replace the OS call so they can see which links would have been opened outside the app. */
function openExternal(url) {
  if (!isSafeExternal(url)) return;
  if (process.env.DESIGNER_TEST_EXTERNAL_LOG) appendFileSync(process.env.DESIGNER_TEST_EXTERNAL_LOG, url + '\n');
  else void shell.openExternal(url);
}

async function startServer() {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), DESIGNER_DATA: DATA };
  env.PATH = mergePaths(process.env.PATH, await loginShellPath());
  delete env.ANTHROPIC_API_KEY; // the server strips these too; never even hand them over
  delete env.ANTHROPIC_AUTH_TOKEN;
  const entry = join(ROOT, 'packages', 'server', 'src', 'index.ts');
  server = spawn(process.execPath, ['--import', 'tsx', entry], { cwd: join(ROOT, 'packages', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  writeFileSync(pidFile(), String(server.pid));
  let ready = false;
  const onData = (d) => {
    if (!ready && /Open this link once/.test(String(d))) ready = true;
    if (process.env.DESIGNER_DESKTOP_DEBUG) process.stdout.write(`[server] ${d}`);
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
  server.on('exit', (code) => {
    if (quitting) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    const delay = restartDelay(crashes.length - 1);
    if (delay === null) return void showFatal(`The Designer server keeps stopping (exit code ${code}). Quit and start Designer again; if it repeats, run it from a terminal to see why.`);
    setTimeout(() => !quitting && void startServer(), delay); // same port and token: the page reconnects by itself
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('the server did not start within 60 seconds')), 60_000);
    const poll = setInterval(() => ready && (clearInterval(poll), clearTimeout(t), res()), 50);
  });
}

function readToken() {
  return readFileSync(join(DATA, 'token'), 'utf8').trim();
}

function showFatal(message) {
  const html = `<meta charset=utf-8><body style="font:15px system-ui;max-width:520px;margin:12vh auto;padding:0 24px;line-height:1.5"><h2>Designer can't start</h2><p>${message.replace(/[<&]/g, '')}</p>`;
  if (win && !win.isDestroyed()) void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  void offerRollbackAfterFailures(); // an update that leaves the app unable to start must not need a terminal to undo
}

const stateFile = () => join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try {
    return sanitizeBounds(JSON.parse(readFileSync(stateFile(), 'utf8')), screen.getAllDisplays().map((d) => d.workArea));
  } catch {
    return undefined;
  }
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(win.getBounds()));
  } catch {
    /* losing window position is harmless */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 760, minHeight: 520, title: 'Designer', show: false,
    ...loadBounds(),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  let t;
  const later = () => (clearTimeout(t), (t = setTimeout(saveBounds, 400)));
  win.on('resize', later);
  win.on('move', later);
  win.on('close', saveBounds);

  // The window may only ever show the app itself. Everything else opens in your browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (sameOrigin(url, origin) || url.startsWith('data:text/html')) return;
    e.preventDefault();
    openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => (openExternal(url), { action: 'deny' }));
  // the app counts as working on this version once its page has loaded from a running server (see offerRollbackAfterFailures)
  if (serverUp) win.webContents.once('did-finish-load', () => { try { rb.markHealthy(app.getPath('userData')); } catch (e) { console.error(`could not record that this version started: ${e.message}`); } });
  void win.loadURL(`${origin}/?t=${readToken()}`); // the page keeps the token in its own storage and removes it from the address
}

// ---------- updates: pull the new version of this checkout, rebuild, relaunch ----------
/** A native dialog (so the web page needs no extra powers). Tests answer by button label and record what was shown. */
async function ask(options) {
  if (process.env.DESIGNER_TEST_DIALOG) {
    if (process.env.DESIGNER_TEST_DIALOG_LOG) appendFileSync(process.env.DESIGNER_TEST_DIALOG_LOG, JSON.stringify({ message: options.message, detail: options.detail }) + '\n');
    const i = options.buttons.indexOf(process.env.DESIGNER_TEST_DIALOG);
    return i >= 0 ? i : (options.cancelId ?? 0);
  }
  const r = await (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  return r.response;
}
const updatable = () => existsSync(join(ROOT, '.git'));

async function checkUpdates({ interactive }) {
  if (!updatable()) return interactive ? void (await ask({ type: 'info', message: "Updates aren't available for this install.", buttons: ['OK'] })) : undefined;
  let c;
  try {
    c = await checkForUpdate({ root: ROOT });
  } catch (e) {
    return interactive ? void (await ask({ type: 'warning', message: "Couldn't check for updates.", detail: String(e.stderr || e.message).trim().split('\n').slice(-3).join('\n'), buttons: ['OK'] })) : undefined;
  }
  const why = blocker(c);
  if (why) {
    if (interactive) await ask({ type: why === 'Already up to date.' ? 'info' : 'warning', message: why === 'Already up to date.' ? "You're up to date." : "Designer can't update this copy.", detail: why === 'Already up to date.' ? undefined : why, buttons: ['OK'] });
    return;
  }
  if (rb.skipQuietly({ interactive, dismissed: rb.readDismissed(app.getPath('userData')), remoteHead: c.remoteHead })) return; // do not nag about a version you already said "Later" to, or just rolled back from
  const shown = c.commits.slice(0, 10).join('\n') + (c.commits.length > 10 ? `\n…and ${c.commits.length - 10} more` : '');
  const choice = await ask({
    type: 'info',
    message: `A new version of Designer is available (${c.behind} change${c.behind === 1 ? '' : 's'}).`,
    detail: `${shown}\n\nUpdating restarts Designer. Your chats are kept; a turn that is still running will be stopped.`,
    buttons: ['Update & Restart', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (choice !== 0) {
    try { rb.writeDismissed(app.getPath('userData'), c.remoteHead); } catch { /* fine */ }
    return;
  }
  await installUpdate();
}

async function installUpdate() {
  const logFile = join(app.getPath('userData'), 'update.log');
  const log = (t) => { try { appendFileSync(logFile, `${new Date().toISOString()} ${t}\n`); } catch { /* fine */ } };
  const env = updateEnv(process.env, await loginShellPath()); // no Anthropic credentials for npm install scripts
  win?.setProgressBar(2); // indeterminate
  const r = await applyUpdate({ root: ROOT, env, progress: (t) => (log(t), win?.setTitle(`Designer: ${t}`)) });
  win?.setProgressBar(-1);
  win?.setTitle('Designer');
  log(r.ok ? `updated ${r.from} -> ${r.to}` : `failed: ${r.error}`);
  if (!r.ok) return void (await ask({ type: 'error', message: "Designer couldn't update.", detail: r.error, buttons: ['OK'] }));
  // remember where we came from, so Designer > Roll Back to Previous Version… can undo this update without a terminal
  try { rb.recordUpdate(app.getPath('userData'), { from: r.from, to: r.to, installed: r.installed, electron: r.electron }); } catch (e) { log(`could not record the previous version: ${e.message}`); }
  quitting = true;
  await stopServer();
  await refreshShell({ closeWindow: true }); // a new Electron version needs a new app shell (only when running as Designer.app)
  app.relaunch();
  app.exit(0);
}

// ---------- rolling back: the mirror image of an update ----------
let rollbackAvailable = false;
let lastStatus = 0;
/** Keep the menu item honest: enabled only when a previous version is recorded and this copy is clean, on main and still at the updated version. */
async function refreshRollback() {
  if (!updatable()) return;
  lastStatus = Date.now();
  const now = (await rb.rollbackStatus({ root: ROOT, userData: app.getPath('userData') })).available;
  if (now !== rollbackAvailable) (rollbackAvailable = now, buildMenu());
}

/** `broken`: the app could not start after an update; the wording says so. Nothing happens without the confirmation. */
async function rollBack({ broken = false } = {}) {
  const userData = app.getPath('userData');
  const st = await rb.rollbackStatus({ root: ROOT, userData });
  if (!st.available) return void (await ask({ type: 'warning', message: "Designer can't roll back right now.", detail: st.why, buttons: ['OK'] }));
  const now = await rb.describeVersion({ root: ROOT, sha: st.record.to });
  const back = await rb.describeVersion({ root: ROOT, sha: st.record.from });
  const choice = await ask({
    type: 'warning',
    message: broken ? "Designer isn't starting since its last update. Roll back to the previous version?" : 'Roll back Designer to the previous version?',
    detail: `Now:  ${now}\nBack to:  ${back}\n\nYour chats and settings are kept. A turn that is still running will be stopped. Designer restarts.${st.record.installed ? '\nThe previous dependencies are reinstalled, which takes about a minute.' : ''}`,
    buttons: ['Roll Back & Restart', 'Cancel'], defaultId: 1, cancelId: 1,
  });
  if (choice !== 0) return;
  win?.setProgressBar(2);
  const r = await rb.rollbackToPrevious({ root: ROOT, userData, env: updateEnv(process.env, await loginShellPath()), progress: (t) => win?.setTitle(`Designer: ${t}`) });
  win?.setProgressBar(-1);
  win?.setTitle('Designer');
  if (!r.ok) return void (await ask({ type: 'error', message: "Designer couldn't roll back.", detail: r.error, buttons: ['OK'] }));
  quitting = true;
  await stopServer();
  await refreshShell({ closeWindow: true }); // the previous version may want the previous Electron
  app.relaunch();
  app.exit(0);
}

/** Two starts in a row that never got to a working window, on a version Designer installed: offer the way back from the error. */
async function offerRollbackAfterFailures() {
  if (!updatable() || !rb.shouldOfferOnFailure(rb.readRecord(app.getPath('userData')))) return;
  await rollBack({ broken: true });
}

// ---------- Designer.app: the bundle is a copy of Electron, so it must follow the checkout's Electron version ----------
const bundlePath = runningBundle(process.execPath); // null when started with `npm run app`
/**
 * Rebuild Designer.app if it no longer matches the checkout (Electron version bump). The old app survives any failure, so
 * this never leaves you without a working Designer; a failure is logged and the next launch offers to retry.
 */
async function refreshShell({ closeWindow }) {
  if (!bundlePath || !staleReason({ bundle: bundlePath, checkout: ROOT })) return { refreshed: false };
  if (closeWindow) win?.destroy(); // no new renderer may start from a bundle that is about to be replaced
  const r = await refreshBundle({ bundle: bundlePath, checkout: ROOT, execPath: process.execPath, env: updateEnv(process.env, await loginShellPath()) });
  try { appendFileSync(join(app.getPath('userData'), 'update.log'), `${new Date().toISOString()} app shell: ${r.refreshed ? 'rebuilt' : r.error ?? 'current'}\n`); } catch { /* fine */ }
  return r;
}

/** At launch: if the app shell is out of date (for example the checkout was updated in a terminal), offer to rebuild it. */
async function checkShell() {
  const why = bundlePath && staleReason({ bundle: bundlePath, checkout: ROOT });
  if (!why) return;
  const choice = await ask({ type: 'info', message: 'Designer needs to rebuild its app.', detail: `${why}\n\nThis takes a few seconds and restarts Designer. Your chats are kept.`, buttons: ['Rebuild & Restart', 'Later'], defaultId: 0, cancelId: 1 });
  if (choice !== 0) return;
  win?.setTitle('Designer: rebuilding the app…');
  const r = await refreshShell({ closeWindow: false }); // nothing is replaced unless the whole build succeeded, so a failure leaves everything running
  win?.setTitle('Designer');
  if (!r.refreshed) return void (await ask({ type: 'error', message: "Designer couldn't rebuild its app.", detail: `${r.error ?? 'Nothing was rebuilt.'}\n\nRun "npm run make-app" in ${ROOT}.`, buttons: ['OK'] }));
  quitting = true;
  await stopServer();
  app.relaunch();
  app.exit(0);
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: 'Designer', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Check for Updates…', click: () => void checkUpdates({ interactive: true }) }, { label: 'Roll Back to Previous Version…', enabled: rollbackAvailable, click: () => void rollBack() }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [mac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' }, // copy and paste must work in the message box
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    ...(mac ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => void checkUpdates({ interactive: true }) }, { label: 'Roll Back to Previous Version…', enabled: rollbackAvailable, click: () => void rollBack() }] }]),
  ]));
}

function stopServer() {
  return new Promise((res) => {
    if (!server || server.exitCode !== null) return res();
    const kill = setTimeout(() => server.kill('SIGKILL'), 4000);
    server.once('exit', () => (clearTimeout(kill), res()));
    server.kill('SIGTERM'); // the server stops running agents and previews on SIGTERM
  });
}

app.on('second-instance', () => {
  if (win) (win.isMinimized() && win.restore(), win.focus());
});
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  void stopServer().then(() => app.quit());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => !win?.isDestroyed() && BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on('web-contents-created', (_e, contents) => contents.on('will-attach-webview', (e) => e.preventDefault()));

app.whenReady().then(async () => {
  // No camera, microphone, location or notification access: the app does not need it (dictation is the OS's own).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  buildMenu();
  try { if (gotLock) rb.noteLaunch(app.getPath('userData')); } catch (e) { console.error(`could not count this start: ${e.message}`); } // a version that never reaches a working window is counted
  void refreshRollback();
  app.on('browser-window-focus', () => Date.now() - lastStatus > 2000 && void refreshRollback()); // you may have just cleaned (or dirtied) the copy
  port = await findPort(Number(process.env.PORT ?? 4317));
  origin = `http://localhost:${port}`;
  try {
    await startServer();
    serverUp = true;
    createWindow();
    if (!process.env.DESIGNER_NO_UPDATE_CHECK) setTimeout(() => void checkUpdates({ interactive: false }), 5000); // quiet; asks only if something new exists
    setTimeout(() => void checkShell(), 2000);
  } catch (e) {
    createWindow();
    showFatal(e instanceof Error ? e.message : String(e));
  }
});
