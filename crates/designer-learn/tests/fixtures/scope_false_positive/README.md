# `scope_false_positive` fixture (positive trigger)

Three `ScopeDenied` events on the canonical path `src/foo/bar.rs`, each
followed by an `ApprovalRequested` whose summary names the path and an
`ApprovalGranted` for the same `approval_id`. The third denial is
written as `./src/foo/bar.rs` so the canonicalization step (strip `.`
component) is exercised by the fixture, not just the unit tests.

The detector emits one `Finding` (kind `scope-rule-relaxation` evidence
under Phase B's synthesis pass; Phase A only persists the finding). The
`expected.json` asserts the detector-stable fields — `id`, `timestamp`,
`window_digest`, `evidence`, and `confidence` are not asserted because
they are volatile across runs.

A sibling fixture `scope_false_positive_negative/` exercises the
threshold edge: same denial pattern with no override events. The
detector should emit nothing.
