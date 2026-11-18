# Spec: question cards (answer Claude's questions)

**Goal:** when Claude asks a structured question (`AskUserQuestion`), show it as a card and send your answer back. Today
Designer declines these with "ask in plain text", which blocks something the model does well (CLAUDE.md: scaffold, don't
replace). The card is the whole feature; no logic about what to ask.

## Behavior
1. A question card in the conversation: header chip, the question, options with their descriptions, single or multi-select
   (as the question says), and an optional preview box when an option has `preview`. 1-4 questions per card.
2. Always available: **Other…** (free text), **Skip**, and **Reply in chat instead** (dismisses the card; your next message
   is the answer).
3. Submit with the button or Enter. Keyboard: arrow keys / number keys choose options, Space toggles in multi-select, Tab
   order is logical, Escape does not dismiss silently. Radio/checkbox semantics and a labelled group (screen readers).
4. After answering the card collapses to a one-line summary ("Q: … → A: …") and stays in history; replay shows the same.
5. Stop (or an interrupted turn) cancels a pending card (it shows as cancelled).

## How
- SDK: `AskUserQuestion` arrives in `canUseTool` with `input.questions`. Answer by allowing with
  `updatedInput = { ...input, answers }` where `answers` maps **question text to the answer string** (multi-select answers
  comma-separated); optional `annotations` per question. For skip/dismiss, put the text Claude should read in `answers`
  (for example "The user skipped this question" / "The user chose to reply in chat"). Check the exact shapes in
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` (`AskUserQuestionInput/Output`).
- New persisted events `question_request { requestId, questions }` and `question_answered { requestId, answers, how }`.
  New client message `answer { threadId, requestId, answers, how }`. Remove the current decline branch in
  `claude.ts` (`askUser`).
- Parked requests are tied to the session like approvals (denied/cancelled on interrupt or session end).

## Files
Own: new `Question.tsx` + `styles/questions.css`; `claude.ts` (`askUser` branch), `manager.ts` (answer routing),
`fake.ts` (scenario: a prompt containing "question" asks 2 questions).
Touch lightly: `Messages.tsx` (render the new item kind), `store.ts` (`applyEvent`), `packages/shared/src/index.ts`.
Avoid: `Composer.tsx`, `Preview.tsx`, `Workbench.tsx`.

## Acceptance tests (write first)
- Unit/integration (fake adapter): request persisted; answer round trip returns the right `answers` shape for single,
  multi, other, skip, reply-in-chat; interrupt cancels; replay shows answered and cancelled states.
- Browser: render, keyboard-only answering, multi-select, Other text, submit, collapse, reload; focus and motion suites.
- Real Claude (your login): ask "ask me which colour I prefer, with 3 options" and see the card; pick one; Claude's next
  message uses your answer.

## Needs the owner's Mac
Real Claude questions on your account (some have previews and multi-select), feel of the keyboard flow.
