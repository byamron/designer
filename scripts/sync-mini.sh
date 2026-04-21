#!/usr/bin/env bash
# Re-sync Mini's "track closely" files. Fork-and-own files are not touched.
# Configure MINI_PATH below if you move Mini somewhere else.
set -euo pipefail
MINI_PATH="${MINI_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && grep -oE '^\- \*\*Source:\*\* .+$' packages/ui/MINI-VERSION.md 2>/dev/null | awk '{print $NF}' || echo '')}"
if [[ -z "${MINI_PATH}" || ! -d "${MINI_PATH}" ]]; then
  echo "Set MINI_PATH to the mini-design-system checkout path." >&2
  exit 2
fi
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$MINI_PATH/tools/sync/update.sh" "$DEST" "$@"
