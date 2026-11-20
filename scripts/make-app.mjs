#!/usr/bin/env node
// Build Designer.app: a double-clickable app that runs THIS checkout. See docs/specs/designer-app.md and docs/updates.md.
//   npm run make-app                       -> /Applications/Designer.app
//   npm run make-app -- --out ~/Applications/Designer.app
// Needs macOS, and `npm install` already run here (it copies the Electron that npm installed).
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../packages/desktop/bundle.mjs';

const USAGE = `Usage: npm run make-app -- [--out <path/to/Designer.app>] [--checkout <dir>] [--force]

  --out       where to put the app (default /Applications/Designer.app)
  --checkout  the Designer checkout the app runs and updates (default: this one)
  --force     replace an app at --out that is not a Designer shell app (never needed to rebuild your own)`;

const here = dirname(fileURLToPath(import.meta.url));
const o = { out: '/Applications/Designer.app', checkout: resolve(here, '..'), force: false };
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) {
  const take = () => a[++i] ?? (console.error(`make-app: ${a[i - 1]} needs a value\n\n${USAGE}`), process.exit(2));
  if (a[i] === '--out') o.out = take();
  else if (a[i] === '--checkout') o.checkout = take();
  else if (a[i] === '--force') o.force = true;
  else if (a[i] === '--help' || a[i] === '-h') (console.log(USAGE), process.exit(0));
  else (console.error(`make-app: unknown option ${a[i]}\n\n${USAGE}`), process.exit(2));
}
o.out = resolve(o.out.replace(/^~(?=\/|$)/, homedir()));
if (process.platform !== 'darwin') (console.error('make-app: Designer.app can only be built on macOS.'), process.exit(1));

try {
  const r = await buildBundle(o);
  console.log(`Built ${r.out}\n  runs the code in ${r.checkout}\n  Electron ${r.electron}\nOpen it from Finder, or: open "${r.out}"`);
} catch (e) {
  console.error(`make-app: ${e.message}`);
  process.exit(1);
}
