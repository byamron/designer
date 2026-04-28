# Contributing to `designer-learn`

This crate is the home of Designer's learning layer. Phase 21.A1 shipped
the foundation — the `Detector` trait, `Finding` struct, anchor
re-export, `SessionAnalysisInput` builder, defaults migrated from
Forge, and a worked example detector. **Phase 21.A2** lands the ten
deterministic detectors in parallel; one agent per detector.

This file is the contract every detector author works against.

> **Status:** Phase 21.A1 (foundation). Last reviewed 2026-04-26.

---

## 1. Locked contracts

Phase 21.A1 froze the four shapes below. Phase 21.A2 detectors **must
not** redesign them. Extending an enum with a new variant is fine
(additive change); changing field names, types, or removing variants
breaks every parallel detector mid-flight.

### `Detector` trait — `src/lib.rs`

```rust
#[async_trait]
pub trait Detector: Send + Sync {
    fn name(&self) -> &'static str;
    fn version(&self) -> u32;

    // Phase A: ignore `ops`. Phase B: take `Some(&dyn LocalOps)` for
    // semantic synthesis.
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
        ops: Option<&dyn designer_local_models::LocalOps>,  // feature `local-ops`
    ) -> Result<Vec<Finding>, DetectorError>;
}
```

When the `local-ops` feature is **off** (Phase A default), the `ops`
parameter is dropped from the signature. Detector implementations
provide both arms — see `example_detector.rs` for the pattern.

### `Finding` — `designer_core::Finding`

```rust
pub struct Finding {
    pub id: FindingId,                          // UUIDv7
    pub detector_name: String,                  // matches Detector::name
    pub detector_version: u32,                  // matches Detector::version
    pub project_id: ProjectId,
    pub workspace_id: Option<WorkspaceId>,      // None for project-wide
    pub timestamp: Timestamp,
    pub severity: Severity,                     // Info | Notice | Warn
    pub confidence: f32,                        // [0.0, 1.0]
    pub summary: String,                        // <120 chars headline
    pub evidence: Vec<Anchor>,                  // shared evidence anchors
    pub suggested_action: Option<serde_json::Value>,  // Phase B fills
    pub window_digest: String,                  // dedupe key per detector_version
}
```

Findings live as event payloads (`EventPayload::FindingRecorded`), so
the wire shape is part of the persisted-event contract — it is governed
by ADR 0002 §"Frozen contracts" + addendum (additive variants only).
Adding a field requires a new ADR addendum.

### `Anchor` — `designer_core::anchor::Anchor`

The shared evidence-pointer enum. Same shape used by Friction
(Track 13.K) and inline comments (Phase 15.H).

```rust
pub enum Anchor {
    MessageSpan { message_id, quote, char_range },
    PrototypePoint { tab_id, nx, ny },
    PrototypeElement { tab_id, selector_path, text_snippet },
    DomElement { selector_path, route, component, stable_id, text_snippet },
    ToolCall { event_id, tool_name },
    FilePath { path, line_range },
}
```

Detectors emit `MessageSpan`, `ToolCall`, and `FilePath` most often.
**Do not introduce new variants for detector-specific evidence kinds.**
If the existing six can't express your evidence, that's an ADR-level
discussion, not a per-detector tweak.

### `SessionAnalysisInput` — `src/session_input.rs`

The bundle every detector reads from. Built by
`SessionAnalysisInput::builder(project_id).workspace(ws).events(evts).build()`
— the builder derives `tool_call_inventory` and `gate_history` from
the event stream so detectors don't recompute it. Use
`build_with_overrides(...)` only in tests where you want hand-rolled
aggregates.

The eight categories the bundle exposes are documented in
`session_input.rs` and mirror `core-docs/roadmap.md` §"Analysis inputs
— what the layer reads".

---

## 2. Adding a new detector

Phase 21.A2 detectors land one per PR, one agent per detector. The
flow:

```sh
# 1. Copy the worked example.
cp src/example_detector.rs src/detectors/<name>.rs

# 2. Copy the fixture skeleton.
cp -r tests/fixtures/example tests/fixtures/<name>

# 3. Copy the fixture-test harness.
cp tests/example_fixture.rs tests/<name>.rs
```

Then:

1. **Rename the type and constants** in `src/detectors/<name>.rs`:
   `NoopDetector` → `<Name>Detector`, `NAME` → `"<name>"`,
   `VERSION` → `1`.
2. **Replace the body of `analyze`** with the detection logic. Keep
   it pure: read from `input`, return findings; no I/O outside
   filesystem reads from `input.project_root` and friends. If you
   need a third-party dep, list it in `Cargo.toml`'s
   `[dependencies]` and call out the addition in the PR description.
3. **Build the fixture pair** `tests/fixtures/<name>/input.jsonl`
   (events that should trigger the finding) +
   `tests/fixtures/<name>/expected.json` (the finding shape your
   detector emits). Use `serde_json::to_string(&envelope)` to
   capture real envelopes — hand-writing JSON for `OffsetDateTime`
   is fragile. The empty fixture in `tests/fixtures/example/` is
   the smallest valid form.
4. **Update `tests/<name>.rs`** to load your fixture and assert
   detector-stable fields (`detector_name`, `severity`, `summary`).
   Don't assert `id` / `timestamp` — they're volatile.
