# Designer.app (roadmap R6)

**Goal:** a real double-click `Designer.app` that can be updated from inside the app, with no terminal in daily use.

## Decision: (a) a renamed copy of Electron.app with a shim, not (b) a launcher that execs the checkout's Electron

Both were built and launched on a Mac (Electron 45.3.4, Apple Silicon, macOS 15).

| | (a) copy of `Electron.app` | (b) launcher whose `Contents/MacOS/Designer` execs the checkout's `Electron` |
|---|---|---|
| Name and id macOS sees (`lsappinfo`) | `"Designer"`, `app.designer.chat`, bundle path is the app | `"Electron"`, `com.github.Electron`, bundle path is inside `node_modules` |
| Dock label, Cmd-Tab, "Keep in Dock", `open -a Designer` | Designer, its own icon, pins the app | Electron's name and icon; "Keep in Dock" pins `node_modules/.../Electron.app`; the launcher bundle is not the running app |
| Activity Monitor, Force Quit | Designer | Electron |
| Electron version | the bundle's copy; must be refreshed when the checkout's Electron changes | always the checkout's |
| Cost | 255 MB per bundle, built in about 1.3 s (APFS clone, no extra disk until it diverges); re-sign ad hoc | a few KB |

(b) is simpler but the app is not really Designer to macOS, which was the point of this work. (a) costs one extra mechanism:
the bundle must follow the checkout's Electron version. That is handled (below), and is rare (Electron bumps only).

## How it works
- `npm run make-app` (`scripts/make-app.mjs`, `packages/desktop/bundle.mjs`): builds the UI, makes sure Electron's binary is
  downloaded (Electron 45+ no longer downloads it at `npm install`; its own `install.js` does it, and does nothing if it is there),
  clones `node_modules/electron/dist/Electron.app`, renames the executable, sets name / id `app.designer.chat` / icon in `Info.plist`,
  puts `packages/desktop/shim/` in `Contents/Resources/app`, writes `Contents/Resources/designer.json`
  (`{format, checkout, electron}`) and ad-hoc signs it (`codesign --sign -`: no certificate or Apple account; Apple Silicon needs a
  signature after the plist edit). It is assembled and signed next to its final path and moved in with a rename, so a failed build
  leaves an existing app untouched.
- **The bundle holds no Designer code.** The shim (`main.cjs`) reads `designer.json`, finds the checkout and imports its
  `packages/desktop/main.mjs`. A git update therefore changes what runs without touching the bundle. Updates stay
  fetch, fast-forward, install if needed, build, relaunch.
