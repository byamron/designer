# Inspirations and license rules

We read other open-source projects for ideas. We do not copy their code.

## Rules
1. **Ideas, not code.** Architecture, protocol shapes, and UX patterns are fair to learn from. Write our own implementation from our own understanding, not with the other file open beside it.
2. **Trace every borrowed decision** in the ledger below: project, pinned commit SHA (line numbers drift, so never cite a branch), file path and lines, what we learned, what we decided.
3. **If any code is ever adapted** (even a function): stop and check the license first, add an entry to `THIRD_PARTY_NOTICES.md` with the copyright notice and full license text, and mark the file with a header comment. MIT requires the notice and license text to travel with copies or substantial portions. Apache-2.0 additionally requires a copy of the license, retained notices, a statement of changes, and the project's NOTICE file if it has one.
4. **Protocols are not code.** Using the Codex app-server or Claude Agent SDK as documented is using their public interfaces. Generated types from `codex app-server generate-ts` come from the installed binary; record the CLI version we generated them from.
5. **Re-verify licenses** at the pinned commit before citing (a license can change between releases).

## Projects
| Project | License (verify at pinned commit) | Focus for us |
|---|---|---|
| T3 Code (pingdotgg/t3code) | MIT (per earlier research) | provider adapter interface, event shape, WebSocket transport, persistence, what is overbuilt |
| Paseo (getpaseo/paseo) | Apache-2.0 (per earlier research) | daemon + client split, agent-CLI launching |
| Orca | MIT (per earlier research) | not yet reviewed |

## Ledger
| Date | Project @ commit | File:lines | What we learned | Our decision / where used |
|---|---|---|---|---|
| _empty: no file-level reads yet_ | | | | |
