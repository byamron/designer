# Roadmap: a desktop app you can build Designer in

**Destination:** `Designer.app` on your Mac that you use every day to build Designer itself, with the same
confidence in security you have running Claude Code in a terminal or Conductor.

**Rules for getting there**
- Every phase ends usable. Nothing ships half-built behind a visible stub.
- Each phase is verified in the cloud container where possible (tests, browser suites, real Claude) and the rest is
  listed in [needs-local-testing.md](needs-local-testing.md) for your Mac. We do not build on top of an unverified
  Mac-only item without saying so.
- You test after every phase. Small steps; no big unreviewed drops.

## "Can build Designer in Designer" means
1. Start Designer.app with a double-click; no terminal, no link to copy.
2. Open the Designer repo, create a worktree, chat with Claude to change it, with approvals and Stop working.
3. See the result: the edited copy runs on its own ports/data and shows in the preview pane.
4. Give visual feedback on that preview (inspector, then comments) and paste screenshots into chat.
5. Commit/push without leaving the app (via chat is fine).
6. The app you work in is never the copy being edited, and never crashes or loses a session when that copy restarts.
7. Security is at parity with the terminal ([security.md](security.md)) and you have checked it on your Mac.

## Phases
| # | Phase | Size | Verified here | Needs your Mac | Exit criteria |
|---|---|---|---|---|---|
| R0 | **Done:** chat, approvals, Stop, resume; worktrees + tabs; preview pane + quote; polish pass; Auto mode | - | yes | tested by you; Auto/Full-access flag still open | you reported "everything works" |
| R1 | **Security parity** (token, CSP/headers, threat model, black-box tests) | S | yes (34 tests, 3 browser suites) | login/auto-mode checks | [security.md](security.md) complete; you opened the tokened link and it works |
| R2 | **Self-hosting runbook + script (built, confirmed on the owner's Mac)**: `npm run dev-instance -- --worktree <name>` runs a worktree on free ports with its own data and token; the stable app can show it in its preview pane; [self-hosting.md](self-hosting.md) | S | yes (unit, integration and browser tests) | one real change to Designer made through Designer | you ship one small change this way |
| R2b | **Run button** ([spec](specs/run-button.md)): one click runs a workspace (dev server or static page), shows it in the preview pane with a live log; generic, so Designer's own dev instance is one configuration. Built in the server so the Electron app inherits it | M | yes (fake dev server) | login-shell PATH, a real Vite/Next project, killing a real server tree | build it **in Designer** (first real dogfood feature); click Run on a Designer worktree and see it in the pane |
| R3 | **Inspector** (in progress): visual properties panel, Copy changes, Add to message; page agent + opt-in proxy for localhost and website URLs (agent and proxy are built and tested; panel is next) | M | yes | feel of selecting/editing; real dev server | select, edit, copy on an HTML file and a localhost page; pasted report lets Claude apply it |
| R4 | **Images in chat**: paste/drop screenshots, thumbnails, passed to Claude as images | S-M | yes (fake + real Claude) | clipboard paste behaviour | paste a screenshot, Claude describes it |
| R5 | **Electron shell, decided** (owner, 2026-11). Short feasibility pass instead of a comparison: server in the main process, a webview that can inject the page agent, idle memory and startup measured; revisit only if the numbers are bad | S | Electron can run here under a virtual display | memory/feel on macOS | numbers recorded; go/no-go on the shell design |
| R6 | **Designer.app v0** (next after R2b): window, server lifecycle, token handled inside the app (no link), app data in Application Support, login-shell PATH, menus and shortcuts, links open in your browser, single instance, crash recovery, in-app Update & restart; unsigned local build script | M-L | most (Electron) | launch, dock, menus, quit stops agents | you use the app for a full day of real work |
| R7 | **Native preview + comments** (P3): a real webview (no proxy needed, Paper loads inline); pinned comments on any page using the same selection layer as the inspector; structured feedback to the agent | L | partly | webview behaviour, external sites | comment on a localhost page and on Paper; agent applies it |
| R8 | **Harden**: long-session reliability, error states, logs, review button, diff/commit view if chat is not enough, release notes per tag | M | yes | days of real use | no known blocker for daily use; tag a release |
| R9 | **Share-ready**: signing, notarization, auto-update | L | no | Apple account, Mac | only if others will install it |

**Priorities (owner, 2026-11): no terminals, and as close to hot reload as possible.** This moves the desktop shell up.
New critical path: **R2b Run button → R6 Designer.app v0 → R3 Inspector / R4 Images.** Hot reload for the dev copy is done
(Vite dev server with Fast Refresh; a source edit showed up in about 0.2 s with state kept). Electron 45 runs in the cloud
container under a virtual display, so the shell can be built and tested here.

What "no terminals" means in practice:
- Launching: double-click `Designer.app`; it starts the server itself and opens its window. The private token is passed
  inside the app (no link to copy).
- Running a workspace (including Designer's own dev copy): the Run button (R2b), not a terminal.
- Updating the app you work in: an in-app **Update & restart** (pull, install, build, relaunch) for the source-checkout
  install, so day-to-day use needs no Terminal. The only Terminal step left is the one-time install.
- Git (commit, push, PR) via chat, as now.

Earlier critical path, kept for reference: **R1 → R2 → R4, in parallel with finishing R3.** You can start
building Designer in Designer after R2, in the browser version, before any desktop work. R5/R6 remove the friction
(terminal, link, local build) rather than unlock the ability.

## Decisions to make
- **R5 (decided): Electron.** T3 Code, Paseo (moved from Tauri in March 2026) and Orca are all Electron; it runs the Agent SDK
  directly and can be tested in this container. A native Swift shell is not planned: it would mean rewriting the UI and could not be
  verified here. Keep the server/UI split so a native shell stays possible later if measurements demand it.
- **R6:** whether the app bundles Node or relies on the installed one; where worktrees live by default.

- **Optional Swift helper** (small CLI, macOS 26+, Apple Intelligence Macs only) exposing Apple's on-device Foundation Models for
  light features such as session titles and turn summaries. Behind a flag; verified only on your Mac.

## Why Electron, judged on ceiling (and when to revisit)
Owner's criterion: highest ceiling for performance and features; rewrite cost is not a factor. Assessment:
- The product's value lives in **web content** (preview, inspector, comments, side-by-side variants). Chromium gives the
  higher ceiling there: the DevTools protocol (matched CSS rules with stylesheet origins for the inspector, full-page
  screenshots, device and touch emulation for responsive checks), network control, and rendering that matches Chrome.
  WKWebView (Swift or Tauri) has no public equivalent for these.
- A native Swift shell has the higher ceiling for **memory, battery, startup and macOS integration** (Keychain, App Intents,
  ScreenCaptureKit, Foundation Models without a helper) and could share code with an iOS app. That is real, but those wins
  are mostly outside the surface this product is judged on.
- Mobile does not depend on this choice: the server speaks a JSON event stream, so an iOS client can be written natively later.
- **Revisit** if measurements on the owner's Mac show unacceptable idle memory or battery with a real workload (several agents
  plus several preview views), or if a macOS-only feature becomes central. Cheap free experiment now: open the app in Safari
  and in Chrome and compare Activity Monitor.
- Electron discipline for security parity: renderers sandboxed, context isolation on, no Node in renderers, validated IPC.

## Parked (revisit later; each has a note in plan.md)
- **Hand off to Devin** (build with Claude, then hand the brief and branch to Devin via its API). Needs your Devin API
  access; build against a fake server first.
- **Codex / ChatGPT login** as a second provider behind the same adapter interface.
- **Agent-to-agent messaging**, **side-by-side variants**, **per-session model choice**.
- **In-app dictation** (system dictation is enough for now).
