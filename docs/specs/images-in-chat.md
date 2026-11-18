# Spec: images in chat

**Goal:** paste, drop or attach screenshots into the message box and send them to Claude with your text. Designers give
feedback with pictures; this must feel like Claude desktop. Principle: pass images through; we do no OCR, resizing
tricks or analysis of our own (see CLAUDE.md "Scaffold, don't replace").

## Behavior
1. Add images by **paste** (Cmd/Ctrl-V with image data), **drag-and-drop** onto the composer, or an **attach** button
   (file picker). Up to 5 images per message; png, jpeg, gif, webp; each at most 5 MB. Anything else is refused with a
   plain message (nothing is silently dropped).
2. Thumbnails appear above the text box with a remove (x). Enter sends text + images together. Image-only messages are
   allowed. The Stop/queue behavior is unchanged; a queued message keeps its images.
3. The sent message shows its thumbnails in the conversation; click opens a simple larger view (Esc closes, focus returns).
4. History replay shows them too (they are stored, see below).
5. While a turn is running you can still attach images to a queued message.

## How
- Wire: `ClientMsg` `send` gains `images?: { mime: string; data: string /* base64 */ }[]`. The persisted `user_message`
  event gains `images?: { id: string; mime: string }[]` (`id` = content hash).
- Server stores each image once at `<data>/threads/<threadId>/attachments/<id>.<ext>` (owner-only, 0600). Never trust the
  declared type: check the file's magic bytes match png/jpeg/gif/webp. **No SVG** (it can carry script).
- Serve with `GET /api/attachment/<threadId>/<id>`: needs the token header (so the page fetches it and shows a blob URL; an
  `<img src>` cannot send headers), fixed `Content-Type` from the stored type, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox`, same-origin check like the other API routes. IDs are hashes only; never build a path
  from user text.
- Claude side: `ClaudeSession.send` builds the user message content as blocks: text block (if any) + image blocks
  (`{ type: 'image', source: { type: 'base64', media_type, data } }`). Verify against the SDK types in `node_modules`.
- WebSocket payload limit must allow 5 x 5 MB (base64 adds a third); check `ws` `maxPayload` in `index.ts`.

## Files
Own: `packages/web/src/Composer.tsx`, new `Attachments.tsx` + `attachments.ts` (web), `styles/images.css`.
Touch lightly: `Messages.tsx` (thumbnails in the user row), `store.ts` (image metadata on user items; blob URL cache),
`packages/shared/src/index.ts` (types), `packages/server/src/{manager,claude,store,index}.ts` (save, pass, serve),
`packages/server/src/fake.ts` (echo "got N images" so tests can see them).
Avoid: `Preview.tsx`, `Workbench.tsx`, `Sidebar.tsx`.

## Acceptance tests (write first)
- Unit: magic-byte check (png/jpeg/gif/webp accepted; svg, html renamed .png, truncated files refused); size/count limits;
  id is a content hash; stored owner-only; path traversal via ids impossible.
- Integration (fake adapter): send text+2 images, events persisted with ids, replay returns them, attachment route needs the
  token and returns the right type and headers; a wrong thread id or id is 404.
- Browser: paste an image (dispatch a `paste` event with a `DataTransfer` containing a PNG), see the thumbnail, remove one,
  send, see it in the conversation, reload and still see it; drag-drop; refused file shows a message; focus rings and
  reduced motion for the new controls (extend the `focus` and `motion` suites).
- Real Claude (run with your login): send a generated PNG of a red square and ask its colour; the answer says red.

## Needs the owner's Mac
Paste from the macOS screenshot clipboard (Cmd-Ctrl-Shift-4), dragging from Finder/Preview, large Retina screenshots.
