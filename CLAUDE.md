# CLAUDE.md

Fresh start of Designer: a lean local chat app over Claude Code (Agent SDK) and
Codex (`codex app-server`). Read `docs/plan.md` first, and `docs/vision.md` for what the app is for.

## Purpose
The product is the **feedback loop** between a person (mainly a designer) and the model: increase the speed, quality
and specificity of the feedback they can give while the model designs and builds. Judge every feature by whether it
shortens capture (saying what and where) or review (seeing the result). Long-term ideas, such as voice comments,
live critique mode and meeting mode, are in `docs/vision.md`. Start small; the model does the interpreting.

Do not compete on model/harness capability or on the canvas (rendering, editing, WebGL vs HTML). Use the models and
harnesses as they are, and host any canvas that runs in a browser (Paper, Subframe, Twombly, Onlook, HTML, localhost).
We are the glue that makes the user's intent, feedback and context travel between them fast. A feature that only
works for one canvas or one model belongs in an adapter, not the core loop.

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
- **Use the flow workflow by default** (the `flow` plugin; config in `flow.config.json`). Every request that changes the repo starts
  with a short plan (scope in/out, a Spec-walk of testable criteria, a confidence level per assumption, checked with
  `/flow:critique-plan`) before any code, then runs the loop and ends in `/flow:ship`. Not every step fits every request (a
  typo needs no Spec-walk, a docs-only change needs no verify-build), so skip a step when the request does not warrant it, say
  which step and why, and let `/flow:audit-skips` check the reason. Skipping a step with no reason, or working first and
  planning afterwards, is not acceptable. `docs/pr-protocol.md` still governs branches, PR shape and which docs are the orchestrator's.
- `main` is the single source of truth. Work happens on `feat/<name>` branches and lands through pull requests (see `docs/pr-protocol.md`). Do not reuse the old app's `v0.1.x` version tags.
