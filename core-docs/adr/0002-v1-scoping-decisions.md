# ADR 0002 — Phase 13 v1 scoping decisions

**Status:** accepted
**Date:** 2026-04-22
**Deciders:** user, during the Phase 13.0 scaffolding design session

## Context

The Phase 13 tracks (D agent wire, E track primitive + git, F local-model surfaces, G safety + keychain) each carry scoping decisions that span multiple tracks. Without a single source of truth, parallel agent builds re-litigate them independently and converge on inconsistent choices. This ADR locks four such decisions for v1. Each is revisited when a concrete use case surfaces friction, not before.

Decisions 30–34 in `spec.md` set the primitive-level architecture (workspace/track split, workspace-lead model, fleet-scale stance, self-hosted CI, rate-limit signals). This ADR is narrower — it pins the scoping choices that affect how the individual track agents write their code.

## Decisions

### D1 — Workspace-lead session model

**v1:** the workspace lead is a **persistent Claude Code session**, scoped to the workspace, separate from any per-track agent team. The user chats with this session when they "chat with the workspace." Per-track agent teams live *below* it and are spawned / dissolved as tracks come and go. The workspace-lead session does not itself lead an agent team — it orchestrates tracks via Designer's coordination layer and responds to the user.

Hybrid routing (local models for routine chat, Claude only for consequential decisions — matches Decision 3's token-economics thesis) is **reserved** as a future token-cost optimization. Phase 18 or later; opt-in via settings when it lands; not default.

**Why not hybrid now:** v1 prioritizes a rich, coherent manager-level chat over token optimization. The hybrid layer is a productivity feature added to a working manager experience; introducing it day-one couples 13.D to the local-model work it doesn't need.

**Applies to:** 13.D primarily; 13.F, 13.G, and Phase 18 inherit.

### D2 — Repo linking UX

**v1:** native file picker. User picks a directory; Designer validates it's a git repo root and attaches it to the project. One directory per project in v1.

**Later:** GitHub URL linking (clone on demand), multi-repo projects. Not v1.

**Why not GitHub URL now:** native file picker is trivial (~30 LOC, zero network), matches the local-first thesis, and lets the user point at a repo they've already cloned — which is 95% of the real cases. URL cloning introduces auth considerations (GitHub credentials? SSH keys? Rate limits?) that don't belong in v1.

**Applies to:** 13.E.

### D3 — Default permission policy

**v1:** `AutoAcceptSafeTools` is the default `PermissionHandler` impl. It auto-accepts:

- `Read`, `Grep`, `Glob` — read-only file access.
- `Bash` commands matching a safe-prefix allowlist: `ls`, `cat`, `git status`, `git diff`, `git log`, `pwd`, `echo`, `which`. Extending the allowlist requires a spec-level discussion; it is intentionally narrow.

Everything else (writes, arbitrary bash, publishes, deploys, merges) is **denied by default until Phase 13.G lands** the inbox. Once G ships, 13.G's `InboxPermissionHandler` replaces the default; denied operations route to the user via the approval inbox.

**Why:** the default handler must be safe enough to ship in 13.D before 13.G exists. Auto-accepting read-only operations unblocks real Claude sessions (they read a lot of files to reason about code), while denying writes keeps 13.D from mutating the repo before the gate infrastructure is in place.

**Applies to:** 13.D (default), 13.G (replaces default).

### D4 — Cost-chip color thresholds

**v1:** topbar usage chip color ramps against known subscription thresholds (5-hour window, weekly compute-hour cap — per spec Decision 34):

- **Green:** 0–50% of the current window's capacity.
- **Amber:** 50–80%.
- **Red:** 80–100%.
- **Critical red + ambient notice:** >95%.

Thresholds read from the `rate_limit_event` payload Claude Code emits (`status: "allowed" | "approaching" | "exceeded"` plus `resetsAt` and `rateLimitType`). No Designer-side tracking; the chip reflects what Claude reports.

**Applies to:** 13.G.

## Consequences

- Each of the four Phase-13 track agents codes against the same scoping decisions — no divergence to reconcile at merge time.
- Agents can point at this ADR when asked "why X and not Y?" for any of the above.
- Revisiting any of the four requires a new ADR (or an amendment here) — not unilateral rewrite by a track agent.

## Reversal triggers

- **D1:** if token spend at the workspace-lead level becomes a real dogfooding pain point before Phase 18, accelerate the hybrid routing work. Same primitive, earlier.
- **D2:** if a user's first real use asks "can I clone a repo from GitHub," reopen.
- **D3:** if the allowlist is too narrow (agents constantly waiting on the inbox for benign operations) or too wide (agents doing things we didn't intend), tighten / expand with evidence from a dogfooding week.
- **D4:** if the three-stop ramp hides the "approaching limit" window too long, add a fourth stop at 70%.

## References

- `core-docs/spec.md` Decisions 3, 19, 30–35.
- `core-docs/adr/0001-claude-runtime-primitive.md` — first ADR (Claude runtime primitive).
- `core-docs/roadmap.md` Phase 13.0, 13.D, 13.E, 13.F, 13.G, 18, 19.
