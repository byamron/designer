---
name: release
description: Open a version-bump PR for Designer and hand back the terminal snippet to tag and push. Use when the user wants to cut a new release of the Designer macOS app — triggered by `/release`, `/release 0.1.3`, or phrases like "cut a release", "bump the version", "ship a new version", "tag the release". Stops short of tagging — the user runs the tag command themselves so they own the moment of release. Do not use for status questions ("what's the version?") or generic shipping (use `/ship` for that). Do not use to change anything else about the release pipeline; the skill only bumps versions and opens the PR.
---

# Release

Cut a new Designer release — bump versions, open a PR, hand back the terminal snippet for tagging. The skill stops at "PR open + snippet returned" so the user owns the tag-push moment. Tagging is what fires `release.yml`, signs and notarizes the DMG, and publishes `latest.json` for the auto-updater.

## Don't run this for

- A status question ("what version are we on?") — answer directly from `Cargo.toml`.
- A generic ship workflow on a feature branch — use `/ship`.
- Changes to the release pipeline itself (workflows, signing, notarization). That's a regular code change.
- Hot-fixes that need to skip the bump-PR step. Tag manually and document why.

## Procedure

### 1. Pre-flight readiness sweep

Run these in parallel; report a one-screen summary scannable in under 10 seconds, ordered by gating priority. Do not proceed without explicit user confirmation at the end of this step.

| Signal | Command | Behaviour |
|---|---|---|
| Working tree clean | `git status --short` | **Hard block** if any output. |
| CI on `main` green | `gh run list --branch main --workflow=ci.yml --limit 1` | **Hard block** if the latest run is not `success`. |
| Version drift | read `Cargo.toml` `[workspace.package].version`, `apps/desktop/src-tauri/tauri.conf.json` `.version`, `packages/app/package.json` `.version` | **Hard block** if any disagree. |
| Last tag | `git tag --sort=-creatordate \| head -1` | Inform. |
| Commits since last tag | `git log <last>..origin/main --oneline` + `--shortstat` | Inform. Surface count + LOC. |
| Open PRs | `gh pr list --state open` | Inform. Flag anything that looks release-relevant. |
| Friction inbox | `ls ~/.designer/friction/ \| wc -l` | **Show only if > 5.** Otherwise omit. |
| Recent crashes | files in `~/.designer/crashes/` newer than the last tag's date | **Show only if any.** Otherwise omit. |

End the readout with a clear **GO** or **HOLD** recommendation. If HOLD, stop and explain. If GO, suggest the next version (default: patch — see step 2) and ask the user to confirm before proceeding.

### 2. Pick the next version

Default suggestion: **patch bump** (e.g. `0.1.2 → 0.1.3`).

Override:
- If the user invoked with an explicit version (`/release 0.2.0`), use that.
- Suggest **minor** instead of patch if any of:
  - Commit subjects mention `breaking:`, `BREAKING CHANGE:`, or removed/renamed public APIs.
  - The release touches the updater protocol or the Claude IPC contract (`crates/designer-ipc/`, `crates/designer-claude/`, `apps/desktop/src-tauri/tauri.conf.json` `plugins.updater.*`).

In a 0.x project, "minor" is the breaking-change axis and "patch" is everything else. Confirm the chosen version with the user before editing files.

### 3. Bump version files + refresh `Cargo.lock`

Three sources of truth (must stay in sync):

- `Cargo.toml` — `[workspace.package] version = "X.Y.Z"`
- `apps/desktop/src-tauri/tauri.conf.json` — `"version": "X.Y.Z"`
- `packages/app/package.json` — `"version": "X.Y.Z"`

Then refresh the lockfile:

```sh
cargo update --workspace
```

This propagates the version through all 11 `designer-*` workspace crates in `Cargo.lock`.

