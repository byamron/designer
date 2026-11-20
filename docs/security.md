# Security: parity with Claude Code in a terminal

**Goal:** running Claude Code through Designer should be as safe as running `claude` in a terminal or through
Conductor. Designer adds a local server and a browser UI that a terminal does not have; everything below is about
not letting that addition widen what can happen.

## What is identical to the terminal (and verified)
| Property | How we know |
|---|---|
| The agent is Anthropic's own Claude Code binary (via the Agent SDK), running as you | by construction |
| Your `~/.claude` and project `.claude` settings, deny rules, hooks and CLAUDE.md apply | SDK default loads all sources; **tested**: a project deny rule blocked a command even though our approval handler would have allowed it |
| Permission semantics are Claude Code's, not ours; we never auto-approve | we only relay its prompts; `Ask` is the default mode |
| Subscription login, no API key | `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` stripped; we never read, store or proxy credentials |

## What Designer adds, and what stops it
| Surface | Threat | Mitigation | Test |
|---|---|---|---|
| Local TCP server | Another local user/process, or a web page, drives the agent | Binds 127.0.0.1 only; **private token** required for the WebSocket and API (64 hex chars, 0600 file, constant-time compare); Host check (DNS rebinding); Origin check (cross-site WebSocket) | `security.test.ts` |
| Token in the browser | Previewed/proxied pages steal it | Kept in the app origin's `localStorage` (other ports are other origins); sent as a header/query, never a cookie, never embedded in a page | `security.test.ts`, `ui.e2e` |
| App page | Clickjacking, injected script | CSP (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, nosniff, no referrer, CORP same-origin | `security.test.ts` |
| Previewed pages (agent-written HTML) | Run code in a real browser next to the app | Served from a **different origin** (separate port); cannot open the app WebSocket; `..`/symlink escapes blocked | `preview.test.ts`, `ui.e2e` |
| Proxy for localhost/websites | SSRF, token leakage | Opt-in per Inspect; one proxy per target origin; API needs token + same-origin fetch; Host check; no Designer cookies exist to leak | `proxy.test.ts`, `security.test.ts` |
| Model/page text rendered in the UI | XSS | Markdown rendered to React elements, raw HTML shown as text; links limited to http(s)/mailto | by construction |
| Chat logs on disk | Secrets in tool output readable by others | Owner-only directories and files (0700/0600) | `server.test.ts` |
| Desktop shell window | A page (or a link) takes over the app window, or gets Node/permissions | Window may only show the app origin; other links go to the OS browser (http/https/mailto only); `file:` refused; sandboxed renderer, context isolation, no Node, permission prompts denied; no webviews | `e2e/desktop.e2e.mjs`, `desktop.test.ts` |
| Desktop shell launches the server | Anthropic credentials or loose permissions leak to the server | `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` removed from the server's environment; data directory created 0700 | `e2e/desktop.e2e.mjs` (reads the server's real environment) |
| Designer.app bundle | Running code from the wrong place, replacing another app, or leaking credentials through the builder | The bundle holds no Designer code: a shim imports `packages/desktop/main.mjs` from the one checkout whose path was recorded at build time by you (`DESIGNER_CHECKOUT` only overrides it for tests); builds are staged and swapped in atomically; an app that is not a Designer shell app is never replaced without `--force`; the app's child processes (`install.js`, the builder) get no `ANTHROPIC_*` variables; ad-hoc signed, not notarized | `desktopapp.test.ts`, `e2e/app.e2e.mjs` |
| Update & Restart (desktop shell) | Running attacker code, or damaging your checkout, via the update path | Only ever asks: nothing is applied without your click on a dialog that lists the incoming changes; fast-forward only from `origin/main` (no merge/rebase/force); refuses on a dirty, non-`main` or diverged copy; rolls back on failure and reports a failed restore; `npm` runs without Anthropic credentials | `desktop.test.ts` (real git repos) |
| Approvals | Frontend bypass | Enforced in the server via the SDK's `canUseTool`; a UI cannot approve what the CLI did not ask | adapter design |

## Residual risks (not worse than terminal, but worth knowing)
- **Update & Restart trusts `origin/main`.** Applying an update runs `npm install` and a build on whatever is on your repository's `main`,
  the same as `git pull && npm install` in a terminal. It never applies silently and shows the incoming changes first, but anyone with
  push access to `main` could ship code to you. Keep `main` protected (pull requests, no direct pushes) and review what you merge.
- **Same-user code.** Anything running as you can read the token file. It could also just run `claude` or any command
  directly, so this is not a new capability.
- **New input channels for prompt injection.** Text from web pages (inspector reports include element text/HTML) and from
  files the agent reads can contain instructions. The terminal has the file channel too; the page channel is new.
  Review pasted reports before sending, as you would any pasted text.
- **Proxy weakens the proxied page's own protections** (drops CSP and X-Frame-Options so the agent can run). Only used when
  you turn on Inspect for that URL.
- **Auto and Full access modes.** Auto is a model's judgement, not a boundary; Full access has no prompts. Same as the CLI flags.
- **No extra sandbox** beyond Claude Code's own permissions.
- **Dependencies.** Small tree, lockfile committed. `npm audit` currently reports one build-time-only advisory (picomatch)
  with no patched release.

## Not yet verified on a real Mac
Listed in [needs-local-testing.md](needs-local-testing.md): subscription login, auto mode on your plan, full-access flag.

## Re-check
`npm test` runs the security suite against a real server. Rotate the token by deleting `<data dir>/token` and restarting.
