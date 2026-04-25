# ADR 0003 — Artifact foundation as the parallel-work contract for Phase 13.D/E/F/G

**Status:** Accepted (2026-04-25)
**Supersedes:** parts of ADR 0002 §3 (the "tracks paint bespoke UI" scoping option, rejected)
**Related:** spec Decisions 36–39, FB-0024, FB-0025, FB-0026

## Context

Phase 13.0 partitioned the hot-spot Rust files (`core_agents.rs`, `core_git.rs`, `core_local.rs`, `core_safety.rs` and their `commands_*` siblings) so the four 13.X tracks would not contend on `core.rs` or `commands.rs`. That solved file-level merge conflicts but did not solve the deeper question: **what is the contract each track ships against on the frontend?** Without a shared answer, each track would have rebuilt some flavor of "agent chat surface" / "git status panel" / "approval modal" / "audit list" — and the frontend would have re-fragmented at exactly the moment we wanted it to converge.

## Decision

Phase 13.1 introduces a **typed-artifact foundation** that the four 13.X tracks emit into. The frontend renders artifacts via a registered renderer per kind. No 13.X track touches frontend code; no track's events overlap with another's.

### Frozen surface (do not extend without a new ADR)

- **Event vocabulary** in `crates/designer-core/src/event.rs`:
  - `ArtifactCreated { artifact_id, workspace_id, artifact_kind, title, summary, payload, author_role }`
  - `ArtifactUpdated { artifact_id, summary, payload, parent_version }`
  - `ArtifactPinned / ArtifactUnpinned / ArtifactArchived { artifact_id }`
- **`ArtifactKind`** discriminant — 12 fixed values: `message`, `spec`, `code-change`, `pr`, `approval`, `report`, `prototype`, `comment`, `task-list`, `diagram`, `variant`, `track-rollup`. Adding a new kind is a non-breaking change (registry has a `GenericBlock` fallback).
- **`PayloadRef`** — `Inline { body }` for ≤10 KB; `Hash { hash, size }` for larger blobs (schema-only until 13.1-storage; producers should only emit `Inline` today).
- **Projection** — `ProjectorState.artifacts` map + `pinned_artifacts: BTreeMap<WorkspaceId, Vec<ArtifactId>>`. Incremental update on every artifact event.
- **IPC** — `cmd_list_artifacts`, `cmd_list_pinned_artifacts`, `cmd_get_artifact`, `cmd_toggle_pin_artifact`. All registered in `apps/desktop/src-tauri/src/main.rs`.
- **Block renderer registry** in `packages/app/src/blocks/registry.ts`. Renderers consume `BlockProps { artifact, payload, isPinned, onTogglePin, expanded, onToggleExpanded }`. All 12 kinds have registered renderers today (7 render real data, 5 are stubs that show title + summary until their data source lands).

### Per-track scope

Each track owns one Rust sibling pair (`core_X.rs` + `commands_X.rs`) and the artifact kinds listed below. **No track owns any frontend module.**

| Track | Owns | Emits | Prerequisites |
|---|---|---|---|
| **13.D — Agent wire** | `core_agents.rs` + `commands_agents.rs` | `MessagePosted` thread events, `ArtifactCreated { kind: "message" }`, agent-produced `diagram` / `report` artifacts, partial-message coalescer | 12.A + 12.C + 13.1 |
| **13.E — Track primitive + git wire** | `core_git.rs` + `commands_git.rs` | `TrackStarted / TrackCompleted / PullRequestOpened`, `ArtifactCreated { kind: "code-change" }` per semantic edit batch, `ArtifactCreated { kind: "pr" }` on PR open | 12.C + 13.1 |
| **13.F — Local-model surfaces** | `core_local.rs` + `commands_local.rs` | `LocalOps::summarize_row` write-time hook (per-track debounce), `ArtifactCreated { kind: "report" }` for recaps, `ArtifactCreated { kind: "comment" }` for audit verdicts. Wires existing `PrototypePreview` into `PrototypeBlock`. | 12.B + 12.C + 13.1 |
| **13.G — Safety surfaces + Keychain** | `core_safety.rs` + `commands_safety.rs` | `ApprovalRequested / Granted / Denied`, `ArtifactCreated { kind: "approval" }` (renderer already has Grant/Deny action surface), `ArtifactCreated { kind: "comment" }` on scope-deny. `security-framework` keychain. Cost chip in topbar. | 12.C + 13.1 |
| **13.H — Safety enforcement** | (no new track files; modifies safety crate) | GA gate per `security.md` | 13.G |

