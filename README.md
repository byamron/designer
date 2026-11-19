# Designer (fresh start)

A lean, local, single-user chat app that drives your own Claude Code (Agent SDK)
and Codex (`codex app-server`) using your existing subscription logins. No API
keys. Small, fast, boring; a coding harness gets built on top later.

Status: P0 (usable core) is built: local server + web UI over Claude Code.
See [docs/plan.md](docs/plan.md) for the roadmap.

## Run

Requires Node 22+ and a logged-in `claude` (run `claude login` once; no API key needed).

```sh
npm install
npm start            # builds the UI and prints a link: http://localhost:4317/?t=<private token>
# or, while developing:
npm run dev          # server on :4317
npm run dev -w @designer/web   # UI with hot reload on :5173
```

Env: `PORT`, `DESIGNER_DATA` (thread logs, default `~/.designer-chat`), `DESIGNER_CWD` (default folder in
the new-chat form), `DESIGNER_FAKE=1` (scripted provider, no Claude).

The link carries a private token that lets the page talk to the app. Open it once; the browser remembers it
(then plain `http://localhost:4317` works). See [docs/security.md](docs/security.md).

## Desktop app

```sh
npm run app          # builds the UI and opens Designer in its own window (no link to copy)
```
Designer > Check for Updates… pulls new versions of itself from `main`. See [docs/updates.md](docs/updates.md).

## Test

```sh
npm run typecheck
npm test                                   # server unit tests
xvfb-run -a node e2e/desktop.e2e.mjs        # desktop shell (Linux needs a display; macOS runs it directly)
e2e/run.sh                                 # browser tests: ui, focus rings, motion (needs Playwright; fresh server per suite)
```


The previous Designer app (Tauri/Rust/React) is preserved in git history at the
branch `archive/tauri-designer` (and tag `tauri-final`, both at commit `2195a3d`). Get it back with
`git switch archive/tauri-designer`, or read a file with `git show tauri-final:<path>`.

- [docs/self-hosting.md](docs/self-hosting.md): build Designer in Designer (stable copy + dev instance)
- [docs/updates.md](docs/updates.md): how updates reach the desktop app (Update & Restart, no reinstall)
- [docs/parallel-work.md](docs/parallel-work.md): projects that can be built at the same time, with specs and prompts
- [docs/roadmap.md](docs/roadmap.md): the path to a desktop app you can build Designer in
- [docs/security.md](docs/security.md): threat model and parity with Claude Code in a terminal
- [docs/plan.md](docs/plan.md): scope, architecture, history of what was built
- [docs/product.md](docs/product.md): who it is for and how it differs from other harnesses
- [docs/inspirations.md](docs/inspirations.md): what we learned from other projects, and the license rules we follow
- [docs/archive/](docs/archive/): kept from the old project (vision, critique)
