# ADR 0005 — `Orchestrator::subscribe_signals` trait shape

**Status:** Accepted (2026-04-26)
**Deciders:** Track 13.J docs cleanup
**Related:** ADR 0002 §D1 (workspace-lead session model), spec Decision 34 (cost chip + rate-limit signals), PR #22 design-engineer review

## Context

Phase 13.G F3 promoted `subscribe_signals(&self) -> broadcast::Receiver<ClaudeSignal>` from a concrete-orchestrator method to the `Orchestrator` trait surface, so `AppCore::boot` could subscribe to per-turn cost regardless of which orchestrator is wired. The trait now bakes a Claude-specific type into an "abstract" `Orchestrator`.

PR #22's design-engineer review flagged the leak: `ClaudeSignal` is defined in `crates/designer-claude/src/claude_code.rs` (Claude's stream-translator territory), but the trait that all orchestrators implement lives in `crates/designer-claude/src/orchestrator.rs` and references it directly.

Two concrete second orchestrators are on Designer's roadmap and would force a rename if we don't pick a shape now:

- A **Cursor** adapter (Phase 18+ exploration).
- A **local Ollama** orchestrator (Phase 19 hybrid routing per ADR 0002 §D1).

Either lands a non-Claude `subscribe_signals` impl. The signals the trait carries today are:

- `Cost { workspace_id, total_cost_usd }` — pure-domain telemetry. Every orchestrator that costs money emits the same shape.
- `RateLimit(serde_json::Value)` — an opaque passthrough of Claude's `rate_limit_event` payload. Other orchestrators' rate-limit formats differ; the inner JSON is intentionally orchestrator-defined.

## Decision

Rename the trait surface to `OrchestratorSignal`. Keep `ClaudeSignal` as a type alias for one release cycle so existing call sites compile unchanged.

```rust
// crates/designer-claude/src/orchestrator.rs
pub enum OrchestratorSignal {
    Cost { workspace_id: WorkspaceId, total_cost_usd: f64 },
    RateLimit(serde_json::Value),
}

#[async_trait]
pub trait Orchestrator: Send + Sync {
    fn subscribe_signals(&self) -> broadcast::Receiver<OrchestratorSignal> {
        let (tx, rx) = broadcast::channel(1);
        drop(tx);
        rx
    }
    // ... rest unchanged
}

// crates/designer-claude/src/claude_code.rs
pub type ClaudeSignal = OrchestratorSignal;
```

The variant names (`Cost`, `RateLimit`) and field shapes are unchanged — every match arm keeps working. The `RateLimit` payload stays `serde_json::Value`: the inner shape is orchestrator-defined and consumers (today, only the cost chip) parse what they understand. Pinning a neutral struct now would constrain Cursor / Ollama producers we haven't profiled.

## Rationale

- **Trait surface should not name its only producer.** A Claude-specific type on an "abstract" trait is the same anti-pattern flagged by PR #22's review: the abstraction lies. Picking a neutral name now is a one-line rename plus the alias; doing it after a second producer lands is a multi-file rename plus a deprecation window.
- **The shape is genuinely neutral.** `Cost { workspace_id, total_cost_usd }` is what any orchestrator that bills tokens or compute will emit. `RateLimit` is opaque JSON, so each orchestrator can use its native shape without forcing the trait to know about it.
- **Type alias is zero-friction.** Existing call sites — `AppCore::boot`'s subscriber loop in `apps/desktop/src-tauri/src/core.rs`, `MockOrchestrator::signals()` in `crates/designer-claude/src/mock.rs`, the F3 `signal_subscriber_records_to_store` test, and the cost-broadcast tests in `claude_code.rs` — keep importing `ClaudeSignal`. Match arms over `ClaudeSignal::Cost { .. }` keep working because variant names are unchanged. The rename is mechanical at the type-definition line and the trait line; everything else is the alias.
- **Locks the choice before forced rename.** ADR 0002 §D1 names Phase 19 hybrid routing as the trigger for a second orchestrator. If we wait, two impls live with the leak before we cut, and the rename PR has to coordinate with whichever track lands the new orchestrator.

## Rejected: keep `ClaudeSignal`, rename when a second orchestrator lands

The "rename later" path looks cheap because it is — for the trait line. But it forces:

1. A grep-and-replace across `core.rs` (subscriber loop), `mock.rs` (test broadcaster), and the new orchestrator's impl block, all in the same PR that introduces the second orchestrator.
2. A deprecation window where the trait docs say "this returns a Claude-specific type, but it isn't really" — exactly the noise this ADR exists to eliminate.
3. A merge-coordination cost between the rename and the new orchestrator, since both touch the trait line.

There is no design upside: the trait already only carries `Cost` + opaque `RateLimit`, both orchestrator-neutral by construction. The leak is purely a naming artifact.

## Consequences

- **Migration path for `ClaudeSignal`.** Keep the alias for v1 (Phase 13–18). When Phase 19 lands the Ollama orchestrator (or whichever second orchestrator lands first), drop the alias in the same PR — every call site already uses the alias by name, so the cleanup is one find-replace.
- **Trait shape is frozen by this ADR.** Adding a third variant (e.g., `RateLimit` becoming a typed enum) or changing the cost variant's fields requires a new ADR. Variants are additive — old consumers ignore variants they don't match (matches the additive-`EventPayload` exception in ADR 0002's 2026-04-26 addendum, applied to a different surface).
- **`serde_json::Value` payload is orchestrator-defined.** Each orchestrator's documentation must spell out its `RateLimit` inner shape. Consumers (the cost chip today) treat it as Claude-shaped until a second producer arrives; at that point, route by the orchestrator that emitted it (the receiver knows which orchestrator it subscribed to).
- **No behavioral change.** This is a docs-and-rename refactor. No event-shape changes, no IPC changes, no test churn beyond an `import` adjustment if a follow-up wants to use the new name explicitly.

## Implementation note

This ADR is docs-only. The follow-up implementation PR (also under Track 13.J) is mechanical:

1. Move the `enum` definition from `claude_code.rs` to `orchestrator.rs` and rename to `OrchestratorSignal`.
2. Update the trait method's return type.
3. Re-export `ClaudeSignal` as `pub type ClaudeSignal = OrchestratorSignal;` from `claude_code.rs` so `crates/designer-claude/src/lib.rs`'s public re-export keeps working.
4. Verify `cargo test --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` + `cargo fmt --check` are green.

## References

- `crates/designer-claude/src/orchestrator.rs:142` — current trait method.
- `crates/designer-claude/src/claude_code.rs:134` — current `ClaudeSignal` definition.
- `apps/desktop/src-tauri/src/core.rs:374` + `:561` — `AppCore::boot` subscriber loop.
- `crates/designer-claude/src/mock.rs:33` + `:56` + `:302` — mock orchestrator's signal channel and trait impl.
- `core-docs/roadmap.md` Track 13.J — the cleanup queue this ADR closes the docs item for.
- ADR 0002 §D1 — workspace-lead session model; names Phase 19 hybrid routing as the second-producer trigger.
