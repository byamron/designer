# Designer — local dev recipes. Run `just` to list, `just <recipe>` to run.
# See core-docs/testing-strategy.md for the layering this maps onto.

set shell := ["bash", "-uc"]

# Show all recipes.
default:
    @just --list

# Fast inner-loop check while writing code: hot crates + frontend tests
# for files changed since HEAD. Target <10s. The `--changed` flag needs
# git context, so this is for local dev — CI uses `just check`.
test-fast:
    cargo test -p designer-core -p designer-safety -p designer-sync --locked
    npm --workspace @designer/app run test -- --run --changed

# Full local check — should pass before pushing. Mirrors CI shape.
check:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
    cargo test --workspace --locked
    npm run -s typecheck
    npm run -s test
    node tools/invariants/check.mjs packages/app/src
    node tools/manifest/check.mjs

# Full Rust workspace tests.
test:
    cargo test --workspace --locked

# Frontend tests only.
test-front:
    npm --workspace @designer/app run test

# Auto-fix style — formatter + clippy fixes that are safe to apply.
fix:
    cargo fmt --all
    cargo clippy --workspace --all-targets --fix --allow-dirty --allow-staged --locked

# Launch Designer in dev mode against a sandboxed event store so the
# branch-under-test can't corrupt the daily-driver's `~/.designer/`.
# Hot-reloads the frontend; Rust edits trigger a rebuild + relaunch.
# Ctrl-C in this terminal kills the app. Use this for inner-loop
# dogfood of an in-progress branch.
dev:
    DESIGNER_DATA_DIR={{justfile_directory()}}/.dev-data cargo tauri dev

# Same as `dev` but shares state with the installed Designer (uses
# the default `~/.designer/`). Use when you want to repro a friction
# report against your real workspace history.
dev-shared:
    cargo tauri dev

# Build a real signed `.app` for local dogfood without cutting a
# release. Lands at apps/desktop/src-tauri/target/release/bundle/
# macos/Designer.app — drag to /Applications. ~5-10 min first build,
# ~1-3 min on rebuilds. Signs with the Developer ID cert in your
# keychain; no notarization (that's the release pipeline's job).
dogfood:
    cargo tauri build --bundles app
    @echo ""
    @echo "Built: apps/desktop/src-tauri/target/release/bundle/macos/Designer.app"
    @echo "Drag to /Applications, or run with a sandbox data dir:"
    @echo "  DESIGNER_DATA_DIR=~/.designer-dev open apps/desktop/src-tauri/target/release/bundle/macos/Designer.app"