The Help dialog version display (added as infrastructure in PR #85) reads `package.json` at Vite build time, so future bumps surface in the UI automatically. The skill does **not** touch `vite.config.ts`, `vite-env.d.ts`, or `AppDialog.tsx`.

### 4. Draft the branch + commit + PR (preview before push)

- Branch name: `version-bump-X.Y.Z`. Create from the current `main` (`git checkout -b version-bump-X.Y.Z origin/main`).
- Commit message:
  ```
  chore: bump version to X.Y.Z

  <one-line rationale if non-obvious; otherwise omit body>

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- Build the PR title and body locally. **Do not push or create the PR yet.**

  - **Title:** `chore: bump version to X.Y.Z`
  - **Body** (HEREDOC for `gh pr create` later):
    ```markdown
    ## Summary

    - Bumps workspace + Tauri bundle version `X.Y.<prev> → X.Y.Z` for the next release.
    - <2-3 bullets of headline themes from `git log v<prev>..origin/main --oneline` — only the ones a reader would want to know about. Skip churn.>

    ## Test plan

    - [ ] CI green (rust fmt/clippy/test, frontend, design-system, visual-regression, supply-chain).
    - [ ] After merge, push tag `vX.Y.Z` to trigger `release.yml` (sign + notarize + DMG + `latest.json` + `.sig`).
    - [ ] Confirm the running v<prev> install picks up the update via `tauri-plugin-updater`.
    - [ ] Open Help (⌘?) on the updated install — the About row should read `X.Y.Z · alpha`.

    🤖 Generated with [Claude Code](https://claude.com/claude-code)
    ```

Show the title + body to the user. Ask them to confirm or edit. **Only push and `gh pr create` after they confirm.**

### 5. Push and open the PR

After confirmation:

```sh
git push -u origin version-bump-X.Y.Z
gh pr create --base main --title "chore: bump version to X.Y.Z" --body "$(cat <<'EOF'
<the body from step 4>
EOF
)"
```

Capture the returned PR URL.

### 6. Hand back the terminal snippet + URLs

Output a markdown block ready to paste, with the version pre-filled:

````markdown
PR opened: <PR URL>

After PR merges (and main's CI is green):

```sh
# Tag + push (triggers release.yml — sign + notarize + DMG + latest.json):
git checkout main && git pull origin main && git tag vX.Y.Z && git push origin vX.Y.Z

# Wait briefly for the workflow to register, then watch (~10–15 min total):
sleep 10 && gh run watch $(gh run list --workflow=release.yml --limit=1 --json databaseId -q '.[0].databaseId')
```

**Links:**
- Workflow runs: https://github.com/byamron/designer/actions/workflows/release.yml
- Releases page: https://github.com/byamron/designer/releases
- This release (live once published): https://github.com/byamron/designer/releases/tag/vX.Y.Z

**Verify the update applied:** Launch your existing install. The updater
prompts within a minute or two — accept and let the app relaunch. Open
Help (⌘?). The About row should read `X.Y.Z · alpha`. If it still
shows the old version, quit and relaunch to force a fresh updater check;
if still wrong, look at `~/.designer/logs/designer.log.<today>` for
`updater` lines.

> Release notes pull from `core-docs/history.md`. If you haven't
> documented this release's changes there yet, add an entry before
> merging the bump PR.
````

The `sleep 10` matters: `gh run list --limit 1` immediately after a tag-push can return the *previous* `release.yml` run if GitHub hasn't registered the new one yet.

### 7. Offer a follow-up check

End your reply with a one-line offer to `/schedule` an agent in 24h to verify the release shipped cleanly and the updater handed it out. Don't schedule unprompted. Skip the offer entirely if the run didn't reach the snippet stage.

## Things deliberately excluded

- **No auto-merge.** The user reviews the PR and merges in the GitHub UI (or with `gh pr merge` themselves).
- **No auto-tag.** The user runs the snippet from step 6 — they own the moment of release.
- **No regenerated GitHub Release notes.** `release.yml` sets `releaseBody: "See core-docs/history.md for what shipped."` — leave it alone; `history.md` is the source of truth.
- **No `history.md` / `plan.md` doc updates at release time.** Those happen as part of the underlying feature PRs (or via `/ship`), not here. The snippet output reminds the user to check `history.md` before merging.
- **No `Cargo.lock` hand-edits.** `cargo update --workspace` is the supported path.

## Gotchas

- **Drift across the three version files.** If pre-flight surfaces drift (e.g. `package.json` is stale at `0.1.0` while `Cargo.toml` is on `0.1.2`), do not silently fix it as part of the bump. Surface it to the user — drift means a previous release skipped a file, and they should know.
- **Bump PR's own CI must pass before merging.** Step 6's snippet says "After PR merges (and main's CI is green)." If the user merges before the bump PR's CI completes, the merge commit on main can land with a red status check that delays the next CI cycle.
- **Re-running `/release` after a half-finished run.** If a previous run created the branch but didn't push, the working tree may still hold the bumped files. Pre-flight's "working tree clean" check catches this — do not paper over it.
- **Tag already exists.** `git tag` will fail if `vX.Y.Z` already exists locally. The skill doesn't tag, but if the user re-runs the snippet after a failed release, they'll need to delete the local + remote tag first (`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`). Mention this only if the user asks.
- **Frozen contracts in step 2's "minor" heuristic.** If the release touches `crates/designer-core/src/event.rs` (event vocabulary), `crates/designer-ipc/src/lib.rs` (IPC DTOs), or the `PermissionHandler` / `Anchor` / `Detector` traits, that's an ADR-level change per `CLAUDE.md` § Parallel track conventions. The skill should flag those for the user, not silently roll them into a patch bump.
