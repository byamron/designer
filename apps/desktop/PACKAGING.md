# Packaging, Signing, Notarizing

Designer ships as a signed and notarized `.dmg` for macOS. The release
pipeline is automated via GitHub Actions
(`.github/workflows/release.yml`) — push a `v*` tag to trigger a build,
sign, notarize, sign-the-updater, and publish-to-Releases run.

## Routine release

Standard happy-path: bump the version in the conf, tag it, push the tag.
The release workflow does the rest. Allow ~10–20 min end-to-end
(notarization is the long pole).

```sh
# From a clean main branch with everything you want to ship merged:
git checkout main && git pull

# 1. Bump tauri.conf.json "version" — MUST match the tag you'll push.
#    e.g. "0.1.0" → "0.1.1". The running app compares its built-in
#    version against latest.json's; if they don't match, the updater
#    has nothing to offer and the prompt never fires.
$EDITOR apps/desktop/src-tauri/tauri.conf.json

# 2. Commit the bump (PR or direct-to-main, your call).
git commit -am "chore: bump version to 0.1.1"
git push

# 3. Tag and push. The tag NAME must equal "v" + the conf version.
git tag v0.1.1 && git push origin v0.1.1
```

What the workflow does on a `v*` tag push (`.github/workflows/release.yml`):

1. Builds on `macos-latest` against `aarch64-apple-darwin`.
2. `tauri-action` imports the Apple `.p12` into a temporary keychain
   and signs every binary with `Developer ID Application: …`.
3. `notarytool` uploads the bundle to Apple, polls for acceptance,
   and staples the ticket on success.
4. The Tauri updater minisign keypair signs the updater bundle
   (`.app.tar.gz` → `.app.tar.gz.sig`) and `latest.json`.
5. Four artifacts publish to a fresh GitHub Release tagged with the
   pushed tag: `Designer_<version>_aarch64.dmg`,
   `Designer_aarch64.app.tar.gz`, `Designer_aarch64.app.tar.gz.sig`,
   `latest.json`.

Running Designer instances read
`https://github.com/byamron/designer/releases/latest/download/latest.json`
on launch (the `UpdatePrompt` component calls the updater plugin's
`check()`). On update found, the user sees a prompt; the update is
never applied silently.

### Critical invariants

- **Tag = `v` + conf version.** `git tag v0.1.1` must match
  `tauri.conf.json` `"version": "0.1.1"`. Mismatch → the auto-updater
  silently no-ops because the running app already thinks it's at the
  manifest version.
- **Versions are monotonic.** The updater compares semver; never
  reuse a version number, never tag a lower version on a newer
  commit. If a release is broken, prefer bumping forward
  (`v0.1.1 → v0.1.2`) over deleting + retagging.
- **One tag, one release.** Don't push the same tag twice. If you
  need to retry a failed release, see "Recovering from a broken
  release" below.
- **PR ≠ release.** Merging a PR puts code on main but ships nothing.
  Releases only happen on `v*` tag pushes; you can batch many merged
  PRs into one release.

### Cadence guidance

For dogfood, weekly is a reasonable rhythm — frequent enough to catch
regressions before they pile up, infrequent enough to keep the version
log readable. Cut a release when you have ≥1 user-visible change worth
delivering; skip the week if it would be a no-op bump.

## Recovering from a broken release

If a tag pushed but produced bad artifacts (missing `latest.json`,
notarization skipped, wrong version in conf, etc.), prefer bumping
forward to a new version:

```sh
git checkout main && git pull
# fix the underlying bug, bump conf to the next version, commit
git tag v0.1.2 && git push origin v0.1.2
```

The broken Release stays in the history as a no-op; the next install
or update jumps over it. This is almost always the right call —
nobody can downgrade past the broken one because monotonic comparison
will reject it.

