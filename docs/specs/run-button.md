# Spec: Run button (run a workspace and preview it)

**Goal:** one click starts whatever a workspace needs to run (a dev server, or a static page), shows it in the preview
pane, streams its log, and stops it cleanly. No terminal. It must work the same in the browser version and in the
Electron app, so all logic lives in the Node server and the UI is plain web UI.

Designer's own dev instance (`scripts/dev-instance.mjs`) becomes just one configuration of this.

## Why it fits the product
- Every worktree can run at once, each on its own port: that is the base for side-by-side variants later.
- Claude can create or fix the run configuration itself ("set up a run command for this project").
- The preview pane already shows any localhost URL; this feature supplies the URL.

## Behavior
1. A **Run** control in the preview bar for the active workspace. States: `Run` → `Starting…` (log tail visible) →
   `Running · localhost:PORT` with **Stop** and **Restart** → `Stopped` / `Failed` (with **View log**).
2. When the server reports a URL and it answers, the preview address is set to it and the page loads.
3. A collapsible **log drawer** under the preview shows the last 2,000 lines (stdout + stderr), live.
4. One run per workspace. Several workspaces can run concurrently.
5. Stopping kills the whole process tree (use a process group; the dev server's children must die too).
   Quitting the app, removing a workspace, or a crash of the app server stops its runs.
6. **Never auto-run.** The first time a workspace's command runs (and whenever the command changes) the UI shows the exact
   command and asks "Run this?". The answer is remembered for that workspace + command (hash). This matches how a terminal
   works: you saw what you ran. A command Claude edits later triggers the prompt again.

## How the command is chosen (first match wins)
1. `.designer/run.json` in the workspace: `{ "command": "npm run dev", "port": 5173, "env": {…}, "setup": "npm install" }`
   (all but `command` optional). Claude can write this file.
2. `conductor.json` → `scripts.run` (and `scripts.setup`) if present, so existing Conductor projects work unchanged.
   **Verify the exact schema against Conductor's docs before relying on it.**
3. Detect from `package.json`: scripts `dev`, then `start`; framework hints for the default port (vite 5173, next 3000,
   astro 4321, CRA 3000). Use the lockfile to pick the package manager (pnpm/yarn/bun/npm).
4. No runnable project but `.html` files: serve with the existing preview server (no process).
5. Otherwise: say so and offer "Ask Claude to set this up".

## Port and URL handling
- Allocate a free port on 127.0.0.1 and pass it: env `PORT`, `HOST=127.0.0.1`; for known frameworks also the flag
  (`vite --port N --strictPort`, `next dev -p N`). Do not rewrite arbitrary commands.
- Detect the URL by scanning output for `http://localhost:N` / `127.0.0.1:N` / `[::1]:N` (strip ANSI colors first); also
  accept the configured/allocated port. **Ready = URL seen and TCP connect succeeds.** Timeout 60 s → `Failed: no URL found`
  with a hint to set `port` in `.designer/run.json`.
- Setup command (if any) runs once per workspace before the first run, with its output in the same log.

## Desktop-app parity (design constraints, not extras)
- All of this runs in the Node server process, never the browser. The Electron app hosts the same server.
- **Spawn through the user's login shell** (`$SHELL -l -c "<command>"`), because an app started from the Dock does not
  inherit the terminal PATH (nvm, Homebrew, pnpm would be missing). Fall back to `/bin/zsh`.
- No dependency on a visible terminal, a TTY, or the current working directory of the server: always pass `cwd`.
- Child environment: the user's environment as a terminal would give it, minus `DESIGNER_*` variables and the app token.
  Add `DESIGNER_PARENT_ORIGIN=<this app's origin>` so a dev instance knows which app may frame it (update
  `scripts/dev-instance.mjs` to use it as the default for `--parent`).
- Kill by process group; handle app quit (`SIGTERM`/Electron `before-quit` → `RunManager.shutdown()`).
- Paths via `os.homedir()`/`path`, never hard-coded `/Users/...`.

## Security requirements (parity with running it in a terminal)
- Only the authenticated WebSocket can start/stop runs (existing token + Origin checks). No new HTTP endpoints.
- The command shown in the confirmation is exactly the command executed (no hidden wrapper beyond the login shell).
- Config files are data: a malicious repo cannot run anything until you click Run and approve that exact command.
- Log text is rendered as plain text (no HTML).
- Never log or expose the app token or the environment.

## Files (suggested)
- `packages/shared/src/index.ts`: types `RunState`, client messages `run_start | run_stop | run_restart | run_trust`,
  server messages `run_state | run_log`.
- `packages/server/src/run.ts`: `RunManager` (detect, spawn, ports, URL scan, readiness, ring buffer, shutdown).
  `packages/server/src/run-detect.ts`: pure detection (easy to unit test).
- `packages/server/src/manager.ts`: wire WS messages and workspace removal/shutdown to `RunManager`.
- `packages/web/src/RunBar.tsx` (+ log drawer) used by `Preview.tsx`; store handling in `store.ts`.
- `.designer/run.json` for this repo: the dev-instance command, so Designer can run itself with the button.
- Docs: update `docs/self-hosting.md` (the button replaces terminal 2), `docs/roadmap.md`.

## Acceptance tests (write these first)
Server (`node:test`, no real dev servers needed; use a tiny fake dev server script that prints a URL after a delay):
- Detection order and package-manager choice; framework port hints; `conductor.json` mapping; no-project cases.
- URL scanner: ANSI-colored output, `localhost`/`127.0.0.1`/`[::1]`, ignores unrelated numbers.
- Lifecycle: starting → ready only after the port answers; timeout path; stop kills children (a child that spawns a grandchild
  leaves nothing running); restart; crash → `Failed` with log; two workspaces run on different ports at once.
- Trust: command not run until approved; changing the command re-prompts.
- Env: `DESIGNER_*` and the token are not in the child's environment; `PORT`/`HOST` are.
- Shutdown stops everything.
Browser (`e2e/run.e2e.mjs`, fake dev server):
- Run → confirm prompt shows the command → Starting → Running; the preview shows the page; log drawer streams lines.
- Stop and Restart work; the page goes away on Stop; a second workspace runs concurrently.
- Focus rings and reduced motion for the new controls (extend the existing focus/motion suites).
Self-hosting: with `.designer/run.json`, clicking Run in the stable app on a Designer worktree shows the dev instance in
the preview pane (extend `e2e/selfhost.e2e.mjs`).

## Not in scope (put in `docs/roadmap.md` if wanted later)
Docker/compose, multiple processes per workspace, auto-run on open, remote machines, port forwarding UI, framework plugins
beyond the detection list, side-by-side variants UI (this feature only makes it possible).

## Needs the owner's Mac (add to `docs/needs-local-testing.md`)
Login-shell PATH with the owner's real node setup; a real Vite/Next project; killing a real dev server tree; run from the
Electron app once it exists.
