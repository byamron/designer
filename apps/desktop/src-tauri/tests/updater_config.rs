//! Updater config invariants. The Tauri updater plugin is opaque to Rust
//! tests, but the *configuration* is a flat JSON file we can validate.
//! These assertions catch the brick-risk class of bug: if any of these
//! drift, every shipped user is stranded on whatever version they have.
//!
//! See `core-docs/testing-strategy.md` §2 (updater tests).

use serde_json::Value;

fn load_tauri_conf() -> Value {
    // Manifest path is relative to the test binary's package
    // (`apps/desktop/src-tauri`), regardless of where `cargo test` is
    // invoked from. `CARGO_MANIFEST_DIR` is set by Cargo for every test
    // build.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = std::path::Path::new(manifest_dir).join("tauri.conf.json");
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

#[test]
fn updater_artifacts_are_built() {
    let conf = load_tauri_conf();
    let active = conf
        .pointer("/bundle/createUpdaterArtifacts")
        .and_then(Value::as_bool)
        .expect("bundle.createUpdaterArtifacts must be present");
    assert!(
        active,
        "bundle.createUpdaterArtifacts must be true — without it, releases ship without the signed update bundle and every user is stranded"
    );
}

#[test]
fn updater_endpoint_is_configured() {
    let conf = load_tauri_conf();
    let endpoints = conf
        .pointer("/plugins/updater/endpoints")
        .and_then(Value::as_array)
        .expect("plugins.updater.endpoints must be present");
    assert!(
        !endpoints.is_empty(),
        "at least one updater endpoint must be configured"
    );
    let first = endpoints[0]
        .as_str()
        .expect("endpoint must be a string URL");
    assert!(
        first.starts_with("https://"),
        "updater endpoint must use https (got `{first}`)"
    );
    assert!(
        first.contains("releases") || first.contains("update"),
        "endpoint should look like a release/update manifest URL (got `{first}`)"
    );
}

#[test]
fn updater_pubkey_is_set() {
    let conf = load_tauri_conf();
    let pubkey = conf
        .pointer("/plugins/updater/pubkey")
        .and_then(Value::as_str)
        .expect("plugins.updater.pubkey must be present");
    assert!(
        !pubkey.trim().is_empty(),
        "updater pubkey must not be empty — without it, signed update verification fails for every user"
    );
    // Minisign public keys are base64-encoded and run ~~100 chars; a
    // sub-50 char value is almost certainly a placeholder.
    assert!(
        pubkey.len() > 50,
        "updater pubkey looks suspiciously short ({} chars) — verify it's a real minisign pubkey",
        pubkey.len()
    );
}

/// Belt-and-suspenders: the version reported in `tauri.conf.json` (which
/// the updater plugin compares against the manifest's `version` field)
/// must match the Cargo workspace version. If they drift, the updater
/// either offers an update to the *current* version or never offers at
/// all.
#[test]
fn tauri_conf_version_matches_cargo_package_version() {
    let conf = load_tauri_conf();
    let conf_version = conf
        .pointer("/version")
        .and_then(Value::as_str)
        .expect("tauri.conf.json must declare a version");
    // `CARGO_PKG_VERSION` is the version the test binary was built at,
    // resolved from this crate's workspace inheritance.
    let cargo_version = env!("CARGO_PKG_VERSION");
    assert_eq!(
        conf_version, cargo_version,
        "tauri.conf.json version (`{conf_version}`) must match Cargo package version (`{cargo_version}`) — release manifests will mis-compare otherwise"
    );
}
