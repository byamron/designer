# Security audit, November 2026

First full audit of Designer. Scope: the owner uses Designer.app all day as their main way to work, with their real Claude
login, GitHub credentials and source code on one Mac, so the app's security is the owner's personal security. Method: read the
code, then attack a real server (a throwaway `DESIGNER_FAKE=1` instance on its own port and data directory, never the owner's
`~/.designer-chat` or port 4317) with DNS-rebinding Host headers, cross-origin WebSockets, traversal and symlink paths,
malformed messages, proxy/probe targets such as `http://169.254.169.254` and `http://[::1]`, and a browser check of the fixed UI.
`docs/security.md` is the standing threat model; this file is the dated findings and decisions.

Evidence tags: **test** = pinned by a test that runs in `npm test`; **attack** = I ran the request against a live server and saw
the result (not pinned unless a test is named); **reading** = read in code only; **not verified** = could not check.

## Result in one paragraph
The perimeter is sound: the loopback bind, the 256-bit token, constant-time compare, Host/Origin/`sec-fetch-site` checks, the
WebSocket gate, the CSP and the markdown renderer all held up under attack. What was weak was **what the approval card showed**
(only the first line of a command), **what a previewed page could read** (the workspace's `.env` and `.git`), **one malformed
message that killed the server**, and the **supply chain around Update & Restart**. Those are fixed in this PR except the
parts that depend on `packages/desktop` work in flight or on your choices (below). The biggest remaining exposure is not a bug:
Update & Restart runs whatever is on `origin/main` as you, so the security of the GitHub account and of `main` *is* the
security of the app, and `main` has no branch protection yet.

## Findings, ranked

| # | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | High | **The app runs whatever is on `origin/main`.** Update & Restart fast-forwards and rebuilds; anyone who can push to `main` (or take over the GitHub account) can run code as you. No signature check, `main` has no branch protection (API returned 404 "Branch not protected"), the repository is public. | reading `updater.mjs:15-70`; attack `gh api .../branches/main/protection` | **recommended** (D1, D2) |
| 2 | High | **Approval card hid what would run.** The card showed `describeTool()`: the first line of a Bash command (≤200 chars) and only the tool name for MCP/web tools. `echo ok⏎curl … \| bash` showed as `echo ok`. The terminal shows the whole command. | attack (UI card showed one line); test `hardening.test.ts` (approval label ×4) | **fixed**: full command, whole input for other tools, hidden/bidi characters made visible, explicit "N more characters not shown" |
| 3 | High | **Auto mode is a model's judgement, not a boundary, and Designer cannot veto it.** In `auto` the Claude Code classifier approves or denies each call; `canUseTool` (Designer's approval card) is only called when it cannot decide (SDK docs, `sdk.d.ts:2123`). That is why a `curl \| bash` or a force-push ran without a prompt: Designer never saw it. Designer controls only the mode string it passes and the relay of asks. | reading `claude.ts` (`sessionOptions`, `canUseTool`), `manager.ts:207`, SDK types | **recommended** (D3), no silent change |
| 4 | Med | **A previewed page could read the workspace's secrets.** The preview server served `.env`, `.git/config` (remote URLs can hold tokens), `.npmrc`. Previewed pages run with network access and no CSP, so an agent-written (or injected) page could read and send them anywhere, with no approval prompt. | attack (`/<id>/.env` → 200, `/.git/HEAD` → 200); test (`preview: dotfiles…`) | **fixed**: any dot-segment refused (`.well-known` allowed), checked again after symlink resolution |
| 5 | Med | **One malformed WebSocket message crashed the server** (`{"type":"send","threadId":…}` without `text` → `TypeError` in an async handler → process exit). Kills every running agent and needs the token, so it is robustness, not remote attack. | attack (server dead); tests (`hardening`, `security` black-box) | **fixed**: shape check before the manager (`messages.ts`), handler rejections reported |
| 6 | Med | **The proxy could be pointed at Designer itself** (`/api/proxy?url=http://127.0.0.1:4317/`), laundering the Host/Origin the app's checks trust, because the proxy rewrites both to the target's. Token still required. | attack (200 + port); tests | **fixed**: refused for the app, the preview port and every spelling of this machine (`localhost`, `127.1`, `0.0.0.0`, `[::1]`, `*.localhost`) |
| 7 | Med | **Electron fuses are all default.** `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges` are **on**; the ad-hoc signature has no hardened runtime (`flags=0x2(adhoc)`). Any process on the Mac can run the app's binary as a Node interpreter (`ELECTRON_RUN_AS_NODE=1`), inheriting whatever macOS privacy grants (Documents, Desktop, Automation…) you give "Designer". | attack (read the fuse wire in the installed app); reading `main.mjs:38`, `bundle.mjs:57,182`, `shim/main.cjs:29` | **recommended** (D4): design below; touches the files `feat/rollback` is changing |
| 8 | Med | **Dependency install scripts ran with your permissions** on `npm install` (Update & Restart, `dev-instance`, you). Only `esbuild` and `fsevents` have any; neither needs them. | attack (`npm ci` + build + 111 server tests + all e2e pass with scripts off) | **fixed**: `.npmrc` `ignore-scripts=true` (covers the updater, CI and you); pinned by test |
| 9 | Med | **CI trusted floating tags.** `actions/*@v4` can be re-pointed; no lockfile source check; no Dependabot version updates. Top-level `permissions: contents: read` and `pull_request` (not `_target`) were already right; no secrets are used. | reading `ci.yml`; `gh api` repo settings | **fixed**: all four actions pinned to commit SHAs, `persist-credentials: false`, `scripts/check-lockfile.mjs` in CI, `.github/dependabot.yml`; pinned by test. **recommended**: turn on "Require actions to be pinned to a full-length commit SHA" (D5) |
| 10 | Low | **Data directory was world-listable.** `mkdir`'s mode only applies to a new folder; an existing `~/.designer-chat` stays `drwxr-xr-x` (files inside were already 0600 and `threads/` 0700, so contents were not readable). | attack (stat on a fresh instance pre-created at 0755); test | **fixed**: tightened to 0700 at every start; takes effect the next time Designer starts |
| 11 | Low | **Updater does not pin the remote.** `git fetch origin main` follows whatever `origin` points at; the dialog does not show it. Same-user config edit required. | reading `updater.mjs:15,28` | **recommended** (D2) |
| 12 | Low | **`will-navigate` allows any `data:text/html` URL** (meant for the error page). A page in a frame that navigates the window could show its own UI inside the app window (no Node, no preload, no app origin). | reading `main.mjs:110` | **recommended**: allow only the exact error page (one line; after `feat/rollback`) |
| 13 | Low | **Test hooks live in production code.** `DESIGNER_TEST_DIALOG` auto-answers the update dialog; `DESIGNER_TEST_EXTERNAL_LOG` appends to a path; `DESIGNER_CHECKOUT` repoints the shim. Anything that can set the app's environment can already do worse. | reading `main.mjs:33,121`, `shim/locate.cjs` | **accepted-risk**, noted |
| 14 | Low | **`localhost:5173` is always a trusted app origin** (the hot-reload dev port), so a Vite project the agent runs on 5173 passes the Host/Origin checks. The token (stored per origin) is still required, and it cannot read the app's storage. | reading `index.ts:30-37` | **accepted-risk** |
| 15 | Low | **Proxy and preview ports have no token.** Any web page you visit can send requests to a proxy port while Inspect is on (random port, scannable); the proxy rewrites Host/Origin to the target's. It can do no more than reach the dev server you chose, but it bypasses that server's own Host/Origin protection. | reading `proxy.ts:41-60` | **recommended**: reject `sec-fetch-site: cross-site` unless the page is Designer's own, or a per-proxy secret path. Needs design: the app frames the proxy from `localhost` while some setups use `127.0.0.1` (cross-site) |
| 16 | Low | **`Full access` sticks to a thread.** The mode is saved in the thread's `meta.json` and applies after every restart and resume; the picker shows it but nothing marks it as risky. | reading `manager.ts:207` | **recommended** (D3) |
| 17 | Low | **`/api/probe` is a blind reachability oracle** (follows redirects, returns whether the URL answered and whether it can be framed). `file:`/`ftp:` refused; token-gated; only the UI can call it. | attack | **accepted-risk** |
| 18 | Info | `repoRoot()` runs `git` in any folder you add before anything has trusted it; git does not run repo-supplied code for `rev-parse`/`worktree add`, but a hostile clone's config deserves care. | reading `git.ts` | accepted |

