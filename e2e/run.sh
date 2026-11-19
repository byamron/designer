#!/usr/bin/env bash
# Runs each browser suite against a fresh fake-provider server, a fresh temp git repo and empty data.
# Usage: e2e/run.sh [suite ...]   (default: all)    Needs Playwright (npx playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/.."
suites=("$@"); [ ${#suites[@]} -eq 0 ] && suites=(ui focus motion selfhost images)
npm run build >/dev/null
port=${E2E_PORT_BASE:-4400}
status=0
for s in "${suites[@]}"; do
  port=$((port + 2))
  if curl -fs "http://localhost:$port/" >/dev/null 2>&1; then echo "port $port already in use by an old server" >&2; exit 2; fi
  repo=$(mktemp -d); data=$(mktemp -d)
  git -C "$repo" init -q -b main
  git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  # own process group so the whole server tree can be stopped (a stale server would serve old data to the next run)
  PORT=$port DESIGNER_CWD="$repo" DESIGNER_FAKE=1 DESIGNER_DATA="$data" setsid npm run start -w @designer/server >"$data/server.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do curl -fs "http://localhost:$port/" >/dev/null 2>&1 && [ -s "$data/token" ] && break; sleep 0.2; done
  echo "== $s"
  URL="http://localhost:$port/?t=$(cat "$data/token")" REPO="$repo" node "e2e/$s.e2e.mjs" || status=1
  kill -- -"$pid" 2>/dev/null || true
done
exit $status
