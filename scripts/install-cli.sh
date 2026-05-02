#!/usr/bin/env bash
# Install the `designer` CLI into ~/.cargo/bin so agent subprocesses can
# call it directly. Pairs with the in-app Friction triage page: file
# friction in the desktop app, then `designer friction list --json` from
# any Claude Code / Codex CLI / shell agent to triage and fix.
#
# Re-running upgrades in place (cargo install replaces the binary). Pass
# --debug to install an unoptimized build for faster iteration during
# CLI development.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_PATH="$REPO_ROOT/crates/designer-cli"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo is required (install Rust from https://rustup.rs)" >&2
  exit 1
fi

PROFILE_FLAG=("--locked")
if [[ "${1:-}" == "--debug" ]]; then
  PROFILE_FLAG+=("--debug")
  shift
fi

echo "==> Installing designer CLI from $CRATE_PATH"
cargo install --path "$CRATE_PATH" --force "${PROFILE_FLAG[@]}" "$@"

INSTALLED="$(command -v designer || true)"
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