## What I checked and found sound

| Area | Result | Evidence |
|---|---|---|
| Bind address | 127.0.0.1 only (app, preview, proxies) | test `servers listen on loopback only` |
| Token | `randomBytes(32)`, 0600 file, `timingSafeEqual`, header/`?t=` only, never in a page or cookie | test `the token is random…`; reading `auth.ts:8-32` |
| Host check (DNS rebinding) | `evil.com`, `localhost:4420.evil.com` → 403 on pages, API, WebSocket, preview and proxy | test; attack |
| Origin / `sec-fetch-site` | `cross-site` and `same-site` → 403 on the API; foreign/`null`/preview-port Origin refused on the WebSocket | test; attack. (A non-browser client with the token and no Origin is allowed, by design.) |
| CSRF / CORS | No cookies exist; no `Access-Control-*` header is ever sent (preflight → 401); cross-origin reads of the preview are blocked by the browser | attack |
| Security headers | CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'none'`), XFO, nosniff, no-referrer, CORP, no-store | test; attack |
| Static file traversal | The request path is normalised by the URL parser (`/../`, `%2e%2e` collapse) and never decoded again; no escape found. The prefix check `startsWith(WEB_DIST)` has no trailing separator, so a sibling `dist-evil/` would pass it if a path could ever reach it; none can today. | attack (sibling folder created and removed); reading `index.ts:44-46` |
| Preview traversal / symlinks | `..`, `%2e%2e`, encoded NUL, malformed `%`, symlinked file and directory → 404 | test; attack |
| XSS | Markdown becomes React elements; raw HTML is text; links only `http(s)`, `mailto`, `#`, `/`; images are not rendered; no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `packages/web/src` | reading; grep |
| Inspector / page agent | Messages need the frame's window, its origin and a per-load nonce; the agent only answers the app's origins | test `bridge.test.ts`, e2e "forged messages from the page are ignored" |
| Attachments | Type from file signature (no SVG), id is a SHA-256, served with a fixed type, `nosniff`, `CSP: sandbox`, `no-store`, token required | tests `attachments.test.ts` |
| Chat logs | JSON.parse in try/catch (a torn line is skipped), thread ids `[\w-]+`, 0600/0700, appended not rewritten | test; reading `store.ts` |
| Limits | WebSocket payload capped at 5×5 MB (+overhead); HTML through the proxy capped at 20 MB; API is GET-only; no rate limiting (accepted: loopback, token-gated) | reading |
| `spawn`/`exec` | Every call passes an argument array, no shell: `git`, `npm`, `codesign`, the server, `make-app`. Names reaching `git worktree add` are validated (`NAME_RE`, no `..`). `loginShellPath` runs a fixed script in your shell. | reading `git.ts`, `updater.mjs`, `bundle.mjs`, `main.mjs`, `scripts/` |
| Credentials | Nothing reads, stores or logs Anthropic or GitHub credentials. `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are removed in the shell, the server, the updater and the bundle builder. The only `console.log` of a secret is the one-time token link on startup (terminal or `DESIGNER_DESKTOP_DEBUG`). | grep over `packages/ scripts/`; tests `cleanEnv`, `e2e/desktop.e2e.mjs` |
| Electron window | `contextIsolation`, `sandbox`, no `nodeIntegration`, no webview tag (and `will-attach-webview` blocked), no preload (so no IPC surface), permission requests and checks denied, window may only show the app origin, `window.open` and other links go to `shell.openExternal` only for http/https/mailto | reading `main.mjs:97-114,241-246`; `e2e/desktop.e2e.mjs` |
| Updater safety | Fast-forward only, refuses dirty/non-`main`/diverged, rolls back, no Anthropic env for npm | tests `desktop.test.ts` |
| Dependencies | `npm audit`: 0 vulnerabilities (the "one advisory" line in `docs/security.md` was stale). 260 lockfile entries, all `https://registry.npmjs.org/` with integrity. Install scripts: `esbuild`, `fsevents` only. | attack; `scripts/check-lockfile.mjs` |
| Repository settings (read through the API on 2026-11-20) | Secret scanning on, push protection on, Dependabot security updates on, default workflow token read-only, Actions cannot approve PRs. **Not set:** branch protection, SHA-pinning requirement. | `gh api` |

