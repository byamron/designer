# Spec: one-click previews (links and a "Run" prompt)

**Decision (owner, 2026-11):** Claude can already start a dev server itself (shell command in the background) and say
where it is. Designer does not run servers. It makes that flow one click: pick up the URL Claude gives, open it in the
preview pane, and offer a one-click way to ask Claude to start (or restart) the server. Chat stays pass-through; no process
manager, no config files, nothing to keep in sync. Works identically in the browser version and the Electron app.

The earlier, heavier design (Designer spawns and supervises processes) is kept at the bottom as parked.

## Behavior
1. **Local links open in the preview pane.** `http://localhost:N…`, `127.0.0.1`, `[::1]` links in assistant messages, tool
   output and your own messages get an **Open in preview** affordance (click the link to open it in the pane; a small
   secondary control or modifier-click opens it in your browser instead). External links (other hosts) keep opening in the
   browser, with an optional "preview" icon.
2. **Suggest, don't act.** When a reply or command output contains a local URL, show a one-line chip under it:
   `Open localhost:5173 in preview`. One click opens the pane (if closed) and loads it. No auto-open by default; a setting
   "Open local links automatically" can come later.
3. **Run prompt.** In the preview bar's empty state and when the page is unreachable, a button **Ask Claude to start it**
   puts a ready message in the composer (editable, sent with Enter):
   `Start this project's dev server in the background (if it is not already running) and give me the URL.`
   When unreachable it says: `The preview at <url> is not responding. Please restart it and give me the URL.`
   Nothing is sent without your Enter.
4. **Worktree-aware (already true).** The pane remembers the last URL per workspace, so each worktree keeps its own.
5. **Reachability.** The pane shows a small status dot for URL previews (reachable / not), rechecked when you focus the
   pane or press reload; the unreachable state offers the restart prompt above.
6. **Token links.** A Designer dev-instance link (`…/?t=<token>`) opens like any other local link. The token is only that
   dev instance's, never the stable app's. (Chat logs will contain it; they are owner-only files.)

## Designer's own dev copy
Ask Claude: "run the dev copy for this worktree" and it runs `npm run dev-instance -- --worktree <name>` in the background.
The printed link becomes an **Open in preview** chip. No special code needed.

## Security
- Same rules as typing the URL into the address bar: the pane is a sandboxed frame on a different origin; only http(s)
  local addresses get the chip; `javascript:`/`file:`/other schemes are never linked.
- The restart prompt is just a message you send; it does not bypass approvals. Claude's own permission prompts still apply.

## Files (suggested)
- `packages/web/src/markdown.tsx`: link rendering (local-URL detection, open-in-preview vs external).
- `packages/web/src/store.ts`: `openPreview(workspaceId, url)`; Preview reads it (also opens the pane).
- `packages/web/src/Preview.tsx`: reachability dot, "Ask Claude to start it", unreachable state.
- A small pure helper `localUrls(text)` (unit-testable) used by messages and tool output.
- Chips: under assistant messages and in tool-run rows (tool output is already collapsible; scan its text).

## Acceptance tests (write first)
- `localUrls`: finds `http://localhost:5173/`, `localhost:3000` (bare form only inside code/command output), `127.0.0.1:8080/x`,
  `[::1]:4000`; ignores `localhost.evil.com`, `http://localhostfoo`, `file:///`, versions/ports in prose like `3000ms`.
- Browser (fake provider): a reply containing a localhost URL shows the chip; clicking opens the pane and loads it; the
  workspace remembers it; external links still open in a new tab; modifier-click/secondary control opens the browser.
- Unreachable URL shows the state and "Ask Claude to start it" fills the composer (does not send).
- Focus rings and reduced motion for the new controls (extend `focus` and `motion` suites).

## Needs the owner's Mac
A real dev server started by Claude on a real project; whether Claude's background server survives as long as you need
(if it dies when the session ends, that is where a supervised runner would earn its place).

## Parked: Designer-managed runner
Designer spawns and supervises the process itself (detect `package.json` scripts, `.designer/run.json`, `conductor.json`,
ports, log drawer, trust prompt, login-shell PATH, kill by process group). Only worth building if Claude-started servers prove
unreliable (die with the session, port clashes across many worktrees, no logs). Full notes are in git history of this file.
