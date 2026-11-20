# Needs testing on the owner's Mac

Built and tested in a Linux cloud container. These are things that container cannot prove. Tick them off
when checked on a real machine; do not build further on an unchecked item without saying so.

## Verified in the container (for reference)
Server unit tests (16), browser tests against a scripted provider, real Claude through the server (streaming,
tool calls, approval deny, interrupt, resume after restart), real `git worktree` create/remove.

## To verify locally
- [x] **Subscription login.** With no `ANTHROPIC_API_KEY` set and `claude login` done, a chat works and no
      "using key instead of your subscription" warning appears. (Container auth differs, so `apiKeySource`
      there proves nothing.)
      *Mac check 2026-11-19:* real `claude login` account, no API key: chat replied, no warning shown (mac-checks PR).
- [x] **Stripped env really wins.** With `ANTHROPIC_API_KEY` exported in your shell, the app still uses the
      login (the adapter removes it), and usage shows against the subscription.
      *Mac check 2026-11-19:* second dev instance started with a fake `ANTHROPIC_API_KEY` in its server env (confirmed present via `ps`); chat still worked on the login. Usage meter not looked at.
- [x] **Stop behavior.** Stop during a long tool run and during streaming; check for a stray extra reply after Stop.
      *Mac check 2026-11-19:* Stop during `ping -c 70` killed the process, idle in 86 ms, nothing arrived for 20 s; Stop mid-stream then stayed stopped for 15 s and a follow-up replied normally. Not tried: Stop during a subagent or a long file write.
- [x] **Real approvals feel.** Default mode prompts for the things you expect; "auto-accept edits" and full access
      behave as labelled.
      *Mac check 2026-11-19:* default asked for Bash/Write, Deny was honoured; "auto-accept edits" wrote without a prompt; full access ran with no prompts. (Whether `echo` should prompt in accept-edits is SDK behaviour.)
- [x] **Worktrees on your repos.** Create a worktree from a real project (with submodules, large repo, uncommitted
      changes in the main folder). Check where it lands (`~/.designer-chat/worktrees/<repo>/<name>`) and that
      removing a dirty one is refused.
      *Mac check 2026-11-19:* tested on a clone of this repo with a submodule and an uncommitted change in the main folder, not your own repos. Landed at `<data>/worktrees/<repo>/<name>` on branch `designer/<name>`; removing a dirty one was refused (raw `fatal: ... use --force` text shown), a clean one removed. Submodule contents inside the worktree not checked.
- [ ] **Safari / Chrome behavior.** Scroll follow/detach with a trackpad (momentum scrolling), mobile-width layout is not
      designed. The container only tested Chromium with a mouse wheel.
- [ ] **Long real sessions.** Memory and smoothness over hundreds of messages and large tool outputs.
- [x] **Port 4317 / Host check** works with how you open it (localhost vs 127.0.0.1; other hostnames are refused).
      *Mac check 2026-11-19:* `localhost` and `127.0.0.1` both load; `[::1]` and other hostnames get 403.

- [x] **Preview in your real browser/workflow.** Open an agent-written HTML file and a running dev server
      (e.g. `localhost:3000` with hot reload) in the pane; check HMR still works inside the iframe and that the
      pane refresh on turn end does not fight it (it only reloads file previews, not URLs).
      *Mac check 2026-11-19:* Vite dev server in the pane: HMR text update arrived and a turn-end did not reload it (a page marker survived); an HTML file preview refreshed on turn end. Real Chromium, not Safari.
- [x] **Preview port.** Port 4318 (app port + 1) is free on your machine; otherwise set `PREVIEW_PORT`.
      *Mac check 2026-11-19:* nothing listening on 4317/4318 on this Mac (the dev instance used 4500/4501).
- [ ] **Split handle feel.** Dragging with a trackpad, with an iframe under the pointer (we capture the pointer
      so this should hold, only tested with a mouse in Chromium).
- [ ] **Quote in Safari/Chrome.** Selection and the floating Quote button positioning, including selections
      that span several paragraphs or code blocks.
- [x] **Sites that block framing** (Paper, Figma, most SaaS): confirm the message appears and "Open in new tab"
      works. Showing them inline needs the desktop shell (later).
      *Mac check 2026-11-19:* GitHub and Hacker News show the message; "Open in new tab" opens the site. Paper and Figma not tried.

- [ ] **How the motion and speed actually feel.** The container can check that animations run, in what order,
      and that text is revealed over several frames; it cannot judge whether the easing, durations and the
      reveal speed feel right. Tell us which feel too slow, too fast or distracting.
