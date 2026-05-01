# Packaging, Signing, Notarizing

Designer ships as a signed and notarized `.dmg` for macOS. The release
pipeline is automated via GitHub Actions
(`.github/workflows/release.yml`) — push a `v*` tag to trigger a build,
sign, notarize, sign-the-updater, and publish-to-Releases run.

## Triggering a release

```sh
# From a clean main branch:
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions runs the `release.yml` workflow:

1. Builds on `macos-latest` against the `aarch64-apple-darwin` target.
2. `tauri-action` imports the Apple `.p12` into a temporary keychain,
   signs every binary in the bundle with `Developer ID Application: …`,
   and produces both `.app` and `.dmg` artifacts.
3. `notarytool` uploads the `.dmg` to Apple, polls for acceptance, and
   staples the ticket on success.
4. The Tauri updater minisign keypair signs the updater bundle
   (`.app.tar.gz`) and the `latest.json` manifest the running app
   verifies.
5. All artifacts upload to a fresh GitHub Release tagged `v0.1.0`.

The running Designer instance reads
`https://github.com/byamron/designer/releases/latest/download/latest.json`
on launch (frontend `UpdatePrompt` calls the updater plugin's `check()`).
On update found, the user is prompted; the update is never applied
silently.

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
