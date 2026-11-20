#!/usr/bin/env bash
# Runs each browser suite against a fresh fake-provider server, a fresh temp git repo and empty data.
# Usage: e2e/run.sh [suite ...]   (default: all)    Needs Playwright (npx playwright install chromium).
# Works on Linux and macOS. Each suite gets a free port, so several worktrees can run this at the same time.
set -euo pipefail
cd "$(dirname "$0")/.."
suites=("$@"); [ ${#suites[@]} -eq 0 ] && suites=(ui focus motion selfhost question images inspector tabs)
npm run build >/dev/null

# Start a command in its own process group so the whole server tree can be stopped (a stale server would serve old data to
# the next run). setsid is not on macOS; perl is, and does the same.
if command -v setsid >/dev/null 2>&1; then
  detach=(setsid)
else
  detach=(perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die "exec failed: $!"' --)
fi

status=0
for s in "${suites[@]}"; do
  port=$(node e2e/lib/freeport.mjs)
  repo=$(mktemp -d); data=$(mktemp -d)
  git -C "$repo" init -q -b main
  git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  PORT=$port DESIGNER_CWD="$repo" DESIGNER_FAKE=1 DESIGNER_DATA="$data" "${detach[@]}" npm run start -w @designer/server >"$data/server.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do curl -fs "http://localhost:$port/" >/dev/null 2>&1 && [ -s "$data/token" ] && break; sleep 0.2; done
  echo "== $s"
  URL="http://localhost:$port/?t=$(cat "$data/token")" REPO="$repo" node --import tsx "e2e/$s.e2e.mjs" || status=1
  kill -- -"$pid" 2>/dev/null || true
done
exit $status
