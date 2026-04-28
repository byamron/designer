# `example` fixture

Proof-of-life fixture for the [`NoopDetector`]. The detector returns no
findings for any input; `expected.json` reflects that.

Phase 21.A2 detector authors copy this directory:

```sh
cp -r tests/fixtures/example tests/fixtures/<your-detector>
```

Then:

1. Replace `input.jsonl` with the events that should *trigger* your
   detector. One JSON-encoded `EventEnvelope` per line.
2. Replace `expected.json` with the `Finding`s your detector emits.
   Match the shape returned by `serde_json::to_value(&Vec<Finding>)`.
3. Add a fixture-test in `tests/<your-detector>.rs` that loads the
   pair, runs the detector, and asserts equality (modulo non-deterministic
   fields like `id` and `timestamp` — see `tests/example_fixture.rs`
   for the pattern).
