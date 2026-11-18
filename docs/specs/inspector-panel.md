# Spec: inspector panel (visual properties, copy the changes)

**Goal:** select an element in the preview, change its look visually in a Figma-style panel on the right, and copy a report
of exactly what changed to paste to Claude (or insert it into the message). Selection works the same way commenting
will later. Works for HTML files, localhost pages and websites.

## What already exists (read these first)
- `packages/server/assets/agent.js`: the page agent injected into previewed pages. Hover/select overlay with resize
  handles and size pill, drag-to-move, arrow-key nudge, live style edits with per-property from/to log and reset. Its
  message protocol is documented in the file header (`hello | enable | select | deselect | apply | reset` and
  `ready | selected | deselected | log | hover`).
- `packages/server/src/{agent,proxy,preview}.ts`: injection into served HTML; opt-in proxy (`/api/proxy`) for localhost and
  website URLs; header handling; WebSocket tunnel.
- `packages/shared/src/edits.ts`: `buildEditsReport(edits, ctx)` produces the text you copy (tested).
- Tests: `proxy.test.ts`, `edits.test.ts`, `preview.test.ts`.

## Behavior
1. **Inspect toggle** in the preview bar (hidden/disabled with a reason when the target cannot be inspected). For file
   previews it just enables the agent. For a URL target it switches the frame to the proxied address
   (`GET /api/proxy?url=` returns `{port, path}`; build `http://localhost:<port><path>`) and says so ("shown through
   Designer's proxy so it can be inspected; some sites with logins may not work").
2. **Select** by clicking an element in the page (page click handlers are suppressed while inspecting). Breadcrumb of
   ancestors in the panel header to select a parent.
3. **Panel** (right column, shown only while inspecting; sections like the Figma reference): Position (X/Y fields, align
   buttons, rotation), Layout (flow: block / vertical / horizontal / wrap / grid via display+flex props, gap, padding,
   W/H, clip content), Appearance (opacity, corner radius, visibility), Fill (colour + hex + opacity), Stroke (width, style,
   colour), Effects (one drop shadow: x, y, blur, spread, colour), Typography when the element has text (family, size,
   weight, line height, letter spacing, alignment, colour). Show current computed values.
4. **Fields**: number fields scrub by dragging their label, arrow keys step (Shift = 10x), Enter commits, Escape reverts;
   colour = native colour input + hex text; segmented controls for enums. Every edit applies live in the page.
5. **X/Y** edit a translate offset (the agent's `translate`), shown as the page position; **W/H** set width/height.
6. **Footer**: `N changes on M elements`, **Copy changes** (clipboard, `buildEditsReport`, with a "Copied" confirmation),
   **Add to message** (inserts the report into the composer; add a `draftInsert` path like the existing quote insertion),
   **Reset** (all) and per-element reset.
7. The preview must not auto-reload on turn end while edits are pending (show a note instead).

## Files
Own: new `packages/web/src/inspector/*` (store, bridge to the iframe, panel, fields, icons), `styles/inspector.css`.
Touch lightly: `Preview.tsx` (Inspect toggle, iframe ref, enable/disable, no-reload-with-pending-edits),
`Workbench.tsx` (third column), `Composer.tsx` (accept inserted text), `store.ts` (draft insert).
May change `assets/agent.js` and add agent/proxy tests.
Avoid: `Messages.tsx`, `Chat.tsx`, `Sidebar.tsx`.

## Security
- Only accept messages from the preview frame's `contentWindow` and its known origin; ignore everything else (the agent
  already ignores non-parent senders; mirror that in the panel). Never evaluate page-provided HTML in the app; show text only.
- Reports include page text/HTML: render them as plain text, and note in the UI that pasted page text is untrusted.

## Acceptance tests (write first)
- Browser (Playwright, `frameLocator`): file preview and a localhost server through the proxy: select; edit one property
  in each section and read the real computed style from the page; move/resize via fields and by dragging handles; Copy
  yields exactly `buildEditsReport` output (grant clipboard permission); Add to message fills the composer; Reset restores
  the original; page onclick handlers do not fire while inspecting and do fire after turning Inspect off; a forged message
  from the page itself is ignored.
- Unit: field parsing/formatting (px, %, colours), scrub maths, panel state from a `selected` payload.
- Extend `focus` and `motion` suites for the panel.

## Needs the owner's Mac
Feel of scrubbing and handles, a real dev server (hot reload plus edits), a real website through the proxy.
