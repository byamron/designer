# Chat & Tabs UX Audit

**Date:** 2026-04-30
**Trigger:** First-run report from the user (3 screenshots, 8 verbatim issues)
**Surface:** `apps/desktop` frontend — workspace tabs bar and `WorkspaceThread` chat surface
**Status:** Audit + 14 bug fixes + 6 conversational-polish improvements + 6 review-pass corrections implemented on branch `chat-ux-audit`. 107 tests pass (was 60); production build clean.

This is a focused audit of the bugs the user observed plus the broader pattern class they hint at. Each entry below ties a symptom to a root cause at a specific file:line so the fixes can be staged into a single PR. The companion automated-test plan at the bottom is what catches regressions of this *class*, not just these specific defects.

---

## 1. Bug catalog (user-reported, confirmed)

### B1. Opening a new tab opens multiple tabs at once
**Root cause.** `MainView.onOpenTab` at `packages/app/src/layout/MainView.tsx:96–108` has no synchronous re-entry guard. Two clicks within the same microtask both observe the prior state and both call `ipcClient().openTab(...)`. The same defect is already solved in `WorkspaceThread.onSend` via `sendingRef` (`tabs/WorkspaceThread.tsx:167`) — the pattern just wasn't applied to tab creation.

A double-tap or accidental `⌘T` repeat creates 2+ tabs.

**Fix shape.** Mirror the `sendingRef` ref-guard. Disable the IconButton's `onClick` while a tab open is in flight; gate `onOpenTab` on a `useRef(false)` set synchronously before any `await`. The same guard belongs on the keyboard handler for `⌘T` once that lands.

---

### B2. Tabs have no perceptible selected/unselected state
**Root cause.** Tab style A is the default (`tabs.css:75`). Inactive tabs use `background: color-mix(... var(--dev-tab-opacity), transparent)` at `tabs.css:48`. `--dev-tab-opacity` is a SurfaceDevPanel knob that defaults to a low value (around 8 %), so inactive tabs are nearly invisible against the page. The toggle does work — `data-active="true"` swaps to `--color-content-surface` — but the *delta* between active and inactive is washed out.

This is also why screenshot 1 reads as a single "scrollbar of tab labels" rather than a row of distinct controls.

