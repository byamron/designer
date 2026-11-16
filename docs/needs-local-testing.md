# Needs testing on the owner's Mac

Built and tested in a Linux cloud container. These are things that container cannot prove. Tick them off
when checked on a real machine; do not build further on an unchecked item without saying so.

## Verified in the container (for reference)
Server unit tests (11), browser tests against a scripted provider, real Claude through the server (streaming,
tool calls, approval deny, interrupt, resume after restart), real `git worktree` create/remove.

## To verify locally
- [ ] **Subscription login.** With no `ANTHROPIC_API_KEY` set and `claude login` done, a chat works and no
      "using key instead of your subscription" warning appears. (Container auth differs, so `apiKeySource`
      there proves nothing.)
- [ ] **Stripped env really wins.** With `ANTHROPIC_API_KEY` exported in your shell, the app still uses the
      login (the adapter removes it), and usage shows against the subscription.
- [ ] **Stop behavior.** Stop during a long tool run and during streaming; check for a stray extra reply after Stop.
- [ ] **Real approvals feel.** Default mode prompts for the things you expect; "auto-accept edits" and full access
      behave as labelled.
- [ ] **Worktrees on your repos.** Create a worktree from a real project (with submodules, large repo, uncommitted
      changes in the main folder). Check where it lands (`~/.designer-chat/worktrees/<repo>/<name>`) and that
      removing a dirty one is refused.
- [ ] **Safari / Chrome behavior.** Scroll follow/detach with a trackpad (momentum scrolling), mobile-width layout is not
      designed. The container only tested Chromium with a mouse wheel.
- [ ] **Long real sessions.** Memory and smoothness over hundreds of messages and large tool outputs.
- [ ] **Port 4317 / Host check** works with how you open it (localhost vs 127.0.0.1; other hostnames are refused).

## Not buildable or testable here (later phases)
- macOS desktop shell (Tauri vs Electron spike), signing, webview comment overlay.
- Embedding and commenting on Paper or other external sites.
- System dictation into the composer.
- Codex adapter: needs a Codex login; the container has none.