### Out-of-scope hooks

- **`prototype` renderer body**: 13.F wires `packages/app/src/lab/PrototypePreview.tsx` into `PrototypeBlock`. Until then, `PrototypeBlock` shows title + summary + a "wires through in 13.F" placeholder. The integration is one prop pass.
- **`reveal_in_finder` Rust shim**: 13.1 ships a macOS-only shell-out via `open -R`. 13.E may extend to Linux/Windows when GitOps materializes worktrees outside macOS.
- **`PayloadRef::Hash` content store**: schema-only today. 13.1-storage follow-up writes blobs to `~/.designer/artifacts/<hash>` and adds blob garbage-collection. Tracks should only emit `Inline` until then; tests will fail closed if a `Hash` payload references a non-existent blob.

## Consequences

### Positive

1. **Zero UI contention between tracks.** Every track ships back-end code only. Frontend lands once (13.1) and is untouched by 13.D/E/F/G.
2. **Adding a new artifact kind is one PR.** Renderer in `blocks.tsx`, registration in `blocks/index.ts`, emitter in the owning track's core file. No cross-track coordination.
3. **Replay safety.** New event kinds replay against old clients (registry falls back to `GenericBlock`). Old `TabOpened { template: Plan }` events still replay against the new `WorkspaceThread`.
4. **One round-trip per artifact lifecycle test** locks the schema; further track-specific tests focus on emitter correctness, not event shape.

### Negative

1. **Speculative renderers exist before their data sources do.** `report`, `prototype`, `diagram`, `variant`, `track-rollup` have stub renderers. A test boot today shows them as "title + summary" cards; the visual register won't be final until 13.D/E/F/G fill in. Acceptable because nothing crashes and the layout is stable.
2. **One-way contract.** Once a kind is in the registry, removing it is a breaking change for anyone replaying an event log that referenced it. Adding a new kind is free; removing an old one requires a migration. The 12 we shipped are conservative — covers all currently-imagined event sources.
3. **Frontend-side emission is forbidden.** The user can only trigger events via existing IPC commands (`cmd_toggle_pin_artifact`). Send/edit/etc. must route through a track-owned IPC. This is the intended invariant (matches Decision 15 — "agents never open tabs unilaterally" — applied symmetrically) but worth flagging.

## Verification

- `cargo test --workspace` covers the artifact lifecycle (`artifact_lifecycle_projects_through_pin_unpin_archive` in `crates/designer-core/tests/store.rs`) and PayloadRef serialization round-trip.
- `npm run test` (vitest) covers the mock IPC happy path; mock seeds 5 demo artifacts on the onboarding workspace so first-run shows the registry working.
- Manual: dev server (`npm run dev` in `packages/app`) at `http://localhost:5191/` renders the seeded artifacts. Pin/unpin works against the mock store.

## How tracks land

Recommended order — D first, then E + G + F in parallel, then H:

1. **D** lands the message-posting path → unlocks the chat surface end-to-end.
2. **E** + **G** + **F** in parallel — they emit non-overlapping kinds and don't share files.
3. **H** lands after G (safety enforcement gates GA per `security.md`).

Each track ships:
- Green `cargo test --workspace`
- Green `cargo clippy --workspace --all-targets -- -D warnings`
- Green `cargo fmt --check`
- Green frontend `vitest` + `tsc --noEmit`
- A new generation-log entry in `core-docs/generation-log.md`

A track that finds itself wanting to add a new `ArtifactKind` should:
1. PR the kind enum entry + emitter + renderer + manifest update + design-language change-log line, all in the same PR.
2. Reference this ADR in the PR body.
3. If the new kind requires UI controls beyond Pin / Expand / Action-surface, propose those controls in `pattern-log.md` first — the registry contract is otherwise locked.
