# Needs testing on the owner's Mac

Built and tested in a Linux cloud container. These are things that container cannot prove. Tick them off
when checked on a real machine; do not build further on an unchecked item without saying so.

## Verified in the container (for reference)
Server unit tests (16), browser tests against a scripted provider, real Claude through the server (streaming,
tool calls, approval deny, interrupt, resume after restart), real `git worktree` create/remove.

## To verify locally
- [ ] **Subscription login.** With no `ANTHROPIC_API_KEY` set and `claude login` done, a chat works and no
      "using key instead of your subscription" warning appears. (Container auth differs, so `apiKeySource`
      there proves nothing.)
- [ ] **Stripped env really wins.** With `ANTHROPIC_API_KEY` exported in your shell, the app still uses the
      login (the adapter removes it), and usage shows against the subscription.
- [ ] **Stop behavior.** Stop during a long tool run and during streaming; check for a stray extra reply after Stop.
- [ ] **Real approvals feel.** Default mode prompts for the things you expect; "auto-accept edits" and full access
      behave as labelled.
- [ ] **Worktrees on your repos.** Create a worktree from a real project (with submodules, large repo, uncommitted
      changes in the main folder). Check where it lands (`~/.designer-chat/worktrees/<repo>/<name>`) and that
      removing a dirty one is refused.
- [ ] **Safari / Chrome behavior.** Scroll follow/detach with a trackpad (momentum scrolling), mobile-width layout is not
      designed. The container only tested Chromium with a mouse wheel.
- [ ] **Long real sessions.** Memory and smoothness over hundreds of messages and large tool outputs.
- [ ] **Port 4317 / Host check** works with how you open it (localhost vs 127.0.0.1; other hostnames are refused).

- [ ] **Preview in your real browser/workflow.** Open an agent-written HTML file and a running dev server
      (e.g. `localhost:3000` with hot reload) in the pane; check HMR still works inside the iframe and that the
      pane refresh on turn end does not fight it (it only reloads file previews, not URLs).
- [ ] **Preview port.** Port 4318 (app port + 1) is free on your machine; otherwise set `PREVIEW_PORT`.
- [ ] **Split handle feel.** Dragging with a trackpad, with an iframe under the pointer (we capture the pointer
      so this should hold, only tested with a mouse in Chromium).
- [ ] **Quote in Safari/Chrome.** Selection and the floating Quote button positioning, including selections
      that span several paragraphs or code blocks.
- [ ] **Sites that block framing** (Paper, Figma, most SaaS): confirm the message appears and "Open in new tab"
      works. Showing them inline needs the desktop shell (later).

- [ ] **How the motion and speed actually feel.** The container can check that animations run, in what order,
      and that text is revealed over several frames; it cannot judge whether the easing, durations and the
      reveal speed feel right. Tell us which feel too slow, too fast or distracting.
- [ ] **Timer and indicator on a real long task** (a multi-minute run): does the phase label stay accurate,
      does the timer survive a page reload mid-run (it is measured from your message's timestamp).
- [ ] **Jump to latest with a trackpad**, including momentum scrolling right after the click.
- [ ] **Focus rings in Safari** (the automated check runs in Chromium; Safari draws outlines slightly differently).

- [ ] **Auto mode on your account.** Pick "Auto: Claude decides" and ask for a bash command and a file edit; check it
      runs without prompts for ordinary work and still asks for something risky. If your plan/model does not support
      it, you should see a notice saying which mode Claude is actually in.
- [ ] **Full access mode.** We now pass the SDK's explicit acknowledgement flag; confirm it starts without errors
      (the container is a hosted session, where the SDK behaves differently).

- [x] **Self-hosting loop on your Mac** (owner confirmed it worked, 2026-11) ([self-hosting.md](self-hosting.md)): stable clone, worktree, `npm run dev-instance`,
      dev instance visible in the Preview pane, one real change merged and promoted. First run of `npm install` in a
      worktree, and that a real Claude edit shows up after a UI rebuild.

- [ ] **Hot reload feel** (`npm run dev-instance -- --worktree <name>`, now on Vite's dev server): edit the UI through Claude and
      watch the preview pane update in place; check it keeps what you typed and that server edits restart cleanly.

- [ ] **Desktop shell on your Mac** (`npm run app`): window opens with the app, no link to copy, closing and reopening from the Dock,
      Cmd-Q stops everything, copy/paste in the message box, links open in your browser, a second launch focuses the first.
- [ ] **PATH from the Dock**: Claude can run `node`, `npm`, `git`, Homebrew tools when the app is launched from the Dock or Spotlight.
- [ ] **Update flow** ([updates.md](updates.md)): merge a PR on GitHub, then Designer > Check for Updates…, Update & Restart; chats survive; a
      dirty or non-main copy is refused with a clear message.

## Not buildable or testable here (later phases)
- macOS desktop shell (Tauri vs Electron spike), signing, webview comment overlay.
- Embedding and commenting on Paper or other external sites.
- System dictation into the composer.
- Codex adapter: needs a Codex login; the container has none.
- Devin handoff: needs a Devin account and API key; build against a fake server first, verify live on the owner's machine.

## From the PRs landed 2026-11-19
- [ ] **Real dev server started by Claude** (previews): ask Claude to start a dev server from chat; the URL becomes a chip and loads in the pane.
- [ ] **Does Claude's background server survive long enough?** If it dies with the session, that is where a supervised runner would earn its place.
- [ ] **Images: macOS clipboard paste** (Cmd-Ctrl-Shift-4, then Cmd-V into the message box).
- [ ] **Images: drag from Finder / Preview** onto the message box.
- [ ] **Images: a large Retina screenshot**: check the 5 MB limit message, and that a normal full-screen Retina png is under it or refused clearly. Also try a 4.5-5 MB image with real Claude (the limit may count base64 size).
- [ ] **Images: Attach button** opens the native file picker and accepts several files. Pasting from Excel/Numbers carries text plus an image of the cells: check which one you get.
- [ ] **Question cards on a real account**: questions with `preview`, multi-select, and 2-4 question cards; feel of the keyboard flow (arrows, number keys, Tab order, focus on arrival) in the desktop app.
- [ ] **Inspector feel**: scrubbing number fields and dragging move/resize handles (speed, Shift/Alt modifiers, trackpad).
- [ ] **Inspector on a real dev server with hot reload** (Vite/Next) through the proxy: make edits, then change source on disk; the page reloads and the panel recovers (pending edits are lost with the reload).
- [ ] **Inspector on a real website** through the proxy (login, CSP, redirects), including ones that fail.
- [ ] **Native color picker on macOS** (eyedropper, alpha).
- [ ] **Scroll up with a trackpad right after "Jump to latest"** and confirm it stays up (race fix, #157).
