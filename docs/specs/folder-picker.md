# Choose folder… (native folder picker in Designer.app)

**Why:** adding a project meant typing an absolute path. In Designer.app there is a native macOS folder dialog; in a plain browser
the typed field stays exactly as it was.

## Behaviour
- Add folder shows the path field and **Choose folder…** (desktop app only). The dialog opens in `~/dev` if it exists.
- The chosen path **fills the field** and focus moves to **Add** (Enter adds). It does not add straight away: you see what was chosen
  and any warning first, and the add goes through the same server flow as a typed path (it must exist and be a directory; inside a repo
  the repo root is used). Nothing from the page is trusted more than typed text.
- A path under `~/Desktop`, `~/Documents` or `~/Library/Mobile Documents` shows, inline and for typed paths too:
  *iCloud may evict files in this folder and git will hang; use a folder under ~/dev*. It does not block (you may know better).
- A folder that is not a repository is still added (chatting works), and the server sends a plain notice: *&lt;path&gt; is not a git
  repository. It was added, but worktrees and branches need one.* (new `notice` server message, shown in the existing banner). This
  applies to typed paths as well.
- Keyboard: the button is a real `<button>` after the field, with the global inset focus ring; no animation is involved.

## Security: one validated IPC channel
- `packages/desktop/preload.cjs` (sandboxed preload; `contextIsolation`, `sandbox`, no Node in the page all unchanged) exposes one frozen
  global, `window.designerDesktop.chooseFolder()`. It takes **no arguments** (whatever the page passes is dropped), sends one message on
  one channel, `designer:choose-folder`, and returns a path string or `null`.
- `main.mjs` handles that one channel (and no other) behind `isAppSender`: the sender must be **our window's webContents**, the frame
  must be its **main frame** and on the **app origin** (`localhost:<port>`). Anything else gets `null` and no dialog. The preload is
  not loaded in iframes (`nodeIntegrationInSubFrames` stays off), so previews and dev instances have no bridge at all.
- The dialog is `showOpenDialog` with `openDirectory` only, parented to the window. The answer is re-validated (absolute string).
  One dialog at a time. Tests answer with `DESIGNER_TEST_FOLDER` instead of showing it (same pattern as the update dialogs).
- Tests: `desktop.test.ts` (`isAppSender` rejects other windows, subframes, other ports and hosts, `data:` pages, missing frames; the
  preload exposes exactly one function and sends only the channel name; main registers exactly one handler behind the check),
  `e2e/desktop.e2e.mjs` on macOS (real IPC from the app page, a second window refused, an iframe has no bridge, the button fills the
  form and Add works, the iCloud line), `folderPicker.test.ts` (web: bridge detection, result handling, the button with a fake bridge,
  the path warning), `folderadd.test.ts` (server: same validation for any path, repo root, the notice), `ui.e2e.mjs` (no button in a
  plain browser).

## Not done
A server-side native dialog for plain browsers (no concrete reason: the typed field works there). Blocking iCloud paths (warning
only). Remembering the last folder.
