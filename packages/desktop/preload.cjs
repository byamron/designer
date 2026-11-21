// The only thing the app page can ask of the desktop shell: "let me choose a folder". One function, no arguments, one channel;
// the main process checks who is asking (see isAppSender in lib.mjs) and answers with a path or null. Nothing else is exposed,
// nothing is passed from the page, and this file is not loaded in iframes (previews, dev instances).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('designerDesktop', Object.freeze({
  chooseFolder: () => ipcRenderer.invoke('designer:choose-folder'),
}));
