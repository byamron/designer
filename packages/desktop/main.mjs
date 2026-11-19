// Designer desktop shell. A thin supervisor: it starts the local Designer server, shows the app in a locked-down
// window, restarts the server if it crashes, and stops everything (including running agents) when you quit.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, dialog, screen, session, shell } from 'electron';
import { findPort, isSafeExternal, loginShellPath, mergePaths, restartDelay, sameOrigin, sanitizeBounds, updateEnv } from './lib.mjs';
import { applyUpdate, blocker, checkForUpdate } from './updater.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..'); // the checkout this app runs from
const DATA = process.env.DESIGNER_DATA ?? join(homedir(), '.designer-chat'); // same place as the browser version
if (process.env.DESIGNER_USER_DATA) app.setPath('userData', process.env.DESIGNER_USER_DATA); // tests keep their own settings

app.setName('Designer');
if (!app.requestSingleInstanceLock()) app.quit(); // a second launch just focuses the first window

let win;
let server;
let port;
let origin;
let quitting = false;
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
const dismissedFile = () => join(app.getPath('userData'), 'update-dismissed.txt');
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
  let dismissed;
  try { dismissed = readFileSync(dismissedFile(), 'utf8').trim(); } catch { /* never dismissed */ }
  if (!interactive && dismissed === c.remoteHead) return; // do not nag about a version you already said "Later" to
  const shown = c.commits.slice(0, 10).join('\n') + (c.commits.length > 10 ? `\n…and ${c.commits.length - 10} more` : '');
  const choice = await ask({
    type: 'info',
    message: `A new version of Designer is available (${c.behind} change${c.behind === 1 ? '' : 's'}).`,
    detail: `${shown}\n\nUpdating restarts Designer. Your chats are kept; a turn that is still running will be stopped.`,
    buttons: ['Update & Restart', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (choice !== 0) {
    try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(dismissedFile(), c.remoteHead); } catch { /* fine */ }
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
  quitting = true;
  await stopServer();
  app.relaunch();
  app.exit(0);
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: 'Designer', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Check for Updates…', click: () => void checkUpdates({ interactive: true }) }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [mac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' }, // copy and paste must work in the message box
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    ...(mac ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => void checkUpdates({ interactive: true }) }] }]),
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
  port = await findPort(Number(process.env.PORT ?? 4317));
  origin = `http://localhost:${port}`;
  try {
    await startServer();
    createWindow();
    if (!process.env.DESIGNER_NO_UPDATE_CHECK) setTimeout(() => void checkUpdates({ interactive: false }), 5000); // quiet; asks only if something new exists
  } catch (e) {
    createWindow();
    showFatal(e instanceof Error ? e.message : String(e));
  }
});
