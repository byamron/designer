# Getting updates into the desktop app

**Short answer:** you never reinstall. You update by clicking *Update & Restart*; Designer pulls the new version of its own
code, rebuilds, and relaunches itself. Your chats and settings are kept (they live in `~/.designer-chat`, not in the app).

## Who is who
- **The app you work in** (`Designer.app`, running your *stable* copy of the repo, on `main`). It is never edited.
- **Your working repo + worktrees.** Claude changes code here; you preview it with the dev copy (see
  [self-hosting.md](self-hosting.md)). Changes reach `main` through pull requests ([pr-protocol.md](pr-protocol.md)).
- **Updating the app you work in = pulling `main` into the stable copy.** That is the only step this document is about.

## The flow
1. You (or the orchestrator) merge a PR into `main` on GitHub.
2. Designer checks quietly at launch (and any time via **Designer > Check for Updates…**). If `main` has new commits you
   get a native dialog listing what changed: *Update & Restart* or *Later* (it will not ask again about the same version).
3. *Update & Restart* does exactly this, in order: fetch, **fast-forward only**, reinstall dependencies **only if** a
   `package.json`/lockfile changed, rebuild the UI, stop the server (running turns stop; chats are kept), relaunch.
4. The window comes back with your chats, window size and workspaces as they were. Typical time: seconds when only code changed;
   about a minute when dependencies changed.

## Safety rules (all tested against real git repositories)
- It refuses, and changes nothing, if the copy has uncommitted changes, is not on `main`, or has commits `origin/main` lacks.
  The copy you run should never be edited.
- It only ever fast-forwards: no merges, no rebases, no force.
- If the install or build fails, the checkout is put back exactly as it was and you get an error with the last lines of output.
  The previous version keeps running (you never end up with a half-updated app).
- It never touches your worktrees, branches, chats or settings.
- Updates are fetched with your own git credentials from your Mac; the app stores none.

## Where it runs from, and what that means
- Today the desktop app runs **from a checkout of the repo** (`npm run app`, later a double-click launcher). That is why updating
  is just `git` plus a rebuild, and why Node must be installed on your Mac.
- Later, if others install it, we add signed releases with a conventional auto-updater. Not needed for a one-person dogfood loop,
  and it is more machinery (signing, notarization, hosting) for the same result. See roadmap R9.

## Smooth-update ideas, in order
1. **Done:** menu item, launch check, dialog with the change list, fast-forward, rebuild, relaunch, rollback.
2. **Next:** show the changes as plain-language release notes (the PR titles), and an "Updated" toast after relaunch.
3. **Next:** warn before restarting if a turn is running, with a "wait until it finishes" option.
4. **Later:** update in the background and only ask for the restart.

## Needs your Mac
The real thing: a stable clone on `main`, a PR merged on GitHub, then Designer > Check for Updates…. Also that `npm` is found when
the app is launched from the Dock (it uses your login shell's PATH).