## Agent safety: what Designer controls and what Claude Code does

| Mode (picker label) | SDK mode | Who decides | Designer's part |
|---|---|---|---|
| Ask before edits & commands (**default**, also for every new thread) | `default` | Claude Code asks for anything not already allowed by your settings | Relays each ask as a card; the answer is checked against the request ids Claude issued |
| Auto: Claude decides, asks when unsure | `auto` | **A classifier inside Claude Code.** Calls it approves never reach Designer | Only passes the mode. Cannot see or veto an approved call |
| Auto-accept edits | `acceptEdits` | File edits are approved; commands still ask | Passes the mode |
| Full access (no prompts) | `bypassPermissions` | Nobody. Needs `allowDangerouslySkipPermissions`, which Designer sets only for this mode | Passes the mode; the mode survives restarts per thread |

Always true: your `~/.claude` and project `.claude` settings (deny rules, hooks, CLAUDE.md) apply (SDK default loads all sources;
pinned by the test in `docs/security.md`). Designer always passes a mode explicitly, so a `defaultMode` in your settings cannot
start a session in `auto` behind your back (SDK docs: omitted → `auto` where available).

**Prompt-injection paths**, most to least direct: (1) text in a repository the agent reads (README, issue text, a dependency's
docs): same as the terminal; (2) **page text through the Inspector and preview**: reports include element text and HTML, and a
previewed page can be hostile; you paste or send them, so skim a report before sending; (3) pasted images (text inside a
picture is read by the model); (4) MCP/tool output. Every path ends at the same gate: what the mode lets run without asking.
Controls that exist: Ask is the default; deny rules in your settings; the full approval card (fix #2); previewed pages cannot reach
the app, its WebSocket or now your workspace dotfiles.

**What I would do, in order (D3):**
1. Keep **Ask** as the default and do not use Auto/Full access on a repository whose content you do not trust.
2. Put hard stops in `~/.claude/settings.json` (Designer honours them, tested); they apply in every mode, including Auto:
   ```json
   { "permissions": { "deny": [
     "Bash(git push --force*)", "Bash(git push -f*)", "Bash(git push * --force*)", "Bash(git push --delete*)",
     "Bash(curl * | bash*)", "Bash(curl * | sh*)", "Bash(wget * | bash*)", "Bash(wget * | sh*)",
     "Bash(rm -rf /*)", "Bash(rm -rf ~*)", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.config/gh/**)"
   ] } }
   ```
   Patterns are prefix/glob matches on the command text, so they stop the obvious forms, not every spelling. A sandbox is the stronger control:
3. Consider Claude Code's own **Bash sandbox** (`sandbox` setting in the SDK, macOS seatbelt: file writes limited to the workspace,
   network allow-list). It is a pass-through of an SDK capability, not our code; it would bound even Auto and Full access. Needs a
   trial on this Mac (it can break tools that write outside the workspace).
