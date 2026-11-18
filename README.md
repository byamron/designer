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
npm start            # builds the UI, serves http://localhost:4317
# or, while developing:
npm run dev          # server on :4317
npm run dev -w @designer/web   # UI with hot reload on :5173
```

Env: `PORT`, `DESIGNER_DATA` (thread logs, default `~/.designer-chat`), `DESIGNER_CWD` (default folder in
the new-chat form), `DESIGNER_FAKE=1` (scripted provider, no Claude).

## Test

```sh
npm run typecheck
npm test                                   # server unit tests
e2e/run.sh                                 # browser tests: ui, focus rings, motion (needs Playwright; fresh server per suite)
```


The previous Designer app (Tauri/Rust/React) is preserved in git history at the
tag `designer-final`. Browse it with `git show designer-final:<path>`.

- [docs/plan.md](docs/plan.md): scope, architecture, milestones
- [docs/product.md](docs/product.md): who it is for and how it differs from other harnesses
- [docs/inspirations.md](docs/inspirations.md): what we learned from other projects, and the license rules we follow
- [docs/archive/](docs/archive/): kept from the old project (vision, critique)
