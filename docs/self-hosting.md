# Building Designer in Designer

You work in one copy of Designer (the **stable** copy) while Claude edits a different copy (the **dev** copy).
The stable copy never changes while you use it, so it never restarts or breaks in the middle of your session.

```
 stable copy  ~/designer-stable   ← you run this: npm start, open it in the browser. You do NOT edit it.
 your repo    ~/designer          ← added as a folder in the stable app; worktrees are created from it
 worktree     ~/.designer-chat/worktrees/designer/<name>   ← Claude edits here
 dev instance runs the worktree on ports 4500/4501 with its own data (~/.designer-chat-dev/<name>)
```

## One-time setup
1. **Make the stable copy.** A second clone of the repo that you only ever update with `git pull`:
   ```sh
   git clone https://github.com/byamron/designer.git ~/designer-stable
   cd ~/designer-stable && npm install
   ```
2. **Start it** and open the link it prints (`npm start`). Leave that terminal running.
3. **Add your working repo** (`~/designer`, a normal clone) with *Add folder* in the app.

## Every change
1. In the app, click **⎇ +** next to the project and name a worktree (for example `inspector-panel`).
2. Chat with Claude in that worktree: ask for the change. Approve what it asks.
3. **Run the edited copy.** In a second terminal, from the stable copy:
   ```sh
   cd ~/designer-stable
   npm run dev-instance -- --worktree inspector-panel
   ```
   The first run installs that worktree's dependencies (about a minute). It prints a link.
4. **See it.** Paste that link into the stable app's **Preview** address bar to use the new version inside the preview
   pane, or open it in its own browser tab. **Hot reload:** UI edits appear instantly without a page reload and keep what you
   were typing (about 0.2 s in our test); server edits restart only the dev instance, never your stable app.
5. Happy? Ask Claude to commit and push the branch, open a pull request, and merge it.
6. **Promote**: when you want the new version as your daily app, stop the stable app, `git pull` in `~/designer-stable`,
   `npm install`, and `npm start` again.

## Rules that keep this safe
- Never run the dev instance from the same folder as the stable app. They share a build folder, and building one breaks
  the other. (`dev-instance` runs the worktree you point it at; the stable folder is a different copy.)
- The dev instance has its own data folder and its own private token, so it cannot see or change your stable chats.
- The dev instance can be shown only inside your stable app (it allows framing by `http://localhost:4317` only). Change
  that with `--parent` if your stable app runs on another port.
- If you want to try the UI without using real Claude, add `--fake`.

## Options
`npm run dev-instance -- --help` lists them: `--dir <path>` for any checkout, `--port`, `--data`, `--cwd`, `--parent`,
`--fake`, `--no-watch` (serve a built UI, no hot reload).

## If something goes wrong
| You see | Do this |
|---|---|
| `no worktree "x"` | create it first with ⎇ + in the app; names are case-sensitive |
| `... exists under several repos` | use `--dir <full path>` |
| The Preview says it can't be shown | you pasted the stable link, or the dev instance is not running; use the link the script printed |
| "Can't connect" inside the preview | the link has no token; copy the full link including `?t=…` |
| Port in use | the script picks the next free pair automatically; check it printed a different port |
| Dev instance feels stale | UI edits should appear on their own; if not, check the `[ui]` lines in the terminal. Server edits restart the dev instance (its open chats reconnect) |
