# CLAUDE.md

Fresh start of Designer: a lean local chat app over Claude Code (Agent SDK) and
Codex (`codex app-server`). Read `docs/plan.md` first.

## Rules
- **Scaffold, don't replace.** Designer is light scaffolding around the models' own abilities: the experience, UX and
  interactions we want, with the model doing the work. Do not build features that replace, wrap, second-guess or get in the
  way of what the model (or Claude Code) already does; the app should get better for free as models improve. Before building
  anything ask: *if the model were 10x better tomorrow, does this get better for free, or does it become dead weight or an
  obstacle?* Prefer: render what the model produces, give the user one-click ways to steer it (a ready-to-send prompt,
  a link that opens in the pane), and pass every capability the SDK exposes through to the user (questions, plans,
  subagents, todos) instead of declining it. If the model can do it from a chat message, the feature is a shortcut that
  writes that message, not a second implementation.
- Never read, store, proxy, or log subscription credentials. Strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the env passed to the Claude SDK.
- Chat is pass-through: no middleware on the message path beyond normalization into our ~8 events. Approvals are the only intercept point.
- Unfinished features are removed or flagged off, never shipped as visible stubs.
- Do not copy code from other projects. Follow `docs/inspirations.md`: log every borrowed idea with project, pinned commit, file and lines. Anything adapted from code needs a `THIRD_PARTY_NOTICES.md` entry first.
- The old Tauri app is on branch `archive/tauri-designer` (tag `tauri-final`); read it for ideas, don't resurrect it wholesale.
- `main` is the single source of truth. Work happens on `feat/<name>` branches and lands through pull requests (see `docs/pr-protocol.md`). Do not reuse the old app's `v0.1.x` version tags.
