---
description: Designer safety-critical paths — read before modifying.
paths:
  - "packages/server/src/index.ts"
  - "packages/server/src/adapter.ts"
  - "packages/server/src/claude.ts"
  - "packages/server/src/manager.ts"
  - "packages/server/src/auth.ts"
  - "packages/server/src/preview.ts"
  - "packages/server/src/proxy.ts"
  - "packages/server/src/store.ts"
  - "packages/server/src/*.test.ts"
  - "packages/web/src/auth.ts"
  - "packages/web/vite.config.ts"
  - "packages/desktop/**"
  - "e2e/ui.e2e.mjs"
  - "docs/security.md"
---

# Safety-Critical Code Rules

Loads when you touch one of the paths above. A regression here means a bypassed approval, a leaked credential, or the local server reachable by something other than the app. The threat model and its tests are in `docs/security.md`; read it first.

## Project safety-critical surfaces

- **`claude.ts`, `adapter.ts`, `manager.ts`** — the Claude Agent SDK boundary. Approvals are relayed from the SDK's `canUseTool` and enforced server-side; `manager.ts` routes the UI's `respond` message to `session.respond`, which must stay a no-op for request IDs Claude did not issue, so the UI can never approve what Claude Code did not ask. `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are stripped from the env passed to the SDK. Never read, store, proxy, or log subscription credentials (CLAUDE.md).
- **`index.ts`, `auth.ts`** — the local TCP server. `index.ts` binds 127.0.0.1 and holds the Host check (DNS rebinding), Origin and `sec-fetch-site` checks (cross-site WebSocket), the WebSocket upgrade gate, and the static-file traversal guard. `auth.ts` holds the private token (64 hex, 0600 file, stable across restarts until rotated by deleting the file; constant-time compare; header/query, never a cookie) and the page security headers. Browser-side: `packages/web/src/auth.ts`, and the dev-server CSP and `X-Frame-Options` in `packages/web/vite.config.ts`, which mirror `pageHeaders`.
- **`preview.ts`, `proxy.ts`** — previewed pages must stay on a different origin from the app and unable to open its WebSocket; `..` and symlink escapes stay blocked; the proxy is opt-in per target.
- **`store.ts`** — chat logs on disk are owner-only (0700 dirs, 0600 files).
- **`packages/desktop/`** — the Electron shell: locked-down window, supervision of the local server. `main.mjs` also deletes `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` before starting the server and creates the data dir at 0700; keep both.
- **`packages/server/src/*.test.ts`, `e2e/ui.e2e.mjs`** — these are the tests `docs/security.md` cites as pinning each mitigation. Weakening or deleting one is how a mitigation gets dropped silently.

Chat stays pass-through; approvals are the only intercept point (CLAUDE.md).

## Before modifying safety-critical code

1. Run `git log --oneline -5 -- <file>` to check for recent deliberate safety decisions.
2. If a recent commit mentions "security", "approval", "token", "origin", "escape", or "owner-only" — read that commit's diff to understand what was deliberately added.
3. Preserve safety behavior through rewrites. Where `docs/security.md` names a pinning test, keep it passing and add one for any new unsafe case. The approval gate has no named test today; changing it deserves one.

## When committing safety changes

- Optionally put `SAFETY` in the commit subject so the change is easy to grep for later (a convention of this rule, not of the PR protocol).
- Say in the PR body what safety behavior was preserved, modified, or added. `docs/security.md` may be edited when a safety change requires it; the shared docs the PR protocol lists (`plan.md`, `roadmap.md`, `README.md`, `CLAUDE.md`, ...) stay the orchestrator's.

## Never silently downgrade error handling

- Don't replace explicit error handling with silent fallbacks (swallowed errors, `catch {}`, errors turned into console logs).
- Don't convert user-facing warnings to debug-only logging.
- Don't remove validation without documenting why it's no longer needed.
