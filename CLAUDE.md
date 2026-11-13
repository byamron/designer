# CLAUDE.md

Fresh start of Designer: a lean local chat app over Claude Code (Agent SDK) and
Codex (`codex app-server`). Read `docs/plan.md` first.

## Rules
- Never read, store, proxy, or log subscription credentials. Strip `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the env passed to the Claude SDK.
- Chat is pass-through: no middleware on the message path beyond normalization into our ~8 events. Approvals are the only intercept point.
- Unfinished features are removed or flagged off, never shipped as visible stubs.
- Do not copy code from other projects. Follow `docs/inspirations.md`: log every borrowed idea with project, pinned commit, file and lines. Anything adapted from code needs a `THIRD_PARTY_NOTICES.md` entry first.
- The old app is at git tag `designer-final`; read it for ideas, don't resurrect it wholesale.
