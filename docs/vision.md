# Vision: the feedback loop is the product

Status: owner's vision (2026-11-18), written down so every phase can be judged against it. Directional, not a spec.
Where this meets the build plan: [product.md](product.md) (what we differ on), [roadmap.md](roadmap.md) (phases).

## The thesis
Models will keep getting better at producing designs and code. What stays scarce is the **loop between a person and
the model**: how fast you can say what is wrong, how precisely you can say *where*, and how little is lost between your
head and the agent's next attempt. Designer exists to make that loop faster, higher quality and more specific.

Primary user is a designer; engineers benefit too. The measure of success is **cycle time and fidelity of intent**, not
how much we build around the model.

## Positioning: the glue, not another model or canvas
Three layers make up the work. We compete on only one.

| Layer | Examples | Ours? |
|---|---|---|
| **Model and harness** | Claude Code, Codex, whatever comes next | No. Use theirs as they are; never build a worse version or get in their way. |
| **Canvas / artifact** | HTML, a localhost app, Paper, Subframe, Twombly, Onlook, a Figma file, anything that runs in a browser | No. Don't compete on rendering, WebGL vs HTML, or editing capability. Host and complement them. |
| **Interaction between user, model and artifact** | comments, voice, pointing, chat-to-canvas back-and-forth, capturing context, showing the result | **Yes. This is the whole product.** |

Consequences:
- Model-agnostic and canvas-agnostic by intent. Not every model or canvas has to be supported on day one, but no
  decision should hard-wire us to one. Each new one should be an adapter or a URL, not a rewrite.
- Designer should feel like glue: the user states intent once, in the fastest way for them, and Designer carries it
  (with its place and context) to whichever model, about whichever artifact, with no manual busywork such as
  screenshotting, copying selectors, describing "the third button on the left", or re-explaining what the page is.
- The user should be able to bring their favourite canvas. If it runs in a browser, it opens in the preview pane and
  gets the feedback layer on top.
- Where a canvas or model exposes its own integration (for example an MCP the model can drive), we pass it through
  and never mediate it.

## Anatomy of a cycle
```
 intent  ->  capture  ->  apply  ->  review  ->  (next intent)
 (you)      (Designer)   (model)     (you)
```
- **Intent**: what you mean, in the moment you notice it.
- **Capture**: turn it into something the model can act on, with its place and context attached.
- **Apply**: the model changes the thing.
- **Review**: you see the result in the same surface you gave the feedback on.

Designer owns **capture** and **review** (the surface, the anchors, the ways to speak). The model owns **apply**, and
increasingly the interpretation inside capture. Every feature should shorten one of these four steps or remove the
friction between them. Anything that does not is out of scope.

## Specificity is the lever
"Make it feel lighter" is cheap to say and expensive to interpret. The same sentence anchored to an element, with its
styles, a screenshot and what you were pointing at, is nearly unambiguous. The ladder, from what exists to where we
want to push:

| Rung | What it is | Status |
|---|---|---|
| 1. Quote and reply | Select text in a reply, quote it into the next message | built |
| 2. Inspect and edit | Select an element, adjust properties visually, copy the changes to the agent | in progress (R3) |
| 3. Pinned comments / design mode | Click a place on the preview and type a comment; sent as structured context in a normal message | planned (R7) |
| 4. Voice comments | Speak while pointing; transcript is attached to the element or region you were on | idea |
| 5. **Critique mode** | Record a critique session; the agent listens live, drops comments in the right places, starts synthesizing and proposing how to apply them | idea, the long-term push |
| 6. **Meeting mode** | Same, but running through a design review with other people; feedback is captured and applied without anyone typing | idea |
| 7. Continuous loop | The agent applies feedback as it arrives; you review versions as they land and keep talking | idea |

Rungs 1-3 are table stakes that other tools also have. 4-7 are where Designer is different.

## Real workflow pain this should remove (owner examples, 2026-11-19)
Today the owner works between Claude (desktop or Conductor) and Paper. Two loops are clumsy; both are interaction
problems, not model or canvas problems.

