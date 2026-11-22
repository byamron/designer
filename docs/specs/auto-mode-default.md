# auto-mode-default (written after the code; see the PR body)

**Mode:** normal. **Goal:** new workspaces and new chats start in Auto permission mode, so the owner is not asked
about every edit and command; Claude still asks when it cannot decide.

**Scope in:** the default `permissionMode` on new threads (`manager.ts` `newThread`); the docs row that names the default
(`docs/security.md`); tests that pin it.
**Scope out:** migrating chats saved without a mode; changing the mode list or the Composer UI; changing how the SDK
mismatch error is shown; a shared default constant.

**Assumptions (confidence):**
- HIGH: `newThread` is the only place a thread is created, so one change covers workspaces, worktrees and extra sessions.
- HIGH: chats saved without a mode resume in `'default'` (Ask) via the existing fallback, so nothing loosens silently.
- HIGH (was MEDIUM): Auto is available on the owner's account/plan. Verified by starting the Agent SDK with `permissionMode: 'auto'` using
  Designer's own session options: it reported `permissionMode=auto` on `claude-sonnet-5-5` and the turn finished. This does not
  exercise the full app, so one real new chat in a built Designer is still a good last look.

**Spec-walk:**
- [ ] A thread created by adding a folder has `permissionMode` `auto` in its stored metadata. → verify: `server.test.ts` "new workspaces and new sessions start in auto permission mode"
- [ ] A second session created in the same workspace has `permissionMode` `auto`. → verify: same test
- [ ] Sending the first message starts the adapter with `permissionMode` `auto`. → verify: same test (adapter start is recorded)
- [ ] In the browser, the Permissions select reads `auto` right after Add folder, before any message is sent. → verify: `e2e/run.sh ui`, "new workspace: Permissions select reads Auto"
- [ ] A thread stored without a `permissionMode` still resumes in `default` (Ask). → verify: `server.test.ts` "a chat saved without a permission mode keeps asking" (mode-less meta, send, adapter receives `default`)
- [ ] `docs/security.md` no longer says Ask is the default and still says calls Auto cannot decide reach the Allow/Deny cards. → verify: read the "Permission semantics" row
- [ ] The approval relay is untouched: the diff does not touch `respond`, `canUseTool` or `claude.ts`. → verify: `git diff origin/main...HEAD --stat` lists none of them (no named test pins the `respond` no-op today, per safety.md; this change does not alter it)

**Safety:** modified: default permission mode for new chats, Ask → Auto (a loosening the owner asked for; Claude's own classifier
decides, undecidable calls still reach our Allow/Deny cards). Preserved: the approval relay and `respond` no-op, and the Ask
fallback for chats saved without a mode. Added: tests for both defaults.

**Visual-walk:** N/A — no visual change; the select already offered Auto, only its initial value differs.

**Files touched:** `packages/server/src/manager.ts`, `packages/server/src/server.test.ts`, `packages/web/src/Composer.tsx` (comment),
`e2e/ui.e2e.mjs`, `docs/security.md`.

**Risks:** Auto unavailable on another account or plan (noisy error on every new chat, or a failed first send if the SDK throws). Not the case on the owner's account (see assumptions).
