// Entry point inside Designer.app. All it does is find the Designer checkout and run its desktop shell
// (packages/desktop/main.mjs), so updating the checkout updates the app. Keep it tiny: it is the one part of the app that a
// git update cannot change (it is rebuilt by `npm run make-app` when the bundle format changes).
'use strict';
const { app, dialog } = require('electron');
const { execFile } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { isCheckout, locate } = require('./locate.cjs');

const resources = join(__dirname, '..');
const bundle = join(resources, '..', '..'); // .../Designer.app
const found = locate({ resources, env: process.env });

/** Tests answer by button label and record what was shown (same convention as the shell's own dialogs). */
async function ask(options) {
  if (process.env.DESIGNER_TEST_DIALOG) {
    if (process.env.DESIGNER_TEST_DIALOG_LOG) appendFileSync(process.env.DESIGNER_TEST_DIALOG_LOG, JSON.stringify({ message: options.message, detail: options.detail }) + '\n');
    const i = options.buttons.indexOf(process.env.DESIGNER_TEST_DIALOG);
    return i >= 0 ? i : (options.cancelId ?? 0);
  }
  return (await dialog.showMessageBox(options)).response;
}

/** Re-point this app at another checkout using that checkout's own builder, run as plain Node by this app's Electron. */
function rebuildFor(checkout) {
  return new Promise((res) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    execFile(process.execPath, [join(checkout, 'scripts', 'make-app.mjs'), '--out', bundle, '--checkout', checkout], { env, timeout: 300000 }, (err, _out, stderr) =>
      res(err ? String(stderr || err.message).trim().split('\n').slice(-4).join('\n') : undefined));
  });
}

async function explain(message) {
  for (;;) {
    const choice = await ask({ type: 'warning', message: "Designer can't start", detail: message, buttons: ['Choose Folder…', 'Quit'], defaultId: 0, cancelId: 1 });
    if (choice !== 0) return app.quit();
    const pick = await dialog.showOpenDialog({ title: 'Choose your Designer folder', properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) continue;
    const dir = pick.filePaths[0];
    if (!isCheckout(dir)) {
      message = `${dir}\nis not a Designer folder (it needs package.json named "designer" and packages/desktop).`;
      continue;
    }
    const failed = await rebuildFor(dir);
    if (failed) {
      message = `Couldn't point Designer at ${dir}:\n${failed}`;
      continue;
    }
    app.relaunch();
    return app.exit(0);
  }
}

if (found.ok) {
  import(pathToFileURL(join(found.checkout, 'packages', 'desktop', 'main.mjs')).href).catch((e) => {
    void app.whenReady().then(() => {
      dialog.showErrorBox("Designer can't start", String((e && e.stack) || e).split('\n').slice(0, 6).join('\n'));
      app.quit();
    });
  });
} else {
  app.setName('Designer');
  if (!app.requestSingleInstanceLock()) app.quit();
  void app.whenReady().then(() => explain(found.message));
  app.on('window-all-closed', () => {}); // a dialog is not a window; stay alive until the user chooses
}
