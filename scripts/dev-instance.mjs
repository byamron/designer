#!/usr/bin/env node
// Run a copy of Designer next to your stable copy, on its own ports and data, so you can build Designer in Designer.
// See docs/self-hosting.md.
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE, defaultParents, findPorts, findWorktree, instanceEnv, instanceName, parseArgs } from './lib/dev-instance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let o;
try {
  o = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`dev-instance: ${e.message}\n\n${USAGE}`);
  process.exit(2);
}
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}

try {
  const dir = o.worktree ? findWorktree(o.stableData, o.worktree) : (o.dir ?? resolve(here, '..'));
  const pkg = join(dir, 'package.json');
  if (!existsSync(pkg) || JSON.parse(readFileSync(pkg, 'utf8')).name !== 'designer') throw new Error(`${dir} is not a Designer checkout`);
  const parents = o.parents.length ? o.parents : defaultParents();
  const data = o.data ?? join(homedir(), '.designer-chat-dev', instanceName(dir));

  const run = (cmd, args, cwd, label) => {
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${label} failed`);
  };
  if (!existsSync(join(dir, 'node_modules'))) {
    console.log(`[dev] installing dependencies in ${dir} (a new worktree has none; this takes a minute)…`);
    run('npm', ['install'], dir, 'npm install');
  }
  if (!o.watch) {
    console.log('[dev] building the UI…');
    run('npm', ['run', 'build'], dir, 'npm run build');
  }

  const port = await findPorts(o.port);
  const uiPort = o.watch ? await findPorts(port + 2) : undefined; // hot-reload UI server gets its own port
  const env = instanceEnv(process.env, { port, data, cwd: o.cwd ?? dir, parents, fake: o.fake, uiPort });
  const bin = (n) => join(dir, 'node_modules', '.bin', n);
  const children = [];
  const start = (name, cmd, args, cwd) => {
    const c = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(c);
    const pipe = (stream, out) => stream.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => out.write(`[${name}] ${l}\n`)));
    pipe(c.stdout, process.stdout);
    pipe(c.stderr, process.stderr);
    return c;
  };

  const server = start('server', bin('tsx'), o.watch ? ['watch', 'src/index.ts'] : ['src/index.ts'], join(dir, 'packages', 'server'));
  if (o.watch) start('ui', bin('vite'), [], join(dir, 'packages', 'web'));
  const listening = (p) =>
    new Promise((res) => {
      const tryOnce = (left) => {
        const c = connect(p, '127.0.0.1', () => (c.destroy(), res(true)));
        c.on('error', () => (left > 0 ? setTimeout(() => tryOnce(left - 1), 250) : res(false)));
      };
      tryOnce(120);
    });

  let printed = false;
  server.stdout.on('data', async (d) => {
    const m = /http:\/\/localhost:(\d+)\/\?t=([0-9a-f]{64})/.exec(String(d));
    if (!m || printed) return;
    printed = true;
    if (uiPort && !(await listening(uiPort))) console.error('[dev] the UI server did not start; see the [ui] lines above');
    const link = `http://localhost:${uiPort ?? m[1]}/?t=${m[2]}`;
    console.log(`
────────────────────────────────────────────────────────────
 Designer dev instance (${instanceName(dir)})
 Editing:   ${dir}
 Data:      ${data}   (separate from your stable chats)
 Open:      ${link}
 In your stable Designer: Preview → paste the link above to use it inside the preview pane.
 ${o.watch ? 'Hot reload: UI edits appear instantly without a reload; server edits restart this instance only.' : 'Not watching: restart to pick up changes.'}
 Stop with Ctrl-C.
────────────────────────────────────────────────────────────`);
  });

  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const c of children) {
      try {
        process.kill(-c.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    setTimeout(() => process.exit(code), 300);
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  server.on('exit', (code) => {
    if (!stopping) console.error(`[dev] server exited (${code}); stopping`);
    stop(code ?? 1);
  });
} catch (e) {
  console.error(`dev-instance: ${e.message}`);
  process.exit(1);
}
