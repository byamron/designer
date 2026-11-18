# PR protocol for parallel projects

Every project in [parallel-work.md](parallel-work.md) follows this. It exists so an **orchestrator** (a person or an agent)
can merge several PRs in order without surprises.

Base branch for everything: **`main`** ("the base"). `main` is the single source of truth; the old Tauri app is archived (see README).

## 1. Set up
```sh
git fetch origin
git switch -c feat/<project> origin/main   # or confirm your worktree is already on such a branch
npm install
npm run typecheck && npm test && e2e/run.sh        # baseline BEFORE you change anything
```
Write down any failure that already exists; do not "fix" unrelated failures in your PR (report them instead).
`e2e/run.sh` needs Playwright browsers: `npx playwright install chromium` once.

## 2. While you work
- Tests first (the spec lists them). Small commits with plain messages (`images: store attachments owner-only`).
- Stay in the files the spec says you own. Small edits elsewhere are fine and must be listed in the PR (section "Touched outside owned files").
  If you need a big change in someone else's file, stop and say so in the PR instead of doing it.
- **Do not edit** `docs/roadmap.md`, `docs/plan.md`, `docs/needs-local-testing.md`, `docs/parallel-work.md`, `README.md`, `CLAUDE.md`
  (the orchestrator updates these after merging so they never conflict). Put roadmap/Mac-testing notes in the PR body.
  You may add/update a spec or docs file that is specific to your project.
- Do not add dependencies unless the spec requires it. If you must, say so in the PR and keep `package-lock.json` changes to exactly that.
- New CSS goes in a new file under `packages/web/src/styles/` imported from `main.tsx`. Use tokens from `styles.css`.
- Follow CLAUDE.md: scaffold, don't replace; never read/store/log credentials; chat stays pass-through.
- Never push to `main` directly; open a PR. Never force-push anything except your own feature branch (`--force-with-lease`).

## 3. Definition of done (all must be true before the PR leaves draft)
- [ ] Acceptance tests from the spec exist and pass.
- [ ] `npm run typecheck`, `npm test` and `e2e/run.sh` pass (paste the summary lines in the PR).
- [ ] New interactive UI: visible inset focus ring, keyboard path, `prefers-reduced-motion` respected, tokens only (no stray px/hex).
- [ ] Anything that touches the network, files or processes has a test for the unsafe cases (see the spec's Security section).
- [ ] You looked at it in a real browser (screenshot in the PR for anything visual).
- [ ] Items that only a Mac/real account can verify are listed in the PR body under "Needs Mac".

## 4. Open the PR
```sh
git push -u origin feat/<project>
gh pr create --draft --base main \
  --title "[<project>] <one-line summary>" --body-file <your filled-in copy of .github/pull_request_template.md>
```
If `gh` is not available, push and give the compare URL
`https://github.com/byamron/designer/compare/main...feat/<project>` and the PR text to paste.
Mark ready for review only when section 3 is all ticked. **Do not merge. Do not enable auto-merge.**
The PR body must contain the fenced `orchestrator` block from the template, filled in (it is machine-read).

## 5. When the orchestrator asks you to update
```sh
git fetch origin
git rebase origin/main
npm install && npm run typecheck && npm test && e2e/run.sh
git push --force-with-lease
```
Resolve conflicts by keeping both sides' intent (both union-type members, both switch cases, both imports). Re-run everything.
Update the `orchestrator` block's `checks` and `base-sha` afterwards.

## For the orchestrator
Merge in `merge-order` (ties: smaller first). For each PR:
1. Check the `orchestrator` block: `depends-on` merged? `new-dependencies` acceptable? `touched-outside-owned` sensible?
2. Ask the author to rebase if the base moved (section 5), or rebase it yourself.
3. Re-run `npm run typecheck && npm test && e2e/run.sh` on the PR branch; merge (squash is fine; keep the `[project]` title).
4. After merging all (or after each, if you prefer): update `docs/needs-local-testing.md` from the PRs' "Needs Mac" lists,
   `docs/roadmap.md` / `docs/plan.md` status, and run the full suites once on the base.
5. Conflict rules: union types, switch cases and imports keep both; styles are separate files by design; if two PRs changed the
   same function body, the later PR's author reconciles (ask them), do not guess.
6. Never merge a PR whose `checks` are not all pass, whose Needs-Mac list is missing, or that edited the "do not edit" docs.
