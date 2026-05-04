# Roadmap format

The Roadmap canvas (Phase 22.A) reads `core-docs/roadmap.md` as a tree of nodes
keyed by stable HTML-comment **anchors**. This document describes the
conventions Designer enforces — none of them are hard requirements (the
canvas degrades gracefully when they're missing), but following them keeps
agent claims, status projections, and shipment history aligned across
edits.

## Anchors

Every heading should carry a stable id encoded as an HTML comment on the
line directly after the heading:

```md
## Phase 22.A — Roadmap canvas foundation
<!-- anchor: phase22.a -->
```

- The anchor id may use `[A-Za-z0-9._-]`. Designer auto-injects anchors
  for any heading that doesn't have one — first-class authored anchors
  are preferred so external tools (an issue tracker, a doc) can link
  back to a specific node.
- An anchor on the same line as the heading is also accepted:
  `## Phase 22.A <!-- anchor: phase22.a -->`.
- Anchors inside a fenced code block (` ``` `) are ignored.

## Anchor splitting

When you split a node into two in the markdown:

- The original anchor stays with the heading whose first-line text most
  closely matches the original.
- **Edge case (both halves diverge).** If neither resulting heading
  retains the original first-line text, the anchor follows the **first
  heading in file order**. The other heading gets a fresh slug-derived
  id. This rule is deterministic on every parse, so the same edit
  always produces the same outcome.

Existing claims and shipments resolve against whichever heading kept the
anchor — there's no automatic migration. If you need to re-attach a
claim, edit the in-flight track's anchor in `roadmap.md` directly.

## Authored status markers

A status marker tucked into the heading text seeds the node's authored
status. Recognized markers:

| Marker | NodeStatus |
|---|---|
| `(backlog)` | `Backlog` |
| `(todo)` | `Todo` |
| `(in progress)` / `(in-progress)` | `InProgress` |
| `(in review)` / `(in-review)` | `InReview` |
| `(done)` / `(shipped)` | `Done` (subject to the Done-gate below) |
| `(canceled)` | `Canceled` |
| `(blocked)` | `Blocked` |

The marker is stripped from the rendered headline.

## Track lifecycle → NodeStatus

When a track claims a node (via `cmd_start_track` with an `anchor_node_id`),
the node's projected status is **derived from the track's lifecycle state**
rather than the authored marker:

| Track state | Node status |
|---|---|
| `Active` | `InProgress` |
| `RequestingMerge` / `PrOpen` | `InReview` |
| `Merged` (with `NodeShipment`) | `Done` |
| `Merged` (no shipment yet) | `InReview` (transient) |
| `Archived` (without merge) | `Canceled` |
| `Archived` (after merge) | unchanged (`Done` sticks) |

## Multi-claim status precedence

When more than one track claims the same node, the projection takes the
**maximum** state across claiming tracks under an **all-must-ship Done
gate**:

- Order: `Backlog < Todo < InProgress < InReview < Done < Canceled`.
- The node projects the max of the claiming tracks' statuses, **except**
  `Done` is only emitted when *every* claiming track has a recorded
  `NodeShipment`. If any claim is unshipped, the node projects
  `InReview`.
- Multi-claim labels in the canvas sort by `claimed_at` ascending; ties
  break on `track_id` lexicographic. The order is stable across
  event-replay.

Multi-claim is parallel work toward one node, not a race. The node is
Done only when the work — all of it — is shipped.

## Done = shipped

A node may only sit at `Done` when a corresponding `NodeShipment` record
exists. Two enforcement paths share the same shipment-evidence gate:

1. **Projection path.** The `Track.state → NodeStatus` projection only
   emits `Done` when both `Track::Merged` and the matching shipment are
   present. Without a shipment, the projection emits `InReview` even on
   merged.
2. **IPC write path.** `cmd_set_node_status(node, Done)` rejects with
   `ApplyFailed { reason: "node has no shipment recorded" }` if no
   shipment exists. The error surfaces in the user's inbox.

The same gate applies to authored `(done)` markers in the markdown: a
heading authored `(done)` whose node has no recorded shipment renders as
`InReview` on the canvas, with a tooltip explaining why. This keeps the
rendering honest — a checklist that "looks Done" but hasn't shipped is
still in flight.

## Anchor write-back

The first time Designer parses your `roadmap.md` it injects anchors for
every heading that doesn't have one. The write is gated:

- The on-disk file mtime must be at least 5 seconds old. Fresh saves
  are presumed to be the user actively editing in another tool.
- The source on disk must still match what the parser saw. If a
  concurrent edit slipped in, the write aborts.
- The write is atomic (tmp file + rename) so a partial write can never
  truncate `roadmap.md`.

If you'd rather author anchors yourself before the first parse, just add
the comment lines — Designer won't touch a heading that already has one.

## Re-parse trigger

The canvas re-parses on `(mtime, size, content_hash)` change — touch
without an edit, `git checkout` that moves mtime backward, or a noisy
filesystem clock will not cause spurious re-parses. The frontend
re-fetches the roadmap when the Designer window regains focus, so an
external edit shows up the next time you switch back.