- **Finding the checkout:** the path is stored in `designer.json` at build time (default: the checkout `make-app` runs from).
  If it is missing or moved, the app shows what it looked for and offers *Choose Folder…*: it runs the chosen checkout's own
  `make-app` (as plain Node, with the app's own Electron) to re-point this app, then relaunches. `DESIGNER_CHECKOUT` overrides the
  path (tests).
- **Following Electron:** after *Update & Restart* (and at launch, for a checkout updated in a terminal) the shell compares the
  checkout's Electron version with `designer.json`. If they differ it rebuilds the bundle with the new checkout's `make-app`
  (downloading the new Electron first), then relaunches. A failed rebuild leaves the old working app and is logged; the next launch
  offers to retry. The shim has a `format` number for changes to the bundle layout itself.
- **Never replaces an app that is not ours:** without `--force`, a different app at `--out` is left alone. `/Applications/Designer.app`
  may be the old Tauri app (`com.benyamron.designer`); that is why the bundle id differs and why the default is refused until you choose.
- **No credentials:** nothing here reads, stores or logs them; every child process (`install.js`, the builder) gets an environment without
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, and `main.mjs`'s own stripping before the server starts is untouched.

## Rolling back a bad update
An update that installs and builds can still leave a broken or unwanted app, and Designer is the tool used to fix Designer, so the way
back must not need a terminal. User-facing behaviour is in [../updates.md](../updates.md); the design:
- **Record.** After a successful update the shell writes `previous-version.json` in userData: `{from, to, time, installed, electron:{from,to},
  healthy, attempts}`. Only full 40-hex commit ids are accepted when reading it back, so a damaged or foreign file can never hand git an
  arbitrary argument. One step back only (the last update).
- **Operation: `git reset --keep <from>` on `main`, never `--hard`, `revert` or `checkout`.** `--keep` refuses without changing anything if a
  local change would be overwritten (tested), so even a bug in the blocker cannot lose work. `revert` adds commits that `origin/main`
  lacks and would break fast-forward updates for good; `checkout` detaches `HEAD`, which the updater refuses. Rollback additionally requires
  that the recorded `to` is still `HEAD` and `from` is an ancestor of it, and reuses the updater's `main`-and-clean rule (`checkoutBlocker`).
  Untracked files count as "not clean", exactly as for updates.
- **Mirror of the update**: reinstall only if package files differ between the two commits, rebuild the UI, refresh the app shell
  (`refreshShell`) if the Electron version differs, stop the server, relaunch. On any failure: `git reset --keep` back to where we were,
  reinstall if needed, rebuild, and say what happened (also if the restore itself failed).
- **Skip, not forget.** The version rolled back from is written as the "Later" dismissal (`update-dismissed.txt`) so the quiet launch check
  stays silent about it; a newer `origin/main` differs from it and is offered; **Check for Updates…** ignores dismissals. The record is
  then cleared (the previous version is the current one) and the menu item greys out.
- **Menu item** is enabled only when the record applies and the copy is clean; it is re-checked at launch and, at most every 2 s, when a
  window gains focus. Clicking while disabled-by-race re-checks and explains.
- **When the app cannot start.** Each launch on a version that has not yet shown a working window counts as an attempt (`main.mjs` counts
  after taking the single-instance lock; the launcher counts when importing `main.mjs` fails, since `main.mjs` never ran). A version is
  marked healthy once its page has loaded from a running server. After two failed starts in a row the error dialog offers the rollback
  (from `main.mjs` when the server will not come up, from the launcher when the checkout's code will not even load). The rollback code is
  plain CommonJS in `packages/desktop/shim/rollback.cjs`, copied into the bundle with the launcher and used by `main.mjs` and the
  updater alike, because the code that would offer the rollback is what is broken. This bumped the bundle `FORMAT` to 2: an existing
  Designer.app offers *Rebuild & Restart* once at its next launch.
- **No credentials**: npm for the rollback gets the login-shell PATH and no `ANTHROPIC_*` variables; nothing is logged beyond the update log.
- **Tests**: `rollback.test.ts` (real git repos: record, refusal cases, worktrees/branches untouched, package/no-package, failure restore,
  `--keep` refusing, skip logic, attempt counting), `e2e/rollback.e2e.mjs` (macOS: a real update, a real rollback through the menu, the quiet
  check staying silent, and a real broken update rolled back from the launcher's error dialog), `desktop.e2e.mjs` (menu item present and
  disabled with no record).

## Observed on a real Mac
- Finder launch (`osascript tell Finder to open`) and `open` work; single instance holds (`open -n` starts nothing new); `quit`
  stops the server and the app (checked with AppleScript `quit` and `app.quit()`, not a physical Cmd-Q key press).
- No quarantine attribute on a locally built bundle (only `com.apple.provenance`), so there is no Gatekeeper prompt. `spctl --assess`
  says "rejected" (ad-hoc, unnotarized), which only matters for a copy that was downloaded or AirDropped: that one would be quarantined.
- Login-shell PATH: found a bug while checking this. `lib.mjs` ran `printf "…$PATH__END__"`, which the shell reads as a variable
  named `PATH__END__`, so `loginShellPath()` always returned nothing. Fixed (`${PATH}`) and pinned by a stricter test. The app
  launched from LaunchServices here already had your PATH from launchd, so the bug did not show; the e2e now starts the app with a bare
  `/usr/bin:/bin` and checks the server still gets the login-shell PATH.
- Real update on a scratch clone: Electron 45.3.4 → 45.4.1 plus a UI change; fetch, fast-forward, install, build, Electron download,
  bundle rebuilt (signature valid), relaunched on 45.4.1 with the new UI (`docs/screenshots/designer-app/`).

## Not done (on purpose)
Signing with a Developer ID, notarization, auto-update service, release hosting, DMG: roadmap R9. Helper apps inside the bundle
are still named "Electron Helper" (Activity Monitor only).

## Tests
`packages/server/src/desktopapp.test.ts` (layout, plist, icon, foreign-app guard, atomic failure, lazy Electron download, stale
detection, refresh-after-update, shim checkout lookup and missing-checkout message, pinned safety lines); `desktop.test.ts` (stricter
login-shell PATH); `e2e/app.e2e.mjs` (macOS only: builds and launches a bundle, name, server environment, Dock-style PATH, single
instance, quit, missing checkout, Electron-bump rebuild and relaunch).