**Only delete + retag the same version** if no user has installed
that version yet (e.g. minutes after the broken release went live and
you haven't shared the link). Otherwise you risk replacing a Release
that someone has already pinned a download URL for. The recovery
sequence:

```sh
gh release delete v0.1.0 -R byamron/designer --yes
git push origin --delete v0.1.0
git tag -d v0.1.0
git tag v0.1.0 && git push origin v0.1.0
```

## App icon

Source lives at `apps/desktop/src-tauri/icons/icon.png` (1080×1080
RGBA with the dark "d" mark composited on the app's `--color-background`
sand tile, `#f3f3f2` ≈ `color-mix(in oklab, sand-3 80%, sand-1)`). The
sand background matches the app chrome so the dock icon reads as a
continuation of the surface, not a chip floating on it.

To regenerate after editing the source:

```sh
cd apps/desktop
npx @tauri-apps/cli icon /path/to/source-1080.png
# Prune everything except 32x32, 128x128, 128x128@2x, icon.png, icon.icns
# (Designer is macOS-only; the iOS / Android / Windows-tile assets the
# CLI also produces are dead weight in our repo.)
cd src-tauri/icons && rm -rf android ios Square*.png StoreLogo.png icon.ico 64x64.png
```

Five files referenced from `tauri.conf.json` `bundle.icon` (the four
PNGs) plus `icon.icns` (consumed by the macOS bundler at sign time).

## Required GitHub secrets

Both Apple credentials and Tauri updater credentials live as GitHub
Actions repository secrets (Settings → Secrets and variables → Actions):

| Secret | Source |
|---|---|
| `APPLE_CERTIFICATE` | `base64 -i developer-id.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | password set during `.p12` export |
| `APPLE_SIGNING_IDENTITY` | full identity string (e.g. `Developer ID Application: Benjamin Yamron (79F5LGBX74)`) |
| `APPLE_TEAM_ID` | 10-char team ID |
| `APPLE_API_KEY` | full contents of the App Store Connect `.p8` file |
| `APPLE_API_KEY_ID` | 10-char Key ID |
| `APPLE_API_ISSUER_ID` | UUID Issuer ID |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/designer-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty for v0.1.0 (no passphrase set) |

The Tauri updater public key lives in `tauri.conf.json` (`plugins.updater.pubkey`); the app verifies every update bundle's signature against it before applying. Lose the private key and you lose the ability to ship updates to existing installs — back up `~/.tauri/designer-updater.key` somewhere safe (1Password works well).

## Manual build (rare)

For local testing before tagging:

```sh
# Frontend assets
npm run build

# Tauri bundle (outputs .app + .dmg into apps/desktop/src-tauri/target/)
APPLE_SIGNING_IDENTITY="Developer ID Application: Benjamin Yamron (79F5LGBX74)" \
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/designer-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
cargo tauri build --target aarch64-apple-darwin
```

A locally-built `.app` is signed but not notarized; double-clicking it
on a clean machine will trigger Gatekeeper. Right-click → Open once, or
notarize manually via `xcrun notarytool submit`.

## Helper binary

Designer ships the Swift Foundation Models helper (`helpers/foundation/`)
**inside** the `.app` bundle, at `Contents/MacOS/designer-foundation-helper`
alongside the main executable. This follows the Chrome / Electron / VS Code
convention: one signing pass, atomic updates (helper version never skews from
the app), hardened-runtime compatible, and no user-space install step.

### Dev (Phase 12.B, today)

```sh
./scripts/build-helper.sh
```

Artifact stays at `helpers/foundation/.build/release/designer-foundation-helper`.
`AppConfig::default_in_home()` resolves this path automatically when Designer
is run via Cargo. Override with `DESIGNER_HELPER_BINARY=/abs/path/to/binary`.

### Production (Phase 16)

The `cargo tauri build` step above needs an `externalBin` entry (or equivalent
post-build copy) that places the release helper at
`Contents/MacOS/designer-foundation-helper` inside the bundled `.app`. The
`codesign --deep` invocation then signs it under the same Developer ID as the
main binary; no separate signing pipeline.

Runtime resolution: when Designer detects it's running from a `.app` bundle
(parent path contains `Contents/MacOS`), `AppConfig::default_in_home()`
resolves the helper to `<current_exe>/../designer-foundation-helper` — the
path that the signed bundle guarantees.

### Fallback

If the helper binary is missing, fails a 750ms boot ping, or is disabled via
`DESIGNER_DISABLE_HELPER=1`, Designer continues with on-device features
disabled and surfaces a structured `fallback_reason` through the
`helper_status` IPC. See `core-docs/integration-notes.md` §12.B for the full
taxonomy and the recovery routing (`user` / `reinstall` / `none`).

## Crash reports

Default: disabled. When enabled, reports are JSON files in
`~/.designer/crashes/`. No upload happens without an explicit user click in
Settings → Privacy.

## Install QA checklist

- [ ] `.dmg` opens without Gatekeeper warnings on a fresh Mac.
- [ ] First launch creates `~/.designer/` with event DB, crash dir, config.
- [ ] Dark mode parity — all surfaces readable in both modes.
- [ ] Reduced-motion — streaming, pulses fall back to static.
- [ ] Cmd+K works across first + second windows.
- [ ] Offline: app starts, creates projects/workspaces, writes to local DB.
- [ ] Auto-update check shown in Help menu; no silent install.