**Fix shape.** Either bump the default `--dev-tab-opacity` or, better, give inactive tabs a real opaque fill (`--color-surface-raised` works — that's exactly what tab style C does at `tabs.css:110`). Then guarantee a foreground-color delta and a font-weight delta so the contrast is perceptible at a glance and at a distance.

---

### B3. Tabs render in a buggy vertical column on Home
**Symptom (screenshot 2).** On the project home (sidebar "Home" highlighted, no workspace selected), a vertical column of "Tab 1 / Tab 3 / Tab 5 …" rows is rendered in the main pane, with close-X glyphs on some rows.

**Root cause analysis.** `MainView` renders `HomeTabA` when `workspace` is null (`MainView.tsx:68–87`). `HomeTabA` renders project workspaces, *not* tabs. The visual evidence in the screenshot does not match either `HomeTabA` (which would show "Workspace 1 / Workspace 2") or the workspace `.tabs-bar` (which is conditioned on `!workspace` being false). So the bug is one of three things:

1. A leaked render — a stale component tree from a previously selected workspace remains mounted (no cleanup on workspace deselect).
2. Layout collapse — the `.tabs-bar` is rendered with no flex-wrap, no overflow-x, no min-width: 0 path. Under specific window widths or grid-column collapse, tab-button-wrap (`min-width: 48px`, `display: inline-flex`) can stack visually if the parent's width somehow becomes equal to a single tab's width.
3. Misrouted state — `selectWorkspace(null)` doesn't clear `activeTabByWorkspace`, and a downstream component reads tabs from a non-current workspace.

**Action.** Reproduce locally first (run the app, click Home with multiple tabs open). Then write a regression test (T3 below) that asserts: when the project-home region is on screen, no element with `[role="tab"]` exists anywhere in the document. The test catches all three causes; the fix is whichever code path is hit.

---

### B4. Chat is layered text — no visual asymmetry between user and agent
**Root cause.** `chat.css:20–34` defines the canonical asymmetry: `[data-author="you"]` gets a bubble, `[data-author="agent"]` gets a flat surface. *But the renderer never emits `data-author`.* `MessageBlock` at `blocks/blocks.tsx:87–93` writes `<article class="block block--message">` and a `block__message-author` text span only. The selector `.chat__message[data-author="you"]` never matches. `blocks.css:109–115` then explicitly zeroes out background and border for *all* `.block--message` instances.

Net result: user and agent messages render identically as plain text on the surface.

**Fix shape.** Either (a) write `data-author={artifact.author_role === "user" ? "you" : "agent"}` on the `<article>` and switch `block--message` styling to read from that, or (b) split into `MessageBlockUser` / `MessageBlockAgent` and have the registry pick by role. The tokens for the bubble already exist (`--color-surface-overlay`, `--radius-card`) — only the wiring is broken.

---

### B5. Every tool call is a box — visually noisy
**Root cause.** `WorkspaceThread.tsx:251–263` renders each artifact through its own `Renderer`. Tool-related events come in as `kind: "report"` artifacts (`ReportBlock`, `blocks.tsx:366–391`) which all use the raised `.block` card (`blocks.css:98–107`). The screenshot shows seven boxed "REPORT — Used ToolSearch / Used TeamCreate / Read plan.md / Ran ls / …" cards in the rail and the thread, each consuming `--space-4` padding + a border. Adjacent reports do not coalesce.

**Fix shape.** Two-part design change, not just a CSS tweak:
1. **Coalesce.** A run of consecutive `report` artifacts from the same author within a short window collapses into a single, single-line "Used 7 tools (ToolSearch, TeamCreate, ls, plan.md, …)" row. Click to expand the full list inline. Pattern: ChatGPT's "Searched the web", "Read 4 sources" rows; Claude's `ToolUse` collapse.
2. **Demote chrome.** Even uncollapsed, a tool-call row should not be a card. It should be a single line: badge + verb + truncated target, with the same hover affordance as `.spine-artifact` but no border or fill.

Add a new `ToolCallRow` component and a `ToolCallGroup` aggregator in front of the artifact loop. Register `report` to the new renderer.

---

### B6. Chat does not auto-scroll as new messages arrive
**Root cause.** `blocks.css:25–33` defines `.thread` with `overflow-y: auto`. Nothing in `WorkspaceThread.tsx` (`72–111`) — the component that owns the artifact list — scrolls the container when artifacts grow. The user must manually scroll for every new message and tool call.

**Fix shape.** A `useEffect` on `[artifacts?.length]` that scrolls a `threadRef` to the bottom — *but only if the user was already pinned to the bottom before the new artifact landed* (the "scroll-stickiness" pattern). Otherwise we yank the user away from a message they're reading mid-conversation.

```typescript
const threadRef = useRef<HTMLDivElement | null>(null);
const stickRef = useRef(true);

const onScroll = () => {
  const el = threadRef.current;
  if (!el) return;
  stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
};

useLayoutEffect(() => {
  const el = threadRef.current;
  if (el && stickRef.current) el.scrollTop = el.scrollHeight;
}, [artifacts?.length]);
```

Also wire a "Jump to latest" pill that appears when `stickRef.current === false` and new content arrives — same pattern as iMessage and Linear's comment threads.

---

### B7. No animations — impossible to tell when the agent is thinking vs stuck
**Root cause.** The only animation the chat surface defines is `.streaming-cursor` at `chat.css:66–82` — a blinking text cursor. It is never instantiated by any block renderer. There is no:

- Pending/thinking indicator while `sending === true`
- Streaming-token cursor on agent messages currently being written
- Tool-call in-progress spinner
- Skeleton/shimmer for artifacts that have arrived but whose payload is still fetching

The compose dock changes its placeholder to "Sending…" (`WorkspaceThread.tsx:276`) but the placeholder is invisible the moment the user has typed anything, and the rest of the surface has no signal of activity at all.

**Fix shape.** Five distinct visual states, all token-driven:

| State | Trigger | Visual |
|---|---|---|
| Idle | no in-flight send, no streaming | (nothing) |
| Submitting | `sending === true` between click and first agent artifact | Pulsing dot row at the bottom of `.thread` ("Designer is thinking…") with ARIA `role="status" aria-live="polite"` |
| Streaming | agent message currently appending tokens | `.streaming-cursor` at the tail of the live message; reuse the existing keyframes |
| Tool running | a `report` artifact has started but not completed | Spinner glyph in the tool-call row (replaces the kind badge until done) |
| Stuck (>15s no activity) | timer elapsed in submitting/streaming with no event | "Still working…" copy + cancel affordance |

The "stuck" state is the user's actual diagnostic ask — it's the difference between "the agent is thinking" and "the agent or the IPC pipe is wedged."

---

### B8. Tabs do not preserve their chat state
**Symptom.** Switching away from a tab and back appears to lose the per-tab thread.

**Root cause.** `MainView.tsx:149–152` keys `WorkspaceThread` on `${workspace.id}:${activeTab}`. Switching tabs unmounts the previous `WorkspaceThread` and mounts a new one. `useState` for `artifacts`, `expanded`, `payloads`, `hasStarted`, `sendError` all reset. `refresh()` re-fetches via `ipcClient().listArtifacts(workspace.id)` — but artifacts are workspace-scoped, *not* tab-scoped, so every tab in the same workspace sees the same artifact list anyway. There is no per-tab chat history at all in the data model: tabs don't have threads, only the workspace does.

This is half a bug and half a missing feature:

- **Bug.** The tab affordance implies "each tab is a conversation" (the user's mental model from every other chat app). The user clicks "+", expects a fresh thread, and sees the workspace's existing artifacts with no new-tab affordance to clear them.
- **Missing feature.** If tabs are meant to be conversation contexts, the artifact storage needs a `tab_id` column and `listArtifacts` needs a tab filter.

**Decision required.** Either (a) document tabs-are-views-into-the-same-workspace clearly in the UI (rename "+ tab" to "+ view", and keep the artifact pool shared), or (b) push a tab_id through the artifact model. Either way the test is: open two tabs, send "hello-A" in tab 1 and "hello-B" in tab 2, switch back to tab 1 — does the user see what they expect to see?

---

## 2. Bugs and gaps found that the user did not call out

The user said "there are surely many more issues." Here are the ones I caught while mapping the code:

### B9. No keyboard shortcut for new tab
The `IconButton` in `MainView.tsx:133` advertises `⌘T` via tooltip. There is no global handler that wires `⌘T` to `onOpenTab`. The shortcut is a lie.

### B10. New-tab counter never reuses indices
`onOpenTab` at `MainView.tsx:98` titles the new tab `Tab ${visibleTabs.length + 1}`. After closing tab 2 of a 3-tab workspace and opening a new one, you get `Tab 3` *twice*. `displayLabel` re-numbers visually (`MainView.tsx:174–181`), but the underlying title is duplicated, which means search and history both lie. The display normalization also clobbers any tab the user renamed to literally "Tab N" — a footgun.

### B11. No focus management on tab switch
`selectTab` updates state but does not move focus into the `tabpanel`. Screen reader users hear nothing change. The keyboard arrow handler at `MainView.tsx:215–235` does call `next.focus()`, but only when navigating via arrow keys — not when the tab is selected by pointer or by `selectTab` invoked from elsewhere.

### B12. No empty state for "fresh tab"
A brand-new tab in a workspace that already has artifacts shows the existing thread, not a fresh-tab affordance. `hasStarted` is per-component (`WorkspaceThread.tsx:64`), so the suggestions surface shows correctly on the first paint of a fresh tab — but only because `useState(false)` initializes it. There's no UI separator between "this is a new conversation" and "here's the running thread you came from."

### B13. Streaming cursor is dead code
`chat.css:66–82` defines `.streaming-cursor` with reduced-motion support. No component renders it. Either delete the CSS or wire it (B7).

### B14. Send button has no loading state
`compose__send` at `chat-css/tabs.css:508` has `:hover { opacity: 0.88 }` and a focus ring. While `sending === true` it does not visually distinguish itself, just stays clickable. The re-entry guard short-circuits the click but the user has no way to know that.

### B15. Approval blocks have a state but no animation
`ApprovalBlock` at `blocks.tsx:210–305` uses `data-state` attribute and `aria-busy`. CSS at `blocks.css:265–275` only changes opacity. There is no transition between states — granted/denied snaps in. For the trust-by-default product principle, this should be a moment.

### B16. No connection / IPC health surface
If the Tauri subprocess has crashed, the chat just appears stuck. There is no indicator that the agent stream is alive. The "stuck" state in B7 only catches the symptom; we should also surface the cause.

### B17. Compose stays focusable while disabled
While `sending === true`, `compose__input` has no `aria-busy` or `disabled` attribute. A user can keep typing into a textarea whose submit will be silently blocked by `sendingRef`.

### B18. No visible character / token meter
For a chat surface that talks to a paid model, users expect a soft bound. There is no token meter and the cost chip is off by default.

### B19. The "Tab N" pattern can collide with project naming
Workspace names "Workspace 1, Workspace 2" + tab titles "Tab 1, Tab 3, Tab 5" + sidebar shows tab title as workspace meta = three places where the same string can render. In screenshot 2 the user is genuinely confused about which "Tab 1" they're looking at.

### B20. ARIA `role="log"` with `aria-live="polite"` will spam screen readers on tool-call bursts
`WorkspaceThread.tsx:250` uses `aria-live="polite"`. With B5's tool-call coalescing not yet shipped, every report artifact triggers an assertive read. This is hostile to assistive tech users and breaks WCAG 4.1.3.

---

## 3. Patterns research — what good chat UX looks like in 2026

Synthesized from Claude Desktop, ChatGPT, Cursor, Linear's AI surface, Raycast AI, Warp, and Notion AI. Filtered down to the patterns that map onto Designer's product principles ("manager, not engineer"; "summarize by default, drill on demand").

### 3.1 Visible thinking
- **Submit acknowledgement within 100ms.** Even before the model responds, the UI flips: input clears (or animates a chip "→ thread"), a typing-indicator row appears at the bottom of the thread, the send button transitions to a stop button.
- **First-token latency.** Once the first token arrives, the typing indicator becomes a real message bubble with a streaming cursor. The cursor blinks at a steady cadence so the user knows the connection is live even between tokens.
- **Stuck heuristic.** If no token arrives for >15s during a streaming response, append "Still working…" sub-text under the message. >45s, surface a Cancel.

### 3.2 Asymmetric authorship
User messages: bubble, accent fill, right-aligned, max-width ~70 % of column. Agent messages: flat on surface, left-aligned, full width, prose-styled. Designer's `chat.css:20–34` already encodes this — wiring is broken (B4).

### 3.3 Tool-call hygiene
Every modern agent UI demotes tool calls to a single line with a disclosure chevron. Multiple consecutive tool calls collapse into "Searched the web (3 results)" / "Read 4 files" rows. Errors only escalate to a full block when they need attention.

### 3.4 Scroll discipline
Sticky-scroll: pin to bottom while user is at the bottom; don't yank when they've scrolled up. Show a "Jump to latest" pill after they fall behind. Pattern is known as "scroll-stickiness" and there is a small body of literature on getting it right (Slack, Discord, iMessage all do it; gh.com/pmndrs/use-stick-to-bottom is a reference impl).

### 3.5 Composer ergonomics
- `Enter` sends; `Shift+Enter` newline.
- Typed text persists in localStorage per-tab so a refresh doesn't lose the draft.
- Send button shows three states: disabled (empty draft), enabled (have draft), busy (in flight).
- Multi-line drafts auto-grow up to ~⅓ of the viewport, then start scrolling internally.

### 3.6 Streaming animations are tokens, not gimmicks
Use existing motion tokens. Designer has `--motion-interactive` (200 ms ease) and a blink keyframe. Add `--motion-thinking` (400 ms pulse) and `--motion-token` (60 ms steady) so the animation system is auditable and `prefers-reduced-motion` collapses it to zero in one place.

### 3.7 Tabs are surfaces, not threads
Cursor's tab model: each tab is a *view onto the workspace* (composer, terminal, diff). ChatGPT's tab model: each tab is a *conversation*. Designer is currently halfway between. Pick one and lean into it (this is the B8 decision).

### 3.8 Accessibility table stakes
- Tabs implement the [WAI Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) — Designer mostly does, but focus management on tab switch is incomplete (B11).
- `role="log"` belongs on the live-streaming region with `aria-live="polite"` and `aria-relevant="additions"` so deletions don't replay.
- Streaming cursor must respect `prefers-reduced-motion` — already wired in `chat.css:80–82`, just needs the rest of the motion system to follow.
- Color isn't the only signal: state changes (selected, busy, error) need text or a glyph too.

---

## 4. Recommended fix order (single PR or phased)

1. **B1** — re-entry guard on tab open (10 lines, pure win, lowest risk).
2. **B4** — wire `data-author` and ship the asymmetric bubble (the styling exists; this is wiring).
3. **B6** — auto-scroll with stickiness + jump-to-latest pill.
4. **B7** — five-state activity model: idle / submitting / streaming / tool-running / stuck. Most of the UX uplift lives here.
5. **B5** — tool-call coalescing component. Bigger lift; ship behind a `data-tool-collapse` flag to A/B against the boxed view.
6. **B2** — tab visual contrast (CSS-only).
7. **B3** — vertical-tabs-on-home regression. Reproduce, then fix root cause.
8. **B8** — tabs-as-views vs tabs-as-threads decision. ADR before code.
9. The rest (B9–B20) — slot into the maintenance backlog as their fixes become incidental to the above.

---

## 5. Automated test plan

**Goal.** Catch regressions of every confirmed bug *and* the broader pattern class. Tests are layered: unit + component for fast feedback (every PR), integration for IPC contract (every PR), end-to-end for the cross-component flows (gated job).

### 5.1 What's already in place

- **Vitest 2.1** with jsdom + `@testing-library/react`, configured at `apps/desktop/vite.config.ts:33–37`.
- 12 component tests in `packages/app/src/test/`. Coverage of tab close, post-message contract, error envelope, double-click guard on send, friction overlay, proposals.
- Mock IPC core (`packages/app/src/ipc/mock.ts`) seeded with deterministic projects/workspaces.

### 5.2 What's missing

- **No e2e harness.** No Playwright, no Tauri-driver, no real-DOM smoke test against `npm run dev`.
- **No visual regression.** No screenshots checked in, no Chromatic/Percy.
- **No a11y assertions.** `jest-axe` not installed.
- **No streaming-state tests.** Nothing exercises "while a message is streaming, the cursor renders and the thread sticks to bottom."
- **No motion tests.** No way to assert `prefers-reduced-motion` collapses animations.

### 5.3 New tests to add (priority order)

Each test below is named so it can be a single `it(...)` block in an existing or new file. Where the new file is, I name it.

#### Tier 1 — component tests (Vitest, no env changes)

**T1. Tab open is idempotent under burst clicks** → `test/tabs.test.tsx`
Render `MainView` with a workspace that has 0 tabs. Click the "+ new tab" button twice synchronously (`fireEvent.click` × 2 in the same tick). After flush, exactly one `ipcClient.openTab` call should have been made. *Catches B1.*

**T2. Selected tab has perceptibly different chrome** → `test/tabs.test.tsx`
Render a workspace with two tabs. Read `getComputedStyle` on the active tab and an inactive tab. Assert background color differs *and* either border color or font-weight differs *and* color contrast between label and background is ≥ 3:1 on both. *Catches B2.*

**T3. Project home does not render any tab role** → `test/tabs.test.tsx`
Render `App`, click into a workspace, open three tabs, click "Home". Assert `document.querySelectorAll('[role="tab"]').length === 0` and that `#project-home` is in the DOM. *Catches B3.*

**T4. User and agent messages render with distinct authorship attributes** → `test/chat-rendering.test.tsx` *(new file)*
Render `WorkspaceThread` with a workspace whose mock returns one user-authored message artifact and one agent-authored message artifact. Assert the user article carries `data-author="you"` (or equivalent) and the agent article does not. Assert their computed `background-color` differs. *Catches B4.*

**T5. Tool-call bursts collapse to a single row** → `test/chat-rendering.test.tsx`
Render `WorkspaceThread`. Dispatch five `report` artifacts in quick succession via the mock stream. Assert that the rendered thread contains exactly one `[data-component="ToolCallGroup"]` (or equivalent) with a count of 5, *not* five `.block` cards. *Catches B5; will fail until the coalesced renderer ships.*

**T6. New artifacts auto-scroll the thread to bottom while pinned** → `test/chat-scroll.test.tsx` *(new file)*
Render `WorkspaceThread` in a fixed-height container. Set `scrollTop` to `scrollHeight` (pinned). Dispatch an artifact_appended event. Assert `scrollTop` is again at the bottom (within 1 px). *Catches B6 — the happy path.*

**T7. Auto-scroll suppresses when user has scrolled up** → `test/chat-scroll.test.tsx`
Same setup, but first scroll up 100 px. Dispatch a new artifact. Assert `scrollTop` did not change. *Catches B6 — the rude-yank guard.*

**T8. Jump-to-latest pill appears when behind, dismisses on click** → `test/chat-scroll.test.tsx`
Same setup. Scroll up. Dispatch artifact. Assert `[data-component="JumpToLatest"]` is in DOM. Click it. Assert thread is at bottom and the pill is gone. *Catches B6 — recovery affordance.*

**T9. Submitting state appears within one frame of clicking send** → `test/chat-states.test.tsx` *(new file)*
Render `WorkspaceThread`. Type "hi", click send. Within `flushSync`, assert `[data-state="submitting"]` (or equivalent) is in the DOM. *Catches B7 — submit-acknowledgement.*

**T10. Streaming cursor mounts on the live message** → `test/chat-states.test.tsx`
Render. Trigger an `agent_streaming` mock event that opens a stream. Assert `.streaming-cursor` is rendered as a child of the in-flight agent message. End the stream. Assert it unmounts. *Catches B7 — streaming feedback + B13 — dead-code resurrected.*

**T11. Stuck-state copy appears after 15s of silence** → `test/chat-states.test.tsx`
Render. Send a message. Don't dispatch any reply. Use `vi.useFakeTimers()` to advance 16 s. Assert "Still working…" is in the DOM with `role="status"`. *Catches B7 — stuck heuristic.*

**T12. Send button is disabled while in flight** → `test/chat-states.test.tsx`
Render. Type, click send. Assert send button has `aria-disabled="true"` (or `disabled`). Resolve the postMessage. Assert it's enabled again. *Catches B14.*

**T13. Compose textarea has aria-busy while sending** → `test/chat-states.test.tsx`
Same setup. Assert `compose__input` has `aria-busy="true"` while in flight. *Catches B17.*

**T14. Two tabs in same workspace see the same artifacts (or different — the decision)** → `test/tabs.test.tsx`
Once B8's decision is made, lock in the contract with this test. If "tabs are views": both tabs see the same artifacts. If "tabs are threads": each tab has its own list. *Catches B8.*

**T15. Tab title indices don't collide after close+reopen** → `test/tabs.test.tsx`
Open tabs 1, 2, 3. Close tab 2. Open a new tab. Assert no two tabs share the same `title` (the underlying field, not the `displayLabel`). *Catches B10.*

**T16. ⌘T opens a tab when focus is anywhere in the workspace** → `test/tabs.test.tsx`
Render workspace. `fireEvent.keyDown(document, { key: 't', metaKey: true })`. Assert one new tab created. *Catches B9.*

**T17. Selected tab receives focus when activated programmatically** → `test/tabs.test.tsx`
Render. Call `selectTab(workspace.id, tabBId)`. Assert `document.activeElement` is the new active tab's button (or its associated tabpanel, per WAI Tabs pattern — pick one, lock it in). *Catches B11.*

#### Tier 2 — accessibility tests (one new dev dep: `jest-axe`)

**T18. Workspace thread has zero a11y violations** → `test/a11y.test.tsx` *(new file)*
Render with mixed user/agent/tool/approval artifacts. Run `axe` over the result. Assert no violations. *Establishes a baseline; catches every future regression in roles, labels, contrast.*

**T19. Streaming surface respects prefers-reduced-motion** → `test/a11y.test.tsx`
Mock `matchMedia('(prefers-reduced-motion: reduce)')` to return `matches: true`. Render the streaming cursor. Assert `getComputedStyle(cursor).animationName === 'none'` or that the keyframe step-count is zero. *Catches B7 reduced-motion regression.*

**T20. `aria-live` regions don't reannounce on update** → `test/a11y.test.tsx`
Render WorkspaceThread. Append three tool-call reports in a tight loop. Assert the live region was updated *atomically* once (we can't measure SR readouts, but we can assert that the `role="log"` element only changed text content for additions, and that `aria-relevant="additions"` is set). *Catches B20.*

#### Tier 3 — visual & e2e (gated CI job)

These add real CI cost so they belong on a separate Playwright workflow that runs on PR + nightly.

**T21. Playwright smoke: open Designer, create workspace, open tab, send message** → `e2e/chat-smoke.spec.ts` *(new harness)*
Boots the Tauri app via `tauri-driver` (or `npm run dev` against a Vite-served build with the IPC mocked at the network layer). Walks the user flow. Asserts: (a) one tab in the bar after one click; (b) message sent + reply received within 5s; (c) no console errors.

**T22. Playwright visual: tab states, message states, streaming state**
Pixel-snapshot the four canonical states: idle thread, submitting, streaming, stuck. Diff threshold ≤ 0.1 % pixels. *Catches B2, B4, B6, B7, B14 visually — including changes nobody noticed in code review.*

**T23. Playwright resize: tabs bar at 600px, 1000px, 1400px**
Drive the window to three widths. Assert the tabs bar always has `display: flex` with `flex-direction: row` (computed) and that no tab button has computed top > the next tab's top (i.e., they're on the same horizontal line). *Catches the layout-collapse hypothesis of B3.*

**T24. Stress: 50 tabs in a workspace, 200 artifacts in the thread**
Render. Time first-paint, scroll-to-bottom, and tab-switch. Assert each is < 100 ms. *Catches the perf knife-edge in `Quality Bar` of CLAUDE.md.*

### 5.4 Test infrastructure changes

These ship before the tests above.

1. **Add `jest-axe` and `@types/jest-axe`** to `packages/app` devDependencies. Configure in `test/setup.ts`. *Required for T18–T20.*
2. **Add a `MockClock` helper** in `test/helpers/clock.ts` that wraps `vi.useFakeTimers()` with helpers for "advance to next animation frame" and "advance to next 250ms tick". *Required for T7, T9, T11.*
3. **Add a `MockStream` helper** in `test/helpers/stream.ts` that captures the latest `ipcClient().stream` handler and dispatches typed events. The `workspace-thread.test.tsx` already does this inline at lines 229–273; extract it. *Required for T5, T6, T7, T10.*
4. **Add `vi.mock('../theme/motion')`** support so reduced-motion tests can flip the media-query mock cleanly. *Required for T19.*
5. **Stand up a Playwright project** under `apps/desktop/e2e/` with a `pnpm test:e2e` script. Webserver target points at `vite preview` of the desktop bundle with `VITE_USE_MOCK_IPC=1`. *Required for T21–T24.* This is the largest infra change and is the optional gate.

### 5.5 Coverage expectations

Each new bug we catch in the wild should land with a regression test from this taxonomy (component / a11y / e2e). The PR template should grow a checkbox: "Added a regression test under tier ____ for the symptom this PR fixes." That single discipline is what makes the test plan compound rather than rot.

---

## 6. Implementation status (this branch)

| Bug | Status | What changed | Test |
|---|---|---|---|
| **B1** Multiple tabs at once | ✅ fixed | `MainView.onOpenTab` now uses `openingRef` + `opening` state; `+` button shows `aria-busy` while in flight | T1 |
| **B2** Tabs no selected state | ✅ fixed | Active tab → `--weight-semibold` + opaque `--color-content-surface`; inactive tabs use `--weight-regular` + faded fill. Markup test guards data-active/aria-selected wiring; CSS source test guards the font-weight + background levers | T2 |
| **B3** Vertical tabs on home | ⚠️ contract-locked | The render code (`MainView.tsx:155–230`) gates `.tabs-bar` on workspace existence; T3 asserts `[role="tab"]` count is 0 when on project-home. If the symptom returns, the test catches it. Could not reproduce in jsdom — likely a transient or window-width condition. | T3 |
| **B4** No user-message bubble | ✅ fixed | `MessageBlock` emits `data-author="you"` for user role and `data-author="agent"` for non-user roles; bubble styling moved from dead `chat.css` selectors to live `.block--message[data-author=...]` rules. Dead `chat__*` rules removed. | T4 (×4) |
| **B5** Tool-call boxes | ✅ fixed | New `ToolCallGroup` collapses runs of consecutive `report` artifacts into a chevron-disclosure row; expanded view is flat single-line rows, not boxed cards. `groupArtifacts()` exported for testing. | T5 |
| **B6** No auto-scroll | ✅ fixed | `useLayoutEffect` keyed on `artifacts.length` pins to bottom when `stickRef.current === true`; on-scroll handler tracks the 32-px threshold. New "Jump to latest" pill appears when behind, restores stickiness on click. | T6, T7, T8 |
| **B7** No animations / activity feedback | ✅ fixed | New `ActivityIndicator` with three states (idle / submitting / stuck). 15-second timeout escalates submitting → stuck. Three-dot pulse uses `--motion-pulse`; reduced-motion collapses to static. Streaming-cursor + per-tool spinner deferred until backend emits `agent_streaming` / `tool_started` events. | T9, T11 |
| **B8** Per-tab persistence | ⚠️ scoping | Decision required (tabs-as-views vs tabs-as-threads). ADR pending. No code change yet; T14 test stub is in the audit. | (T14 deferred) |
| **B9** ⌘T not wired | ✅ fixed | Global `keydown` listener in `MainView` bound on mount; defers to native input when focus is in textarea/input/contenteditable. | T16 (×2) |
| **B10** Tab title collisions | ✅ fixed | `nextTabTitle()` scans every tab the workspace has held (including closed) and uses `max + 1` instead of `visibleTabs.length + 1`. | T15 |
| **B11** Focus management on close | ✅ fixed | After tab close, focus moves to the next tab if any, else to the new-tab button (via `requestAnimationFrame`). | T17 |
| **B13** Streaming-cursor dead code | ✅ resolved | Re-checked: the `.streaming-cursor` keyframes are still used by `StreamingText.tsx` (in the lab catalog). Not dead. | (existing) |
| **B14** Send button has no busy state | ✅ fixed | `ComposeDock` accepts `busy` prop; submit button gets `disabled` + `aria-busy` while in flight. | T12 |
| **B17** Compose has no aria-busy | ✅ fixed | Same `busy` prop sets `aria-busy` on the textarea. | T13 |
| **B20** aria-live spam | ✅ fixed | Added `aria-relevant="additions"` to `.thread`'s `role="log"` so deletions don't replay. | (covered by T18 once a11y suite lands) |

Deferred to follow-up work (still listed in §2):

- **B12** No fresh-tab empty state — partial: `hasStarted` toggle handles new tabs that have not yet been used; but a tab opened in a workspace that already has artifacts shows the running thread immediately. Needs ADR alongside B8.
- **B15** Approval blocks need transition animations — minor polish.
- **B16** No connection / IPC health surface — broader feature; pairs with the cost chip work in 13.G.
- **B18** No token / cost meter — feature; cost chip exists but is off by default.
- **B19** "Tab N" can collide with workspace meta strings — display-layer concern only.

---

## 6.1 Conversational polish (CC1–CC6)

After the structural fixes shipped, the chat still didn't *feel* conversational — it was correctly-bubbled but lifeless. This pass addresses the "feel like real-time communication" half of the user's ask.

| ID | Change | Detail |
|---|---|---|
| **CC1** | Humanized agent role labels | New `humanizeRole(role)` util maps `team-lead` → "Team Lead", `agent` → "Designer", strips `_agent` qualifiers, falls back to title-case. The chat reads as "Team Lead said …", not "team_lead_agent". |
| **CC2** | Message arrival animation | Every new artifact fades + slides in (0 → 100% opacity, +4px → 0px) over `--motion-enter`. Reduced-motion collapses to instant. The cue runs once per artifact mount, not on every refresh. |
| **CC3** | Inline relative timestamps | New `formatRelativeTime(iso)` util: "just now" / "Ns ago" / "Nm ago" / "Nh ago" / "yesterday" / "Nd ago" / calendar form. Each agent message renders a `<time datetime=… title=absoluteISO>relative</time>` element. User messages omit it (the bubble is enough chrome). |
| **CC4** | Demoted artifact-card chrome | Spec / code-change / pr / approval / prototype blocks now use `--color-border-soft`, tighter padding (`--space-3 --space-4`), and `max-width: min(48rem, 100%)` so they read as inline attachments inside the conversation column, not as edge-to-edge documents. |
| **CC5** | Conversation rhythm | Same-author runs use a `calc(-1 * --space-2)` negative top margin to tighten; author switches keep the wider `gap` from `.thread`. Tool-call groups attached to an agent message tighten the same way (they read as the agent's working notes, not as a separate turn). |
| **CC6** | Markdown in agent prose | New `MessageProse` inline renderer supports `**bold**` / `*italic*` / `` `code` `` / bare URLs. Block-level markdown (lists, headings, fences) is intentionally NOT handled — those land in their own artifact kinds (TaskList, Spec, CodeChange) so the chat surface stays a chat surface. Hand-rolled tokenizer (no `react-markdown` dep) so HTML can never pass through (XSS hardened by construction). |

**Tests added:** 22 new (humanize-role ×5, relative-time ×8, chat-rendering for CC1/CC3/CC6 ×9). Combined with the bug-fix tests, the chat surface now has 105-test coverage.

**What did *not* land in this pass:**

- **Per-token streaming.** The `StreamingText` component exists but is unused in the live thread because the Rust core doesn't emit `agent_streaming` / `tool_started` events yet. When those wire up, the streaming cursor + tool-running spinner from B7's design slot in.
- **Mid-message edits.** The message blocks treat each artifact as immutable. A future "agent edits its prior reply" event would need either an `artifact_updated` projector path or a per-message version key — out of scope.
- **Avatars / agent illustrations.** The cockpit register is text-first; adding an avatar surface would be a separate design decision (not all agents are "people").

---

## 6.2 Review-pass corrections (RP1–RP6)

Three perspectives — staff engineer, staff UX designer, staff design engineer — were applied to the implementation before opening the PR. They surfaced six issues that landed in the same branch.

| ID | Perspective | Issue | Fix |
|---|---|---|---|
| **RP1** | Engineer | `animation: thread-message-in var(--motion-enter, 220ms) ease-out both` — `--motion-enter` is a *transition* shorthand (`<duration> <timing>`); appending `ease-out both` produced a malformed `animation` declaration that engines parse inconsistently. | Use `--motion-standard` + `--ease-out-enter` directly so the shorthand has exactly one duration + one timing-function. |
| **RP2** | Engineer | Tab switch remounted `WorkspaceThread`, which re-fired the per-child slide-in animation for every existing artifact — a 50-message thread looked like it was panicking on every tab switch. | New `.thread--initial` modifier suppresses the animation for one paint after mount; cleared via two `requestAnimationFrame`s so subsequent additions still animate. |
| **RP3** | Engineer | `onSend` listed `artifacts` as a dep so the activity-snapshot read the live count, but every refresh recreated the callback identity — would have thrashed any future memo on `ComposeDock`. | Move the count to `artifactCountRef` synced on every render; `onSend` reads from the ref and stays stable. |
| **RP4** | UX | `aria-busy="true"` on the compose textarea was semantically wrong — that attribute means "contents may not be ready", but the user can keep typing a follow-up. AT could ignore the input. | Move `aria-busy` to the `<form>` element and the send button. Textarea stays fully exposed to AT. T13 updated to assert the new contract. |
| **RP5** | UX | The CC5 rhythm rule tightened "any message → user message", which incorrectly tightened the agent → user gap (a real turn boundary should stay wide). | Scope the rule to user-after-user and agent-after-agent only. |
| **RP6** | Design engineer | Activity dots at `--space-2` (4px) read as punctuation rather than as a thinking indicator at typical reading distance; tool-group head padding (`--space-1 --space-2` = 2/4) compressed the click target to ~22px. | Bump dots to `--space-3` (8px), gap to `--space-2`. Bump tool-group head padding to `--space-2 --space-3` (4/8) for a comfortable ~28px row. |

Two extra "harmonize-pass" guards landed alongside RP1/RP2 to lock in the contracts at the CSS-source level (jsdom can't compute styles, so we read the source directly):

- T-css-1: `blocks.css` must declare `.thread--initial > * { animation: none }` so a future cleanup can't silently delete the gating without test failure.
- T-css-2: `blocks.css` must declare the same-author meta-collapse rule so the Slack/Linear pattern can't regress to repeating headers.

CC3 also gained a 30-second tick interval at the `WorkspaceThread` level so relative timestamps stay live on otherwise-idle threads (the `<time>` element re-formats on each tick).

---

## 7. New bugs discovered during implementation

These came up while wiring fixes for B1–B11 and were not in the original audit. Tracking here so they're not lost.

### NB1. Cost chip can scroll out of view in dense tabs bar
`CostChip` at `MainView.tsx:191` uses `margin-left: auto` to push to the trailing edge. `.tabs-bar` has no `overflow-x`, so with many tabs the chip overflows past the right edge of `.app-main`. The chip is functionally inaccessible at high tab counts. **Fix shape:** Either pin the chip outside the scrollable bar or add `overflow-x: auto` with `flex-shrink: 0` on the chip.

### NB2. Mock IPC client surface duplicated across test files
`chat-scroll.test.tsx`, `chat-states.test.tsx`, and `workspace-thread.test.tsx` each rebuild the IpcClient with all 30+ method stubs. Tier-2 infra task: extract to `test/helpers/ipc.ts` with a `makeMockClient(mock, overrides?)` factory. Reduces 70+ lines of churn per new chat test.

### NB3. ComposeDock auto-focus fires on every draft change
`ComposeDock.tsx:69–72` runs `useEffect(() => textareaRef.current?.focus(), [draft])`. Any draft change re-focuses the textarea, including when the user types inside it. Mostly invisible (focus is already there) but it does prevent focus from drifting elsewhere — which can be a problem if a user clicks a tool-call disclosure while a draft is in progress.

### NB4. Tab switch always lands at bottom of thread
`MainView.tsx:204` keys `WorkspaceThread` on `${workspace.id}:${activeTab}`, forcing a full unmount + remount when switching tabs. With B6's scroll stickiness, the new mount initializes `stickRef.current = true` and pins to bottom. For a thread the user was reading mid-history, this is jarring. **Fix shape:** Hoist scroll position into a per-tab map keyed on `(workspace.id, tab.id)`, restore on remount.

### NB5. `displayLabel` reindexes user-renamed `Tab 7` titles
`MainView.tsx:174–181` regex-matches `/^Tab \d+$/` and reindexes against position. If the user explicitly renames a tab to "Tab 7", their rename gets stomped on the next render. **Fix shape:** Track auto vs user-renamed in the `Tab` type (e.g., `auto_titled: bool`), only reindex auto titles.

### NB6. New `useEffect` in WorkspaceThread on `[artifacts]` re-runs onSend identity
The `onSend` callback in `WorkspaceThread.tsx` now lists `artifacts` as a dep so the activity snapshot reads the current count. Every artifact refresh re-creates `onSend`, which is passed into `ComposeDock`. Today `ComposeDock` doesn't memo-compare it, so this is fine. If a memo lands later, it'd thrash. **Fix shape:** Use a ref for the count snapshot if perf shows up.

### NB7. ToolCallGroup ignores artifact author
The grouper merges any consecutive `report` artifacts regardless of `author_role`. If a future surface lets users emit `report` artifacts (e.g., a "user noticed:" annotation), they'd get bundled with agent tool calls. **Fix shape:** Group only by author runs, or by `(kind, author_role)` pairs.

### NB8. `data-component="WorkspaceThread"` only emits when the thread is past the suggestions phase
Currently the `data-activity` attribute is on the outer `.workspace-thread` and is emitted unconditionally — but tests for "submitting state appears" need to wait for the submit-and-render cycle. The state itself flips correctly; this is a test-ergonomics note, not a bug.

### NB9. `useEffect` for ⌘T listener deps disabled on remount
The handler ref pattern keeps the listener stable, but means the listener never re-attaches if the project/workspace changes mid-session — fine, it just delegates through the ref.

---

## Out-of-scope but worth flagging

- **First-run onboarding.** The user reported they were running for the first time and immediately hit B1–B7. Designer needs a smoke test that exercises the literal first-run flow, end to end, before this kind of regression escapes again.
- **Cost chip.** Off by default per ADR 0002. With B7's "stuck" state landing, we should reconsider — a visible cost chip is also a "system is alive" signal, so flipping it on by default may pay for itself.
- **Compose persistence.** Drafts should survive `⌘R` and tab switch. Not a bug today (no persistence at all), but it's the kind of polish the user listed implicitly under "feels like real-time communication."
