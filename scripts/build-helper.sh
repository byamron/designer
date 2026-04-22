#!/usr/bin/env bash
# Build the Swift Foundation Models helper for Designer.
#
# The binary stays at `helpers/foundation/.build/release/designer-foundation-helper`.
# Designer resolves that path by default when running under Cargo in this
# workspace; export `DESIGNER_HELPER_BINARY` to point at a different build.
#
# Phase 16 bundling copies the release artifact into the signed `.app` at
# `Contents/MacOS/designer-foundation-helper`; no user-space install happens
# at any phase.
#
# Requirements:
#   - macOS 15+ with Apple Intelligence enabled (runtime requirement).
#   - Swift 5.9+ toolchain (build-time requirement).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER_DIR="$REPO_ROOT/helpers/foundation"
BINARY="$HELPER_DIR/.build/release/designer-foundation-helper"

if ! command -v swift >/dev/null 2>&1; then
  echo "error: swift toolchain not found on PATH" >&2
  echo "hint:  install Xcode or the Swift toolchain, then re-run." >&2
  exit 1
fi

echo "==> swift --version"
swift --version | sed 's/^/    /'

echo "==> building helper (release)"
swift build \
  -c release \
  --package-path "$HELPER_DIR" \
  2>&1 | sed 's/^/    /'

if [[ ! -x "$BINARY" ]]; then
  echo "error: build succeeded but binary not found at $BINARY" >&2
  exit 2
fi

SIZE=$(stat -f%z "$BINARY" 2>/dev/null || stat -c%s "$BINARY")
echo "==> artifact"
echo "    path: $BINARY"
echo "    size: ${SIZE} bytes"

echo "==> --version smoke check"
VERSION_LINE="$("$BINARY" --version 2>&1 || true)"
echo "    $VERSION_LINE"
if [[ "$VERSION_LINE" != designer-foundation-helper* ]]; then
  echo "error: --version output did not match expected prefix" >&2
  exit 3
fi

echo
echo "done. Designer will pick this up automatically under Cargo."
echo "to override:  export DESIGNER_HELPER_BINARY=\"$BINARY\""
