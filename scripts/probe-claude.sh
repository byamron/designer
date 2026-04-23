#!/usr/bin/env bash
# probe-claude.sh — capture Claude Code's real surface.
#
# Phase A (default): safe, no-cost inventory. CLI surface, home-dir layout.
# Phase B (--live):  burns tokens. Actually spawns a tiny agent team.
#
# Outputs land under .context/probe-output/ (gitignored scratch). The
# distilled findings get promoted into core-docs/integration-notes.md by
# hand after review.
#
# Usage:
#   scripts/probe-claude.sh          # Phase A only
#   scripts/probe-claude.sh --live   # Phase A + Phase B (spawns a real team)

set -euo pipefail

cd "$(dirname "$0")/.."

OUT=".context/probe-output"
mkdir -p "$OUT"

say() { printf '\n== %s ==\n' "$1"; }

# ---------- Phase A — safe inventory ----------

say "claude --version"
claude --version 2>&1 | tee "$OUT/claude-version.txt"

say "claude --help (no env)"
claude --help 2>&1 > "$OUT/help-plain.txt" || true
wc -l "$OUT/help-plain.txt"

say "claude --help (env-gated)"
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --help 2>&1 > "$OUT/help-with-teams.txt" || true
wc -l "$OUT/help-with-teams.txt"

say "help diff (plain vs env-gated)"
diff "$OUT/help-plain.txt" "$OUT/help-with-teams.txt" > "$OUT/help-diff.txt" || true
if [ -s "$OUT/help-diff.txt" ]; then
    echo "teams gate changes help output:"
    cat "$OUT/help-diff.txt"
else
    echo "no help diff (teams gate is invisible in top-level --help)"
fi

say "~/.claude top-level layout"
ls -la "$HOME/.claude" 2>&1 | tee "$OUT/home-layout.txt"

say "~/.claude/teams presence"
if [ -d "$HOME/.claude/teams" ]; then
    ls -la "$HOME/.claude/teams" | tee "$OUT/teams-dir.txt"
else
    echo "not present (expected pre-team-spawn)" | tee "$OUT/teams-dir.txt"
fi

say "~/.claude/tasks shape"
if [ -d "$HOME/.claude/tasks" ]; then
    # Show structure, not contents (tasks may be private)
    find "$HOME/.claude/tasks" -maxdepth 2 -type d 2>/dev/null | head -20 | tee "$OUT/tasks-shape.txt"
else
    echo "not present" | tee "$OUT/tasks-shape.txt"
fi

say "sample subcommands"
{
    echo "--- claude agents --help ---"
    claude agents --help 2>&1 || true
    echo
    echo "--- claude mcp --help ---"
    claude mcp --help 2>&1 | head -30 || true
} | tee "$OUT/subcommands.txt"

# Phase A done unless --live
if [ "${1:-}" != "--live" ]; then
    say "Phase A complete"
    echo "outputs: $OUT"
    echo "to run Phase B (spawns a real team, burns tokens): $0 --live"
    exit 0
fi

# ---------- Phase B — live team spawn ----------

say "Phase B: live spawn"
echo "About to invoke 'claude' with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"
echo "This will consume tokens from your Claude subscription. Ctrl-C within 5s to abort."
sleep 5

# Sub-B1: baseline stream-json capture — no team, just a one-shot prompt
say "B1: baseline stream-json (no team)"
printf 'say "hello from the probe" and exit' | \
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude -p \
        --output-format stream-json \
        --include-partial-messages \
        --verbose \
        > "$OUT/stream-baseline.jsonl" 2>"$OUT/stream-baseline.stderr" || true
wc -l "$OUT/stream-baseline.jsonl"

# Sub-B2: load-bearing spike — non-tty, in-process teammates, 2-member team
say "B2: in-process team spawn (load-bearing spike)"
rm -rf "$OUT/team-spike"
mkdir -p "$OUT/team-spike"

PROMPT='Create an agent team with one teammate named researcher. Have the researcher briefly describe what they see in the current directory, then clean up the team.'

# No stdin (truly non-tty); no tmux; --teammate-mode in-process
printf '%s' "$PROMPT" | \
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude -p \
        --teammate-mode in-process \
        --output-format stream-json \
        --include-partial-messages \
        --verbose \
        --dangerously-skip-permissions \
        > "$OUT/team-spike/stream.jsonl" 2>"$OUT/team-spike/stream.stderr" &
CLAUDE_PID=$!

# Poll for team dir to appear, up to 60s
TEAMS_DIR="$HOME/.claude/teams"
for i in $(seq 1 60); do
    if [ -d "$TEAMS_DIR" ] && [ "$(ls -A "$TEAMS_DIR" 2>/dev/null)" ]; then
        echo "teams dir populated at tick $i"
        break
    fi
    sleep 1
done

# Snapshot whatever landed
if [ -d "$TEAMS_DIR" ]; then
    cp -R "$TEAMS_DIR" "$OUT/team-spike/teams-snapshot" 2>/dev/null || true
fi
if [ -d "$HOME/.claude/tasks" ]; then
    # Only grab dirs modified in the last 5 minutes (the team's dir)
    find "$HOME/.claude/tasks" -maxdepth 2 -type d -mmin -5 > "$OUT/team-spike/tasks-recent.txt" 2>/dev/null || true
fi

# Wait for the lead to finish (team cleanup is part of the prompt)
wait $CLAUDE_PID 2>/dev/null || true
EXIT_CODE=$?

echo "claude exit: $EXIT_CODE"
echo "stream lines: $(wc -l < "$OUT/team-spike/stream.jsonl")"
echo "stderr lines: $(wc -l < "$OUT/team-spike/stream.stderr")"

say "spike result summary"
if [ -s "$OUT/team-spike/stream.jsonl" ] && grep -q '"type"' "$OUT/team-spike/stream.jsonl"; then
    echo "✓ stream-json emitted"
else
    echo "✗ no stream-json output — investigate stream.stderr"
fi
if [ -d "$OUT/team-spike/teams-snapshot" ] && [ "$(ls -A "$OUT/team-spike/teams-snapshot" 2>/dev/null)" ]; then
    echo "✓ teams dir populated — in-process teammates spawned"
    echo "team names: $(ls "$OUT/team-spike/teams-snapshot")"
else
    echo "? teams dir empty or absent — teammates may not have spawned"
    echo "  check team-spike/stream.stderr for errors"
fi

say "Phase B complete"
echo "outputs: $OUT"
