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
| R2 | **Self-hosting runbook + script**: `scripts/dev-instance` runs a worktree's code on free ports with its own data dir; written "stable copy / dev copy" rules | S | script + tests | one real change to Designer made through Designer | you ship one small change this way |
| R3 | **Inspector** (in progress): visual properties panel, Copy changes, Add to message; page agent + opt-in proxy for localhost and website URLs (agent and proxy are built and tested; panel is next) | M | yes | feel of selecting/editing; real dev server | select, edit, copy on an HTML file and a localhost page; pasted report lets Claude apply it |
| R4 | **Images in chat**: paste/drop screenshots, thumbnails, passed to Claude as images | S-M | yes (fake + real Claude) | clipboard paste behaviour | paste a screenshot, Claude describes it |
| R5 | **Desktop shell spike**: Electron vs Tauri, time-boxed; measure idle memory, startup, in-process server, webview injection. Record the decision | S | Electron can run here under a virtual display; Tauri cannot | memory/feel on macOS | decision recorded with numbers |
| R6 | **Designer.app v0**: window, server lifecycle, token handled inside the app (no link), app data in Application Support, menus and shortcuts, links open in your browser, single instance, crash recovery; unsigned local build script | M-L | most (Electron) | launch, dock, menus, quit stops agents | you use the app for a full day of real work |
| R7 | **Native preview + comments** (P3): a real webview (no proxy needed, Paper loads inline); pinned comments on any page using the same selection layer as the inspector; structured feedback to the agent | L | partly | webview behaviour, external sites | comment on a localhost page and on Paper; agent applies it |
| R8 | **Harden**: long-session reliability, error states, logs, review button, diff/commit view if chat is not enough, release notes per tag | M | yes | days of real use | no known blocker for daily use; tag a release |
| R9 | **Share-ready**: signing, notarization, auto-update | L | no | Apple account, Mac | only if others will install it |

**Critical path to "build Designer in Designer": R1 → R2 → R4, in parallel with finishing R3.** You can start
building Designer in Designer after R2, in the browser version, before any desktop work. R5/R6 remove the friction
(terminal, link, local build) rather than unlock the ability.

## Decisions to make
- **R5:** Electron or Tauri. Electron runs the Agent SDK directly and I can test it here; Tauri is lighter but needs a Node
  helper process for the SDK and cannot be tested in this container. Decide with measurements.
- **R6:** whether the app bundles Node or relies on the installed one; where worktrees live by default.

## Parked (revisit later; each has a note in plan.md)
- **Hand off to Devin** (build with Claude, then hand the brief and branch to Devin via its API). Needs your Devin API
  access; build against a fake server first.
- **Codex / ChatGPT login** as a second provider behind the same adapter interface.
- **Agent-to-agent messaging**, **side-by-side variants**, **per-session model choice**.
- **In-app dictation** (system dictation is enough for now).
