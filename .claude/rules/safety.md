---
description: Designer safety-critical paths — read before modifying.
paths:
  - "packages/server/src/adapter.ts"
  - "packages/server/src/claude.ts"
  - "packages/server/src/auth.ts"
  - "packages/server/src/preview.ts"
  - "packages/server/src/proxy.ts"
  - "packages/server/src/store.ts"
  - "packages/desktop/**"
  - "docs/security.md"
---

# Safety-Critical Code Rules

Loads when you touch one of the paths above. A regression here means a bypassed approval, a leaked credential, or the local server reachable by something other than the app. The threat model and its tests are in `docs/security.md`; read it first.

## Project safety-critical surfaces

- **`adapter.ts`, `claude.ts`** — the Claude Agent SDK boundary. Approvals are relayed from the SDK's `canUseTool` and enforced server-side; the UI must never be able to approve what Claude Code did not ask. Strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the env passed to the SDK. Never read, store, proxy, or log subscription credentials (CLAUDE.md).
- **`auth.ts`** — the per-launch private token, Host and Origin checks. Constant-time compare; token in headers/query, never a cookie.
- **`preview.ts`, `proxy.ts`** — previewed pages must stay on a different origin from the app and unable to open its WebSocket; path escapes (`..`, symlinks) stay blocked; the proxy is opt-in per target.
- **`store.ts`** — chat logs on disk are owner-only (0700 dirs, 0600 files).
- **`packages/desktop/`** — the Electron shell: locked-down window, supervision of the local server.

Chat stays pass-through; approvals are the only intercept point (CLAUDE.md, `.claude/rules` if present).

## Before modifying safety-critical code

1. Run `git log --oneline -5 -- <file>` to check for recent deliberate safety decisions.
2. If a recent commit mentions "security", "approval", "token", "origin", "escape", or "owner-only" — read that commit's diff to understand what was deliberately added.
3. Preserve safety behavior through rewrites. Each mitigation in `docs/security.md` names the test that pins it; keep that test passing and add one for any new unsafe case.

## When committing safety changes

- Flag the change in the commit message with a `SAFETY` marker.
- Explain what safety behavior was preserved, modified, or added, and list it in the PR body (the PR protocol forbids editing the shared docs; the orchestrator updates them).

## Never silently downgrade error handling

- Don't replace explicit error handling with silent fallbacks (swallowed errors, `catch {}`, errors turned into console logs).
- Don't convert user-facing warnings to debug-only logging.
- Don't remove validation without documenting why it's no longer needed.
