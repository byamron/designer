#!/usr/bin/env bash
# Install the `designer` CLI into ~/.cargo/bin so agent subprocesses can
# call it directly. Pairs with the in-app Friction triage page: file
# friction in the desktop app, then `designer friction list --json` from
# any Claude Code / Codex CLI / shell agent to triage and fix.
#
# First-time install just works. To upgrade an existing install, pass
# --force — the explicit gesture is to avoid silently clobbering a
# `designer` binary the user installed by other means (system package,
# different checkout, etc.). --debug builds an unoptimized binary for
# faster iteration during CLI development.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_PATH="$REPO_ROOT/crates/designer-cli"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo is required (install Rust from https://rustup.rs)" >&2
  exit 1
fi

FORCE=0
DEBUG=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --debug) DEBUG=1 ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--force] [--debug]"
      echo "  --force    Overwrite an existing 'designer' binary on PATH"
      echo "  --debug    Build an unoptimized binary (faster install)"
      exit 0
      ;;
    *)
      echo "error: unknown flag: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

EXISTING="$(command -v designer 2>/dev/null || true)"
if [[ -n "$EXISTING" && "$FORCE" -ne 1 ]]; then
  EXISTING_VERSION="$("$EXISTING" version 2>/dev/null || echo unknown)"
  echo "designer is already installed:" >&2
  echo "  path:    $EXISTING" >&2
  echo "  version: $EXISTING_VERSION" >&2
  echo "" >&2
  echo "Re-run with --force to overwrite, or remove the existing binary first." >&2
  exit 1
fi

CARGO_FLAGS=("--locked" "--force")
if [[ "$DEBUG" -eq 1 ]]; then
  CARGO_FLAGS+=("--debug")
fi

echo "==> Installing designer CLI from $CRATE_PATH"
cargo install --path "$CRATE_PATH" "${CARGO_FLAGS[@]}"

INSTALLED="$(command -v designer 2>/dev/null || true)"
if [[ -n "$INSTALLED" ]]; then
  echo "==> Installed: $INSTALLED"
  designer version
  echo
  echo "Try:"
  echo "  designer friction list                 # TSV of all friction"
  echo "  designer friction list --state open    # only open"
  echo "  designer friction list --json          # for agent consumption"
  echo "  designer help                          # full reference"
else
  echo "warning: cargo install succeeded but \`designer\` is not on PATH." >&2
  echo "         Make sure ~/.cargo/bin is in PATH." >&2
  exit 0
fi
