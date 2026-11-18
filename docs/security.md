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
| Approvals | Frontend bypass | Enforced in the server via the SDK's `canUseTool`; a UI cannot approve what the CLI did not ask | adapter design |

## Residual risks (not worse than terminal, but worth knowing)
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
