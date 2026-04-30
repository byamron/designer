# Designer

A local-first macOS app for managing a team of AI coding agents the way you'd manage a team of people.

> **Status:** under active development. The desktop app runs from source against your local Claude Code, but isn't packaged for distribution yet — there's no signed installer. Public repo so the thinking is visible.

---

## What sets it apart

Most tools in this space manage a single worktree at a time. Designer's primitive is bigger.

A **workspace** is a feature, not a branch — "billing rebuild," "onboarding overhaul." It owns a persistent agent team and the full context of the work: docs, decisions, prior chat, prior code. The team ships across many branches and PRs as the feature evolves. You lead a team that knows the feature, not a fresh session every time.

You chat with a lead agent that holds the workspace's context. When you start a unit of shipping work, it gets its own worktree, branch, and sub-team. Approval gates surface in an inbox for anything consequential — merge, prod-config touch, cost-cap breach. No terminal, no diffs unless you want them.

## What's in the box

- **Workspaces with persistent context.** Feature-scoped, not branch-scoped.
- **Continuous workspace thread.** Messages, specs, code changes, PRs, approvals, and reports render as typed blocks in one scrollable surface — no separate tab types to manage.
- **Hierarchical live status**, from "all projects" down to a single tool call.
- **Approval gates + append-only audit log**, enforced in the Rust core.
- **Sandboxed prototype previews** — strict CSP, iframe sandbox.
- **Design lab** — component catalog, variant explorer, annotations.
- **Local-model layer.** Apple Foundation Models handles workspace recaps, artifact audits, and pattern detection, reserving Claude tokens for creative work.

## Stack

- **Runtime:** your locally installed Claude Code, invoked as a subprocess
- **Shell:** Tauri (Rust core + WebView frontend)
- **Core:** Rust, event-sourced architecture, SQLite
- **Frontend:** TypeScript + React
- **Local models:** Swift helper for Apple Foundation Models (with a no-op fallback for non-Apple-Intelligence machines)
- **Project docs:** `.md` files in the repo, picked up natively by agents
- **Mobile (phase 2):** remote control for the desktop install, never cloud-hosted

## Repo layout

```
apps/desktop/         Tauri shell
crates/               Rust core (orchestration, safety, git, local-models, sync)
helpers/foundation/   Swift helper for Apple Foundation Models
packages/ui/          Design system
packages/app/         React surfaces
core-docs/            Spec, roadmap, design language, security model
```

The full product spec, roadmap, and design language live in [`core-docs/`](./core-docs).
