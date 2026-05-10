import type { Artifact } from "./types";

// Synthesized thread: a workspace shipping the chat-ui-audit's B6 fix
// (auto-scroll stickiness on WorkspaceThread). Meta but realistic — every
// artifact type the audit mentioned plus streaming and approval.
//
// Time scale is compressed (~3 minutes total) so the "recent vs past"
// register in v5 is visible without manufacturing dates.

const T0 = new Date("2026-05-04T21:42:00").getTime();
const t = (sec: number) => new Date(T0 + sec * 1000).toISOString();

export const workspaceTitle = "chat-ux-audit";

export const thread: Artifact[] = [
  {
    id: "a1",
    kind: "message",
    author: "user",
    timestamp: t(0),
    body:
      "Please add the auto-scroll stickiness from the audit (B6) to WorkspaceThread. " +
      "The fix should preserve scroll position if the user has scrolled up, but stick to " +
      "the bottom if they're already there. Wire a 'Jump to latest' pill for the scrolled-up case.",
  },
  {
    id: "a2",
    kind: "message",
    author: "agent",
    timestamp: t(4),
    body:
      "Reading the relevant files and the existing scroll handling. Will mirror the " +
      "iMessage / Linear pattern — useLayoutEffect on artifacts.length, only auto-scroll if " +
      "stickRef is true.",
  },
  {
    id: "a3",
    kind: "tool-call",
    author: "agent",
    timestamp: t(7),
    verb: "Read",
    target: "package.json",
    durationMs: 80,
    status: "ok",
  },
  {
    id: "a4",
    kind: "tool-call",
    author: "agent",
    timestamp: t(8),
    verb: "Read",
    target: "tabs/WorkspaceThread.tsx",
    durationMs: 120,
    status: "ok",
  },
  {
    id: "a5",
    kind: "tool-call",
    author: "agent",
    timestamp: t(9),
    verb: "Read",
    target: "blocks/blocks.css",
    durationMs: 60,
    status: "ok",
  },
  {
    id: "a6",
    kind: "tool-call",
    author: "agent",
    timestamp: t(10),
    verb: "Search",
    target: 'codebase for "scroll"',
    durationMs: 320,
    status: "ok",
  },
  {
    id: "a7",
    kind: "tool-call",
    author: "agent",
    timestamp: t(12),
    verb: "Read",
    target: "components/ComposeDock.tsx",
    durationMs: 90,
    status: "ok",
  },
  {
    id: "a8",
    kind: "message",
    author: "agent",
    timestamp: t(20),
    body:
      "Found the scroll setup. The thread container has overflow-y: auto but no scroll " +
      "tracking. Adding a threadRef and a stickRef per the audit's pattern, with a " +
      "useLayoutEffect on [artifacts?.length]. The pill renders when stickRef is false and " +
      "new content arrives — same behavior as iMessage's 'jump to latest'.",
  },
  {
    id: "a9",
    kind: "code-change",
    author: "agent",
    timestamp: t(45),
    file: "packages/app/src/tabs/WorkspaceThread.tsx",
    added: 18,
    removed: 2,
    summary: "Wire scroll-stickiness + jump-to-latest pill",
    diffPreview:
      "- useEffect(() => {\n" +
      "-   thread.scrollTop = thread.scrollHeight;\n" +
      "+ const threadRef = useRef<HTMLDivElement | null>(null);\n" +
      "+ const stickRef = useRef(true);\n" +
      "+ const onScroll = () => {\n" +
      "+   const el = threadRef.current;\n" +
      "+   if (!el) return;\n" +
      "+   stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;\n" +
      "+ };",
  },
  {
    id: "a10",
    kind: "tool-call",
    author: "agent",
    timestamp: t(58),
    verb: "Run",
    target: "tsc --noEmit",
    durationMs: 4200,
    status: "ok",
  },
  {
    id: "a11",
    kind: "tool-call",
    author: "agent",
    timestamp: t(72),
    verb: "Run",
    target: "vitest run",
    durationMs: 6100,
    status: "ok",
  },
  {
    id: "a12",
    kind: "report",
    author: "agent",
    timestamp: t(85),
    classification: "fix",
    title: "Auto-scroll stickiness shipped",
    body:
      "Tests pass: 110 (+3 new). Typecheck clean. Stickiness wired with the iMessage / Linear " +
      "pattern; threshold of 32px from bottom counts as 'pinned'. Jump-to-latest pill renders " +
      "when the user has scrolled up and new content arrives.",
  },
  {
    id: "a13",
    kind: "message",
    author: "agent",
    timestamp: t(110),
    streaming: true,
    body:
      "Want me to add a regression test for the case where the user is mid-read on a long " +
      "agent message and content streams in below — to make sure the page doesn't yank them",
  },
  {
    id: "a14",
    kind: "approval",
    author: "agent",
    timestamp: t(115),
    title: "Merge PR #142",
    context: "Add auto-scroll stickiness to WorkspaceThread (+18 / −2, 3 new tests)",
    team: "chat-ux-audit",
    actions: [
      { label: "Hold", intent: "ghost" },
      { label: "Merge", intent: "primary" },
    ],
  },
];
