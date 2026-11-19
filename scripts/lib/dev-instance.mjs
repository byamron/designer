// Helpers for scripts/dev-instance.mjs (kept separate so they can be unit tested).
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const USAGE = `Run a copy of Designer (usually a worktree you are editing) next to your stable copy.

  node scripts/dev-instance.mjs [options]        (or: npm run dev-instance -- [options])

  --dir <path>        the copy to run (default: the repo this script lives in)
  --worktree <name>   a worktree Designer created for you; found under <data>/worktrees/*/<name>
  --port <n>          first port to try (default 4500); the preview uses the next one
  --data <path>       data directory for this instance (default ~/.designer-chat-dev/<name>)
  --cwd <path>        folder the new-chat form suggests (default: the copy itself)
  --parent <origin>   app that may show this instance in its preview pane
                      (repeatable; default: the app that launched this, from DESIGNER_ORIGIN, else port 4317)
  --fake              scripted provider instead of real Claude (for trying the UI)
  --no-watch          serve a built UI and do not reload on changes (default: hot reload, edits show without a page reload)
  --help
`;

export function parseArgs(argv, env = process.env, home = homedir()) {
  const o = { parents: [], watch: true, fake: false, help: false, port: 4500 };
  const need = (i, flag) => {
    if (i >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--fake') o.fake = true;
    else if (a === '--no-watch') o.watch = false;
    else if (a === '--dir') o.dir = resolve(need(++i, a));
    else if (a === '--worktree') o.worktree = need(++i, a);
    else if (a === '--port') {
      o.port = Number(need(++i, a));
      if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65000) throw new Error('--port must be a number between 1024 and 65000');
    } else if (a === '--data') o.data = resolve(need(++i, a));
    else if (a === '--cwd') o.cwd = resolve(need(++i, a));
    else if (a === '--parent') o.parents.push(need(++i, a));
    else throw new Error(`unknown option ${a}`);
  }
  for (const p of o.parents) if (!isOrigin(p)) throw new Error(`--parent must look like http://localhost:4317 (got ${p})`);
  if (o.dir && o.worktree) throw new Error('use --dir or --worktree, not both');
  o.stableData = env.DESIGNER_DATA ?? join(home, '.designer-chat');
  return o;
}

export const isOrigin = (s) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(s);

/** The app that may show this instance in its preview pane: the one that launched it (DESIGNER_ORIGIN), else port 4317. */
export function defaultParents(env = process.env) {
  const o = env.DESIGNER_ORIGIN;
  if (o && isOrigin(o)) return [...new Set([o, o.replace('//localhost:', '//127.0.0.1:')])];
  return ['http://localhost:4317', 'http://127.0.0.1:4317'];
}

/** <stableData>/worktrees/<repo>/<name>: exactly one match, or a clear error. */
export function findWorktree(stableData, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`bad worktree name "${name}"`);
  const base = join(stableData, 'worktrees');
  const hits = [];
  if (existsSync(base)) for (const repo of readdirSync(base)) if (existsSync(join(base, repo, name))) hits.push(join(base, repo, name));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`no worktree "${name}" under ${base}. Create it in Designer first (the ⎇ + button next to the project).`);
  throw new Error(`"${name}" exists under several repos:\n  ${hits.join('\n  ')}\nUse --dir with one of them.`);
}

/** First port p (from `start`, stepping by 2) where p and p+1 are both free on loopback. */
export async function findPorts(start, tries = 50) {
  const free = (p) =>
    new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
    });
  for (let i = 0; i < tries; i++) {
    const p = start + i * 2;
    if (p + 1 > 65535) break;
    if ((await free(p)) && (await free(p + 1))) return p;
  }
  throw new Error(`no free pair of ports found starting at ${start}`);
}

/** Environment for the dev instance's server. Never forwards a stable instance's data dir or token. */
export function instanceEnv(base, { port, data, cwd, parents, fake, uiPort }) {
  const env = { ...base, PORT: String(port), DESIGNER_DATA: data, DESIGNER_CWD: cwd, DESIGNER_FRAME_ANCESTORS: parents.join(' ') };
  if (uiPort) {
    // hot-reload mode: the page comes from the Vite dev server, which proxies the API/WebSocket to this instance
    env.DESIGNER_DEV_PORT = String(uiPort);
    env.DESIGNER_UI_PORT = String(uiPort);
    env.DESIGNER_API_PORT = String(port);
  } else {
    delete env.DESIGNER_DEV_PORT;
    delete env.DESIGNER_UI_PORT;
    delete env.DESIGNER_API_PORT;
  }
  delete env.PREVIEW_PORT; // derive from PORT so the pair stays together
  if (fake) env.DESIGNER_FAKE = '1';
  else delete env.DESIGNER_FAKE;
  return env;
}

export const instanceName = (dir) => basename(resolve(dir));
