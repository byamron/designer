# Packaging, Signing, Notarizing

Designer ships as a signed and notarized `.dmg` for macOS. This document
captures the ship pipeline; it is intentionally manual until the first
shippable build lands.

## Prerequisites

- Apple Developer account.
- Developer ID Application certificate installed in the macOS keychain.
- An app-specific password for `notarytool` uploads.
- `tauri` CLI (`cargo install tauri-cli`) and Rust stable.

## Build the app

```sh
# 1. Frontend assets
npm run build

# 2. Tauri bundle (outputs .app + .dmg into apps/desktop/src-tauri/target/)
cargo tauri build --target aarch64-apple-darwin
```

## Sign

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
codesign --deep --force --options runtime \
  --sign "$APPLE_SIGNING_IDENTITY" \
  --entitlements apps/desktop/entitlements.plist \
  "apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Designer.app"
```

## Notarize

```sh
xcrun notarytool submit \
  "apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Designer.dmg" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_SPECIFIC_PASSWORD" \
  --wait

xcrun stapler staple \
  "apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Designer.dmg"
```

## Auto-update

The Tauri updater requires a versioned `latest.json` served over HTTPS with an
Ed25519 signature. The pipeline:

1. CI produces a signed `.dmg`.
2. Post-release script updates `latest.json` with the new version, download URL,
   SHA-256, and signature.
3. Designer instances check that endpoint at launch + on user request.
4. On update found, we prompt the user; the update is never applied silently.

The signing key for updates lives in `~/.tauri/designer.key`. Rotate with
care; rotating invalidates auto-update for older installs and requires a
manual download of the new build.

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