5. **Pick a `DetectorConfig` default** from `src/defaults.rs`. If
   none of the existing constants fit, add a new one with a
   `// Forge: <file> L<line>` citation comment. Detector-unique
   thresholds (Designer-only detectors with no Forge analog) live
   in the same file with a `// Designer-unique` comment.
6. **Honor the Forge co-installation rule** — `forge_overlap("<name>")`
   returns `true` for detectors Forge also ships, in which case the
   AppCore wiring (`apps/desktop/src-tauri/src/core_learn.rs`)
   defaults their config to `DetectorConfig::DISABLED` when Forge is
   present. Designer-unique detectors always run; do not add them
   to `FORGE_OVERLAP_DETECTORS` in `src/lib.rs`.
7. **Register the detector** — in 21.A2 a registry lands in `lib.rs`
   exposing every detector through a single `all() -> Vec<Box<dyn
   Detector>>` helper. For now, the noop detector is the only entry;
   each new detector PR adds itself there.
8. **Run the gates** — `cargo fmt --all`, `cargo clippy --workspace
   --all-targets -- -D warnings`, `cargo test -p designer-learn`.
   Expect green.

---

## 3. Threshold-defaults convention

Every threshold a detector reads is a `pub const` in
`src/defaults.rs`. Each constant's doc comment cites the Forge file
+ line it was migrated from (or marks itself `Designer-unique` when
Forge has no analog).

When Forge bumps a threshold:

1. Update the constant in `defaults.rs`.
2. Update the citation comment with the new Forge file + line.
3. Bump every detector's `VERSION` that consumes that constant — old
   findings keyed by the prior version stay attached to the prior
   detector. Detector authors **never retroactively rewrite** old
   findings; they emit fresh findings under the new version.

---

## 4. Keyword corpora

Static phrase lists live in `src/defaults.rs` as `pub const NAME:
&[&str]`. Lowercased, anchor-free, no regex metacharacters — the
*detector* composes its matching strategy on top of the corpus.

When migrating from Forge:

- Drop the Forge regex weights — Designer's detectors land their own
  scoring.
- Strip word-boundary anchors (`\b`) — those belong in the matcher,
  not the corpus.
- Keep alternations expanded as separate entries
  (`"don't use", "dont use"`) so a future MLX/regex backend doesn't
  need a separate alternation parser.

---

## 5. Testing pattern

Every detector has at least one fixture test. Patterns:

- **Empty fixture** = "detector emits nothing on no input." The noop
  detector's fixture is the canonical example.
- **Trigger fixture** = "given these N events, detector emits the
  finding(s) in `expected.json`." Captured via real
  `serde_json::to_string(&envelope)`.
- **Negative fixture** = "given events that *look* like the trigger
  but are below threshold, detector emits nothing." Land at least
  one of these per detector; without it, nobody knows whether the
  detector fires at the right edge of its threshold.

Fixture tests run as `tokio::test` because `Detector::analyze` is
async.

---

## 6. Severity calibration

Designer's "noticed" surface lives in the cockpit, not a CI log. The
user's noise tolerance for it is much lower than for Forge's — every
`Severity::Warning` finding is a colored interruption on the workspace
home tab. Pick severity conservatively:

- **`Severity::Notice` is the A2 default.** Use it unless you can
  defend a different choice in the detector PR. Notice is "I saw
  this and you might care"; that fits the bulk of Phase A signal
  (corrections, repeated prompts, gap detections, post-tool
  determinism, etc.).
- **`Severity::Warning` requires justification.** Acceptable only when
  the detector's measured false-positive rate is **<5%** on the
  captured fixture suite (positive-trigger fixtures + negative-edge
  fixtures), and the underlying signal is action-worthy without
  further synthesis (a Warning that just says "look at this" is
  Notice-grade). The A2 reviewer will block-merge a Warning detector
  that doesn't carry that data in its PR description.
- **`Severity::Info` is the floor.** Use it for low-confidence ambient
  signal — patterns the user might find interesting at the bottom of
  the archive, not signal that earns a top-N slot on the home tab.
  Cost-hot-streak baselines, idle teammates, and other "FYI" patterns
  belong here.

Severity does not cap visibility — every finding flows to the same
projection regardless of severity. What it gates is *attention*: the
workspace home tab severity-sorts (`Warning` > `Notice` > `Info`)
within its top-N window, so a single Warning crowds out three Notices.
A Warning that fires once a session and is wrong half the time will
push useful Notices off the surface; that's the pressure to default
low.

If you need to flip a detector's severity later (calibration data
suggests it should escalate or de-escalate), bump the detector's
`VERSION` constant per §3 and adjust the `impact_override` default in
`src/defaults.rs`. Old findings stay attached to their original
detector version, so the change doesn't retroactively rewrite the
archive.

---

## 7. References

- **Spec:** `core-docs/roadmap.md` §"Phase 21.A — Frontloadable
  detectors". Frozen contracts are §"Locked contracts (frozen by
  21.A1)". Lane 0 ADR is §"Lane 0 — ADR addendum".
- **ADR:** `core-docs/adr/0002-v1-scoping-decisions.md` — §"Addendum
  (2026-04-26)" governs additive `EventPayload` variants.
- **Track 13.K (Friction):** shares the `Anchor` enum and the
  Settings IA section ("Activity → Friction" + "Activity → Designer
  noticed"). Coordinate any Anchor-shape changes through that
  track's spec.
- **Forge source:** `~/Desktop/coding/forge/` (Phase 21.A1 author's
  dogfood checkout). Citations point at specific files + lines.
