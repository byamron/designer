## [<project>] <one-line summary>

### What this does
<2-4 sentences, plain language: the user-visible behavior.>

### How it was verified
- `npm run typecheck`: <pass/fail>
- `npm test`: <N/N pass>
- `e2e/run.sh`: <suites and result>
- Real-account checks run locally (if the spec lists any): <what you ran and saw>
- Screenshots: <attach for anything visual>

### Touched outside owned files
<file: what and why, one per line, or "none">

### Needs Mac / real account (orchestrator copies these into docs/needs-local-testing.md)
- [ ] <specific thing a human must check>

### Safety (see .claude/rules/safety.md and docs/security.md)
<which safety-critical paths you touched and which existing/new tests pin the behavior, or "no safety-critical paths touched">

### Deliberately not done
<anything from the spec you left out, and why, or "nothing">

### Orchestrator block (machine-read: keep the fence and keys)
```orchestrator
project: <id>
merge-order: <n>
base: main
base-sha: <output of git rev-parse origin/main>
depends-on: []            # project ids that must merge first
owns: []                  # files/dirs you created or substantially changed
touched-outside-owned: [] # small edits in other files
conflict-risk: []         # files other open projects also touch
new-dependencies: none
docs-changed: none        # only project-specific docs; never the "do not edit" list
checks: { typecheck: pass, unit: "N/N", e2e: "ui,focus,motion,selfhost pass" }
needs-mac: []
```
