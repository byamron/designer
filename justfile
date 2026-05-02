# Designer — local dev recipes. Run `just` to list, `just <recipe>` to run.
# See core-docs/testing-strategy.md for the layering this maps onto.

set shell := ["bash", "-uc"]

# Show all recipes.
default:
    @just --list

# Fast inner-loop check while writing code: hot crates + frontend only. Target <10s.
test-fast:
    cargo test -p designer-core -p designer-safety -p designer-sync --locked
    npm --workspace @designer/app run test -- --run

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
