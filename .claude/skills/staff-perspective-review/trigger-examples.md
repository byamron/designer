# staff-perspective-review — trigger examples

## Should fire

1. "Run a multi-perspective review on this PR."
2. "Get a staff review before I open this for human review."
3. "Run three perspectives on PR #72."
4. "Polish pass on the dogfood-readiness branch before I look."
5. "Independent eyes on this — what would three staff reviewers catch?"

## Should NOT fire

1. "Audit this PR for a11y." *(→ audit-a11y)*
2. "Security review of the auth changes." *(→ security-review)*
3. "Did I miss any tokens in this diff?" *(→ enforce-tokens)*
4. "Find related components I should reuse." *(→ check-component-reuse)*
5. "Generate a settings panel." *(→ generate-ui)*
6. "Merge this PR." *(out of scope; this skill never merges)*
7. "Review the spec doc edit." *(doc-only — overhead exceeds value)*

## Notes on calibration

- The skill is most useful for PRs that ship UI + Rust + IPC together — three perspectives have something to say. A pure CLI / pure backend / pure docs PR drops to one or two perspectives; the gotcha guidance covers that.
- Dogfood-readiness PRs (anything in the Lane 0–2 sequence, or the DP-A/B/C lanes) benefit most because they're shipping to the user's own machine — the cost of regressions lands on the same person who triggered the review.
- The skill ends with the PR open. The user reviews next; merging is a separate decision, not implied by review success.