- [x] **Timer and indicator on a real long task** (a multi-minute run): does the phase label stay accurate,
      does the timer survive a page reload mid-run (it is measured from your message's timestamp).
      *Mac check 2026-11-19:* 75 s foreground Bash: label "Running Bash", timer 25 s, reload at ~25 s, still "Running Bash" at 28 s. Not a multi-minute run.
- [ ] **Jump to latest with a trackpad**, including momentum scrolling right after the click.
- [ ] **Focus rings in Safari** (the automated check runs in Chromium; Safari draws outlines slightly differently).

- [ ] **Auto mode on your account.** Pick "Auto: Claude decides" and ask for a bash command and a file edit; check it
      runs without prompts for ordinary work and still asks for something risky. If your plan/model does not support
      it, you should see a notice saying which mode Claude is actually in.
      *Mac check 2026-11-19:* partly: bash and a file edit ran without prompts, but `curl | bash` and a force-push to a missing repo also ran without a prompt, so "still asks for something risky" is not shown. No mode notice appeared.
- [x] **Full access mode.** We now pass the SDK's explicit acknowledgement flag; confirm it starts without errors
      (the container is a hosted session, where the SDK behaves differently).
      *Mac check 2026-11-19:* a Full-access chat started and ran tools with no errors on this account.

- [x] **Self-hosting loop on your Mac** (owner confirmed it worked, 2026-11) ([self-hosting.md](self-hosting.md)): stable clone, worktree, `npm run dev-instance`,
      dev instance visible in the Preview pane, one real change merged and promoted. First run of `npm install` in a
      worktree, and that a real Claude edit shows up after a UI rebuild.

- [ ] **Hot reload feel** (`npm run dev-instance -- --worktree <name>`, now on Vite's dev server): edit the UI through Claude and
      watch the preview pane update in place; check it keeps what you typed and that server edits restart cleanly.
      *Mac check 2026-11-19:* partly: with a draft typed in the box, a UI edit changed the page in place (no reload, draft kept) and a server edit restarted only the server; the instance recovered. Not done through Claude, and feel not judged.

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
- [x] **Real dev server started by Claude** (previews): ask Claude to start a dev server from chat; the URL becomes a chip and loads in the pane.
      *Mac check 2026-11-19:* Vite started from chat, URL became a chip and loaded in the pane. **Bug:** Claude bolded the URL, so the chip says `127.0.0.1:5190/**` and opens `http://127.0.0.1:5190/**` (loads only because Vite falls back to index.html). See the PR.
- [x] **Does Claude's background server survive long enough?** If it dies with the session, that is where a supervised runner would earn its place.
      *Mac check 2026-11-19:* Vite started by Claude (nohup) was still serving 15+ minutes later, across turn ends, other chats and a restart of the Designer server. Closing Designer itself was not tested.
- [ ] **Images: macOS clipboard paste** (Cmd-Ctrl-Shift-4, then Cmd-V into the message box).
      *Mac check 2026-11-19:* partly: `screencapture -c` fails here ("could not create image from display", no screen-capture permission), so I put PNGs on the real macOS pasteboard with `osascript` and pressed Cmd-V in Chromium: thumbnail appeared and the image reached Claude. Still needs your Cmd-Ctrl-Shift-4.
- [ ] **Images: drag from Finder / Preview** onto the message box.
      *Mac check 2026-11-19:* not tried: no tool here can drag from Finder into a browser.
- [x] **Images: a large Retina screenshot**: check the 5 MB limit message, and that a normal full-screen Retina png is under it or refused clearly. Also try a 4.5-5 MB image with real Claude (the limit may count base64 size).
      *Mac check 2026-11-19:* 3456x2234 Retina png (1.4 MB) pastes fine; 5.58 MiB paste refused with "image.png is larger than 5 MB."; 4.72 MiB and 4.90 MiB (5.14 MB) images were accepted and described by real Claude.
- [ ] **Images: Attach button** opens the native file picker and accepts several files. Pasting from Excel/Numbers carries text plus an image of the cells: check which one you get.
      *Mac check 2026-11-19:* not tried: Playwright replaces the native picker. Needs you (pick several files; paste from Excel/Numbers).
- [ ] **Question cards on a real account**: questions with `preview`, multi-select, and 2-4 question cards; feel of the keyboard flow (arrows, number keys, Tab order, focus on arrival) in the desktop app.
      *Mac check 2026-11-19:* functional part passed: one call with 3 questions, previews, a multi-select, number-key choice, Submit; Claude got the right answers. Keyboard feel and focus in the desktop app still need you.
- [ ] **Inspector feel**: scrubbing number fields and dragging move/resize handles (speed, Shift/Alt modifiers, trackpad).
- [x] **Inspector on a real dev server with hot reload** (Vite/Next) through the proxy: make edits, then change source on disk; the page reloads and the panel recovers (pending edits are lost with the reload).
      *Mac check 2026-11-19:* Vite at 127.0.0.1:5190 through the proxy: edits applied; React fast-refresh edits kept the inline edits and updated text; an index.html change did a full reload, edits were dropped, panel went back to "click an element" and editing worked again.
- [x] **Inspector on a real website** through the proxy (login, CSP, redirects), including ones that fail.
      *Mac check 2026-11-19:* example.com, Wikipedia, GitHub, Hacker News load through the proxy and elements can be selected and edited; unreachable hosts show "Cannot reach ...". Logins not tried.
- [ ] **Native color picker on macOS** (eyedropper, alpha).
- [ ] **Scroll up with a trackpad right after "Jump to latest"** and confirm it stays up (race fix, #157).

## Found in the 2026-11-19 Mac pass (not fixed there; see the PR for repro steps)
- Preview chip keeps markdown `**` when Claude bolds a URL (`Open 127.0.0.1:5190/** in preview`, opens `.../**`).
- Inline code containing quotes/angle brackets shows HTML entities (`'<'` renders as `&#39;&lt;&#39;`).
- With many chat tabs open (1280 px window, preview and inspector open) the tab strip covers the "+" new-session button.
- Removing a dirty worktree shows git's raw `fatal: ... use --force to delete it` text.
