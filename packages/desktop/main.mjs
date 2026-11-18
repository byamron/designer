// Designer desktop shell. A thin supervisor: it starts the local Designer server, shows the app in a locked-down
// window, restarts the server if it crashes, and stops everything (including running agents) when you quit.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, screen, session, shell } from 'electron';
import { findPort, isSafeExternal, loginShellPath, mergePaths, restartDelay, sameOrigin, sanitizeBounds } from './lib.mjs';

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

function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [mac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' }, // copy and paste must work in the message box
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
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
  } catch (e) {
    createWindow();
    showFatal(e instanceof Error ? e.message : String(e));
  }
});
