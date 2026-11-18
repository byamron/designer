import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// Hot-reload dev server. Defaults suit `npm run dev`; scripts/dev-instance.mjs overrides the ports and the parent
// app that may show this page in its preview pane.
const here = dirname(fileURLToPath(import.meta.url));
const uiPort = Number(process.env.DESIGNER_UI_PORT ?? 5173);
const apiPort = Number(process.env.DESIGNER_API_PORT ?? 4317);
const ancestors = (process.env.DESIGNER_FRAME_ANCESTORS ?? '').split(/\s+/).filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o));

// node_modules may be a symlink to another checkout's (tests do this); let Vite serve from where it really lives
let modulesRoot = resolve(here, '../../node_modules');
try {
  modulesRoot = realpathSync(modulesRoot);
} catch {
  /* not installed here: the default allow list applies */
}

export default defineConfig({
  plugins: [react()],
  cacheDir: resolve(here, '.vite'),
  server: {
    host: '127.0.0.1',
    port: uiPort,
    strictPort: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), dirname(modulesRoot)] },
    // same rule as the production page: framed only by the listed app (default: never)
    headers: {
      'Content-Security-Policy': `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
      ...(ancestors.length ? {} : { 'X-Frame-Options': 'DENY' }),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
    proxy: { '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true }, '/api': `http://127.0.0.1:${apiPort}` },
  },
});
