# Parallel work: what can be built at the same time

Written 2026-11. Each project below is independent enough to run in its own local worktree (Claude Code on your Mac)
while other projects run. The desktop shell stays with the cloud session because Electron can be tested there.

## Ground rules (for every project)
- **Base:** branch from `claude/designer-ide-status-36fbed-renz2x` (run `git pull` first). Name yours `feat/<project>`.
  Merge back into that branch, not into `main` (main still holds the old app).
- **Stay in your files.** Each project lists files it owns and files to avoid. Small edits elsewhere are fine; if you need a
  bigger change in someone else's file, stop and say so.
- **Tests first.** Write the acceptance tests in the spec, then the code. Before you finish: `npm run typecheck`,
  `npm test`, `e2e/run.sh` all pass. Say exactly what you ran and the result.
- **Scaffold, don't replace** (CLAUDE.md): no logic that does what the model does; shortcuts that write a message, render
  what the model produced, or pass a capability through.
- **Mini design rules:** tokens in `styles.css`, inset focus rings, reduced motion respected, new CSS in a new file under
  `packages/web/src/styles/` (import it from `main.tsx`) so projects do not collide in `styles.css`.
- **Report:** what changed, what you tested, what needs a human on a Mac (add to `docs/needs-local-testing.md`), anything you
  deliberately did not do.

## Where things live (after the App.tsx split)
```
packages/web/src/
  App.tsx        shell + "can't connect" screen         Workbench.tsx  header, panes, resize split
  Sidebar.tsx    projects/workspaces                    Tabs.tsx       session tabs
  Chat.tsx       conversation, working indicator        Messages.tsx   one row per message kind, approvals
  Tools.tsx      tool run groups                        Composer.tsx   message box, queue, permission mode
  Quote.tsx      quote-selection button                 Preview.tsx    preview pane
  store.ts       client state + WebSocket               markdown.tsx   safe markdown rendering
packages/server/src/  manager.ts (threads, sessions)  claude.ts (Agent SDK adapter)  fake.ts (scripted provider)
                      preview.ts proxy.ts agent.ts (preview/proxy/page agent)  auth.ts  store.ts  index.ts
packages/shared/src/  index.ts (events + wire protocol)  edits.ts (inspector report)
packages/desktop/     Electron shell (owned by the cloud session)
```

## Projects
| # | Project | Size | Owns | Avoid | Spec |
|---|---|---|---|---|---|
| 1 | One-click previews | S | `markdown.tsx`, `Preview.tsx` (empty/unreachable states) | `Composer.tsx`, `Workbench.tsx` | [run-button.md](specs/run-button.md) |
| 2 | Images in chat | M | `Composer.tsx`, `Attachments.tsx`, server attachment code | `Preview.tsx`, `Workbench.tsx` | [images-in-chat.md](specs/images-in-chat.md) |
| 3 | Question cards | M | `Question.tsx`, `claude.ts` (askUser) | `Composer.tsx`, `Preview.tsx` | [question-cards.md](specs/question-cards.md) |
| 4 | Inspector panel | L | `inspector/*`, a column in `Workbench.tsx`, small hooks in `Preview.tsx` | `Messages.tsx`, `Chat.tsx` | [inspector-panel.md](specs/inspector-panel.md) |
| 5 | CI | S | `.github/workflows/ci.yml` | everything else | [ci.md](specs/ci.md) |
| - | Desktop shell (cloud session) | L | `packages/desktop/`, `e2e/desktop.e2e.mjs` | UI files | [roadmap.md](roadmap.md) R6 |

**How many at once?** Review and Mac testing are the limit, not code. Start **4**: previews, images, question cards, CI;
start the inspector alongside if you want it soon (it is the largest and the one most worth your attention). Everything
else waits for a slot.

**Conflict map.** Projects 2 and 3 both touch `claude.ts` and `shared/src/index.ts` (different parts; expect a trivial merge).
Projects 1 and 4 both touch `Preview.tsx`: merge 1 first (it is small); 4 keeps its changes there to a few lines and puts the
rest in `inspector/`. Project 5 touches nothing else.

**Merge order:** 5 (CI) -> 1 -> 3 -> 2 -> 4. After each merge, the next project rebases and re-runs the suites.

## Ready-to-paste prompts
Paste into a Claude Code session started in a fresh worktree of this repo (branch `feat/<name>` from the base above).

**1. One-click previews**
> Read CLAUDE.md and docs/parallel-work.md (ground rules) and build docs/specs/run-button.md. Write the acceptance tests first,
> then implement. Stay in the files the spec lists. Finish only when `npm run typecheck`, `npm test` and `e2e/run.sh` pass;
> report what you ran, what needs a Mac, and what you left out.

**2. Images in chat** (same text with `docs/specs/images-in-chat.md`; also run the real-Claude check in the spec)

**3. Question cards** (same text with `docs/specs/question-cards.md`; also run the real-Claude check in the spec)

**4. Inspector panel** (same text with `docs/specs/inspector-panel.md`; start by reading `packages/server/assets/agent.js`,
`packages/server/src/proxy.ts` and `packages/shared/src/edits.ts` and summarising how they fit before writing code)

**5. CI** (same text with `docs/specs/ci.md`; confirm the workflow is green on a pull request)

## Next wave (not yet specced; start when a slot frees)
- Show everything the model does: subagents/Task nesting, plan-mode plans as readable text, TodoWrite as a checklist.
- Model picker passed through from the SDK's own list; review button (a session started with a chosen model and a prompt).
- Git shortcuts as ready-to-send messages (commit, push, open a PR) plus branch/dirty chips in the sidebar.
- Comments on the preview (reuses the inspector's selection layer), side-by-side variants.
- Codex/ChatGPT adapter behind the same interface; Devin handoff; agent-to-agent messaging.