4. UI, not behaviour: rename the Auto option to say what it is ("Auto: a classifier approves most commands without asking; not a
   security boundary") and show Full access in a warning colour in the thread header, and reset it to Ask when the app restarts.

## Electron fuses and `ELECTRON_RUN_AS_NODE` (D4)

**Real risk on this Mac.** The installed `Designer.app` is ad-hoc signed without hardened runtime and keeps every default fuse. Anything
running as you can already read your files, run `git`, or run `claude`; the added capability is **identity**: a process launched
through `Designer.app/Contents/MacOS/Designer` with `ELECTRON_RUN_AS_NODE=1` (or `NODE_OPTIONS`, `--inspect`, or a
`DYLD_INSERT_LIBRARIES`, which hardened runtime would also have blocked) runs *as "Designer"* for macOS privacy prompts. If you
ever click Allow on "Designer wants to access your Documents/Desktop/Downloads/another app", any local process can borrow that
grant. The agent's own commands are children of this binary, so they already use it, which is the same trade the terminal makes
for Terminal.app. Moderate, grows with the number of grants, cheap to remove.

**Why RunAsNode is on:** `main.mjs` runs the server as `process.execPath --import tsx` with the flag, `shim/main.cjs` and
`bundle.mjs` (`refreshBundle`, `ensureElectron`) run `make-app.mjs`/`install.js` the same way. The flag also leaks into everything the agent
starts (the server's environment is inherited), so an Electron app run from Claude's shell would start as plain Node.

**Decision (recommended, not done here, because it edits `main.mjs`, `bundle.mjs` and the shim that `feat/rollback` is changing):**
1. Run those four jobs with the **system Node** from your login-shell PATH. Node must be installed anyway (the updater runs `npm`), and
   `spawn` resolves `node` in the PATH Designer already builds (`mergePaths`). No Electron-as-Node needed anywhere.
2. In `buildBundle`, after the copy and before `codesign`, flip the fuses in `Electron Framework`: `RunAsNode` off,
   `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `GrantFileProtocolExtraPrivileges` off
   (we only load `http://localhost`). The format is documented (sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`, one byte per fuse), so this is ~25 lines
   with no new dependency (or `@electron/fuses` as a build-time dev dependency). Re-signing already happens.
3. Add `--options runtime` to the ad-hoc `codesign` so the hardened runtime blocks `DYLD_*` injection (check that Electron still
   starts; ad-hoc + runtime works for local apps).
4. **Not available** with a checkout-backed app: `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` require the app code
   to be an asar inside the bundle; ours is deliberately a folder outside it. The protection for the code is git (finding 1), not the bundle.
5. Test: `e2e/app.e2e.mjs` asserts the fuse bytes of a built bundle and that `ELECTRON_RUN_AS_NODE=1 Designer -e 1` does not run a script.

**Tamper resistance of the bundle today:** nothing stops a same-user process from editing `Contents/Resources/app/main.cjs`,
`designer.json` (it names the checkout the app runs) or the checkout itself; they are all owned by you (`drwxr-xr-x`).
Ad-hoc signing only keeps Apple Silicon willing to run it; it is not a defence against a same-user attacker, and no Mac app
protects itself from the user account that owns it. Gatekeeper/quarantine do not apply (a locally built app has no quarantine
attribute). Accepted risk; the compensating controls are keeping the machine's other software trustworthy and finding 1.

## Update channel and supply chain (D1, D2)

What an update does, in order: `git fetch origin main` → `merge --ff-only` → `npm install` only if a `package.json`/lockfile
changed → `npm run build` → relaunch. After this PR, step 3 runs no dependency scripts (`.npmrc`). What is left is the real
exposure: **the code on `main` itself runs as you**, and a build step (`vite build`, the config files) is code from the repository
too. The dialog lists commit titles before anything is applied, which is a speed bump, not a review.

- **Remote pinning (recommended).** Before fetching, require `git remote get-url origin` to be `https://github.com/byamron/designer(.git)` or `git@github.com:byamron/designer(.git)`,
  otherwise refuse with the URL in the message, and show the URL in the dialog. Forks would set an explicit override. This is
  ~15 lines in `updater.mjs` plus a test; deferred only because `feat/rollback` edits that file.
- **Use `npm ci` in the updater** instead of `npm install`: installs exactly the lockfile (a `package.json` edited without the
  lockfile fails instead of resolving fresh versions) and never rewrites the lockfile, which would otherwise leave the checkout
  "dirty" and block the next update. Same file, same deferral.
- **Signed `main`.** GitHub signs web/squash merges with its own key. A check that `origin/main`'s tip verifies (`git verify-commit` with
  GitHub's published key) would stop an unsigned force-push but not a hijacked account; worth it only after branch protection.
- **Branch protection (being applied separately):** require pull requests, no force-push, no deletion, include administrators,
  required status check `checks`. For a solo repo "required reviews" would block you; the benefit is a pull request and CI before
  anything reaches the branch the app pulls.
- **Dependencies:** 255 packages in the lockfile. Version bumps now arrive as grouped Dependabot PRs; security
  advisories are already automatic. `npm audit` stays a non-blocking CI job; if you want it blocking, change `continue-on-error`
  and add `--audit-level=high` (0 findings today, so it would pass).
- **Actions:** pinned by SHA (Dependabot updates the SHAs and comments). The `browser` job installs Chromium from Playwright's CDN; the
  `audit` job runs only `npm audit`. No job has secrets or write permission; fork PRs run with a read-only token and no secrets.
  Turn on repo setting "Require actions to be pinned to a full-length commit SHA" so a future workflow cannot regress, and
  "Require approval for all outside collaborators" for fork PR workflows. The repository is public: that is the setting that matters.
- **Rollback:** `feat/rollback` (in flight) is the safety net for a bad update that is not malicious; it does nothing for a malicious one.

## Fixes in this PR (each has a test written first)

| Fix | Files | Test |
|---|---|---|
| Approval card shows the whole command / input, hidden characters visible | `claude.ts` (`approvalLabel`), `styles/approvals.css`, `fake.ts` | `hardening.test.ts` |
| Reject malformed WebSocket messages; async handler errors reported | `messages.ts` (new), `index.ts`, `manager.ts` | `hardening.test.ts`, `security.test.ts` |
| Preview refuses dot-files/folders (`.env`, `.git`, `.npmrc`), after symlink resolution too | `preview.ts` | `hardening.test.ts` |
| Proxy refuses Designer's own ports and every spelling of this machine | `proxy.ts`, `index.ts` | `hardening.test.ts`, `security.test.ts` |
| Data directory tightened to 0700 even when it already existed | `auth.ts`, `store.ts` | `hardening.test.ts` |
| Install scripts off; lockfile source check; actions pinned; Dependabot | `.npmrc`, `scripts/check-lockfile.mjs`, `scripts/lib/lockfile.mjs`, `.github/workflows/ci.yml`, `.github/dependabot.yml` | `supplychain.test.ts` |

Pinning tests in `docs/security.md` are unchanged and pass. Nothing in `packages/desktop` was edited.

## Decisions for the owner

- **D1. Branch protection and account hygiene** (the orchestrator is applying protection): this is what decides finding 1. Also: passkey or
  hardware key for GitHub, and see the checklist below.
- **D2. Updater hardening** (pin `origin`, `npm ci`, show the URL): yes/no; I recommend yes, as a small PR after `feat/rollback` lands.
- **D3. Agent defaults:** keep Ask as default (yes); add the deny rules above to `~/.claude/settings.json`; relabel Auto and mark Full
  access; try the Bash sandbox. None of these changes behaviour without your say-so.
- **D4. Electron fuses:** system Node for the server and builders, flip four fuses, hardened runtime. I recommend yes (moderate risk,
  small change), as a follow-up PR on top of `feat/rollback`.
- **D5. Repository settings:** require SHA-pinned actions; approval for fork PR workflows.
- **D6. Dependabot:** this PR adds weekly grouped PRs (max 3 open). Delete `.github/dependabot.yml` if that is more noise than you want.

## Your own hygiene (checklist)

GitHub
- [ ] Two-factor with a passkey or security key; remove SMS as the only second factor. Check Settings → Password and authentication.
- [ ] `gh auth status` shows the token's scopes. Prefer the minimum: `repo` is needed for private work, `workflow` lets anything holding the token edit CI, `gist`/`read:org` are rarely needed. Re-login with `gh auth refresh -s …` after removing scopes, or use a fine-grained token per repository.
- [ ] Settings → SSH and GPG keys / Applications: remove keys and authorized OAuth apps you do not recognise. Use a passphrase on any SSH key and load it into the macOS Keychain.
- [ ] Branch protection on `main` (D1), secret scanning + push protection (on), Dependabot alerts and security updates (on), SHA-pinned Actions (D5).
- [ ] Never paste a token into a chat with the agent; revoke at once if you do.

macOS
- [ ] FileVault on (`fdesetup status`). Firewall on (System Settings → Network → Firewall; Designer listens on 127.0.0.1 only, so this is general hygiene, not a Designer fix).
- [ ] Automatic macOS updates on, SIP and Gatekeeper on (`csrutil status`, `spctl --status`). Lock screen on a short timer; "Find My" on.
- [ ] If you ever grant "Designer" Documents/Desktop/Full Disk Access/Automation, remember finding 7: prefer not to, until D4 lands.
- [ ] Remove the old Tauri `Designer.app` if you do not use it (a second, differently signed app with the same name).

Where data lives (not verified on your Mac beyond the paths named)
- `~/.designer-chat/`: `token` (the key to the app), `threads/*/events.jsonl` (**everything the agent printed, including secrets from `cat .env`**), `attachments/`, `workspaces.json`, `worktrees/`. All 0600/0700 now.
- `~/Library/Application Support/Designer/`: the app's browser storage (also holds the token), window state, `update.log`.
- `~/.claude/`: Claude Code's own transcripts, settings and hooks. The login itself is Claude Code's, not Designer's (macOS Keychain on a Mac; not verified here).
- Backups (Time Machine, cloud sync of your home folder) copy all of it. Keep these folders out of cloud-synced locations and encrypt backups.

If the laptop is lost or stolen
1. From another device: Find My → Lock/Erase. FileVault means the disk is unreadable without your login.
2. github.com → Settings → Sessions and Applications: revoke sessions, the `gh` OAuth token, SSH keys, personal access tokens; rotate any secret that was in a repo or a `.env` on the Mac.
3. claude.ai → Settings → sign out of all sessions / revoke the Claude Code login.
4. Check GitHub's security log and the repository's recent pushes for anything you did not do.
5. Delete `~/.designer-chat/token` on the replacement to rotate the app token.

## Re-check
`npm test` (the pinning tests above), `e2e/run.sh`, `node scripts/check-lockfile.mjs`. Rotate the app token by deleting `<data dir>/token`.