**1. Comments on a canvas the agent cannot answer.**
Flow today: prompt Claude, it generates designs in Paper, the owner leaves comments on the Paper canvas, Claude answers
all of them in one long chat message that is too much to read, and the replies are nowhere near the things they are about.
The owner wants to continue each thread where the comment was left. Paper does not support agent replies in threads
(owner-reported; it may add it, so do not build on either assumption).
What this asks of Designer:
- **One thread per comment, at its anchor.** The model's answer to a comment is a short reply attached to that comment
  and shown on the preview, not a paragraph in chat. Chat keeps at most a one-line digest ("replied to 6 comments,
  changed 3"). Mechanism: the message we send carries comment ids and asks for one short reply per id; we render
  the replies at the anchors. A prompt plus a renderer, no second implementation of the model.
- **Reply, resolve, and re-ask in place.** Continue the thread from the pin; resolved threads fold away; unresolved
  ones are what the next turn is about.
- **Works with a canvas that has no comment API.** Comments made in Designer's layer on top of the loaded canvas
  (pixel or DOM anchors) work on any canvas. If Paper (or another canvas) later supports agent threads, an adapter
  routes the same thread there (tier 3) instead of beside it. Whether Paper exposes its comments to a model today is
  unverified; do not promise importing them until checked.

**2. Critiques recorded without knowing what was being pointed at.**
Flow today: record the crit in Granola; the transcript has "this one feels off" but not which "this one". Granola's
screen-context capture needs another macOS permission and its behaviour is unclear to the owner (not verified here).
What this asks of Designer:
- **Capture speech and attention together, inside the app.** Because the canvas is loaded in Designer's own webview,
  the pointer, hover, selection and screenshots of that view are available without screen recording; only the
  microphone needs a permission, asked once with a plain explanation. Expected on Electron, to be verified on the Mac.
- **Seamless, not another tool to configure.** Press record, review, stop. The result is a timeline the model can
  turn into anchored comments and a plan (critique mode below).
- **Meetings are the hard case.** Capturing other people's voices on a call means system-audio capture, which is a
  separate permission and technically harder (unverified). Options to evaluate: our own capture; or keep a
  meeting-notes tool for audio and import its transcript, aligning it with our pointer trail by timestamp. The second
  only works if the imported transcript has usable timestamps (unverified for Granola).

Together these are the target experience: speak or point, and the feedback lands as a thread at the right place,
answered there, with chat left for conversation rather than a dump of replies.

## Canvas-agnostic by design
The feedback layer must not depend on knowing how a canvas works inside. Anchors come in tiers, from works everywhere
to works best; each tier is an upgrade, never a requirement:

1. **Pixels (works on any canvas).** A screenshot of the view, the pointer position or drawn region in it, and the
   timestamp. This works for WebGL, `<canvas>`, a remote design tool, anything we can display. It depends on the
   model's vision, so it improves for free as models improve.
2. **DOM (works on anything we can inject into).** Selector, rect, text, computed styles, via the page agent that
   already exists for the inspector. HTML files and localhost always; other sites need the desktop webview (R5-R7).
3. **Canvas-native (optional, per canvas).** If a canvas exposes selection or object identity (a plugin hook, an API, an
   MCP), we can attach that identity too. Unverified for Paper, Subframe, Twombly and Onlook; check each before
   promising anything, and treat each as its own small adapter.

A payload carries whatever tiers are available. The model reads the richest one it has; we do not rank or rewrite them.
This is also why the webview matters: the more canvases we can load and annotate, the more places the loop works.

Design rule: if a feature only works on one canvas, it belongs in that canvas's adapter, not in the core loop.

## Critique mode (the first big idea)
You press record and review the work out loud, the way you would with a colleague at your desk: walk the page, point at
things, say "this spacing is too tight", "this reads as disabled", "I like this, keep it", "make the header feel more
like the first version".

What the app captures (all timestamp-aligned):
- the audio transcript (live, partial results shown as they arrive);
- where you were: pointer position, hovered or selected element, scroll position, the state of the preview;
- screenshots at the moments that matter (when you pause on something, or on request).

What the **model** does with it (this is the part we do not build; the prompt and the stream are the interface):
- anchors each remark to the element or region it was about, using the timeline;
- separates complaints from praise from questions from "keep this";
- adds comments as pins on the preview while you talk, so you can see it understood you, and fix a misplaced one
  with a click or a word;
- groups related remarks, notices conflicts ("you said tighter here and more air there") and asks about them;
- proposes a plan for applying everything, and applies it when you say go (or immediately, in the continuous rung).

What Designer renders: the live transcript, the pins the model creates, the model's synthesis and plan, and one-click
"Apply this", "Apply all", "Ask me about this". Pass-through for everything else.

### Meeting mode
Same pipeline, but the audio is a review session with several people. Extra needs: it is obvious when recording is on
and who is being recorded; speaker labels (even if only "you" vs "others") so a stakeholder's remark is not attributed to
the designer; the model separates decisions from discussion. Consent and storage matter more here than anywhere else
in the app (see open questions).

### Voice as individual prompting
Dictating a single prompt while pointing at something is the small version of critique mode and the likely first step:
the same timeline capture, one utterance, sent as one normal user message with the anchored context attached.

## Interface principles (owner, 2026-11-20)
Directional rules from the owner's reactions to other tools. They apply to every surface we add.

0. **Nothing between you and the page.** The goal, in the owner's words, borrowed from how Dia feels: the screen is
   the artifact, and everything else (worktrees, chat, pinned pages, tools) is available but out of the way. Dia and Arc are
   known for adding sidebars and features; what matters is that they also get out of the way. The resting state is one
   thin bar and the page.
1. **Simpler is always better.** Simple rules, simple logic, simple UI. If a design needs a special case, a mode or
   a setting, look for the simpler design first. Elegant, smooth, fast and intuitive come from simplicity.
2. **Core UI is only what is used constantly.** Orca-style rows of buttons are the anti-example. Occasional things
   (terminal, file tree, settings, review) are reached by a slash command in the composer or a command palette, or
   simply by asking the model. No per-workspace icon buttons for them.
3. **Right thing at the right time; the rest out of the way but one gesture away.** Everything that can be hidden has
   the same three states: hidden, peek (floats over the content) and pinned (stays). Same rule for every panel.
4. **The artifact never moves.** Panels float over it instead of resizing it, so remarks anchored to a view stay valid
   and nothing shifts while you are giving feedback.
5. **Chips as resting state.** A worktree chip at top left (name and status dot, badge when another worktree needs you)
   and a chat chip at bottom left (draggable, position remembered). Click the chip to open the popover; hover peek is
   optional and off by default because it slows fast switching.
6. **Keyboard first for switching.** Cmd+1 to 9 jumps straight to a worktree (numbers shown on the rows). Ctrl+Tab
   opens the popover and cycles, most recent first; release Ctrl to commit. Never open anything on a lone held
   modifier, which would flash on Cmd+C and similar. Unverified on the owner's Mac against the canvases in use.
7. **Chat has several forms for one conversation:** docked, floating popup, minimized bar (status and last line),
   full. The form follows how much room the moment needs; the content never changes.
8. **Pinned pages per worktree.** The pages that belong to the work (its dev server, the Linear issue, the GitHub PR, the
   Paper canvas) are pinned in the thin bar as icons, one click away. The agent can pin a page itself through one small
   tool, `save URL` (a shortcut for what the user would otherwise paste), and the user can pin by hand. Switching
   worktree switches the pins. Pinned pages stay loaded in the app's own persistent session, which helps a login last
   once it is done; it does not replace the first sign-in (see the password-manager notes under open questions).

## Applying the scaffold test
Per CLAUDE.md: *if the model were 10x better tomorrow, does this get better for free?*
- Capture is ours and stays ours: the surface, the pointer and element anchoring, the recording, the transcript.
  A better model does not remove the need to know what you were looking at.
- Interpretation is the model's: anchoring remarks, grouping, conflict detection, planning, applying. We pass a
  timeline and a prompt; we do not write our own "feedback understanding" layer, classifier or ticket system.
- Chat stays pass-through: a critique session ends as ordinary messages (and the model's own plan, todos and
  questions rendered as they are for any turn), never a side channel the model cannot see.
- If the model can do it from a chat message, the feature is a shortcut that writes that message (a button that sends
  "turn these remarks into a plan"), not a second implementation.

## What "incremental" looks like
Small, each shippable, each making the loop measurably tighter:
1. Finish the inspector and share its element-selection layer with comments (R3, R7).
2. Pinned comments with a structured payload: selector, rect, text, optional crop. One normal user message.
   Replies come back per comment and render as threads at their pins, with a one-line digest in chat.
3. Pointer/selection trail: record which element you were on and when, even before voice exists.
4. Voice on a single comment (system dictation first, which already works; in-app capture when we need timestamps).
5. Record mode: transcript plus the trail, handed to the model as one timeline with a ready-made "turn this into
   pins and a plan" prompt. The model does the rest.
6. Live version: stream the transcript as you talk and let the model add pins while you are still speaking.
7. Meeting mode, and the continuous loop, once 5-6 are trusted.

Each step should be dogfooded by building Designer in Designer before the next begins.

## How we will know it is working
- **Cycle time**: from noticing something to seeing the revised result. Should drop with each rung.
- **Re-asks**: how often the same feedback has to be given twice because the model misread the place or the intent.
- **Typing avoided**: share of feedback given by pointing or speaking rather than writing a paragraph.
- A qualitative bar: giving feedback in Designer should feel like talking to a collaborator who is looking at the
  same screen, not filling in a form.

## Open questions
- **Speech to text**: where does it run? Options: the browser/Electron speech API, macOS on-device speech, a model
  with audio input, or a local model. Unverified: latency, accuracy, whether on-device works well enough for live
  pins. Prefer on-device so audio never leaves the machine. Decide with a short spike before step 4.
- **Privacy and consent** for recordings, especially meetings: keep audio local, store transcripts like chat logs
  (owner-only permissions), show an unmissable recording indicator, never record without an explicit start. Add to
  [security.md](security.md) before step 5.
- **Untrusted text**: transcripts and text captured from pages are input to the model, the same class of risk as inspector
  reports carrying page text (see plan.md security gaps). Label them as captured content in the message.
- **Logins in the pane (password manager)**: unverified on the owner's Mac. Findings so far: the browser's built-in
  manager (Chrome, Dia) cannot be inherited by an embedded view; password-manager extensions in Electron are
  uncertain and widen page access; Apple Passwords autofill and passkeys in an embedded view are unconfirmed for both
  Electron and a native WKWebView. Baseline: sign in once in the pane (paste from the manager) with a persistent
  session, never reading or copying credentials. Alternative worth a spike: run the feedback layer as an extension in
  the owner's own browser so logins and the manager are already there. Decide after a spike.
- **Anchor shape**: the three tiers above in one payload. Decide the shape once, in R7, with pixels as the baseline.
- **Which canvases first**: pick two or three the owner actually uses (Paper is already in the workflow) and verify
  each loads in the webview, can be annotated at tier 1 or 2, and whether it offers tier 3. Everything else follows
  the same adapter shape.
- **Where the glue stops**: when a canvas has its own comment or review system, do we sync with it or stay beside it?
  Default: stay beside it and send feedback to the model, rather than become a second source of truth.
- **Timing of pins**: when you say something about a thing you already moved off, the model has to look back along
  the trail. Needs real recordings to tune; keep the trail raw so the model can reason over it.
- **Who applies, and when**: manual "Apply" per remark vs apply-all vs continuous. Likely a per-session setting,
  defaulting to manual until trust is earned.
- **Review surface**: the next version should appear in the same place with an easy compare against the previous
  one (ties into the variants work in product.md).
