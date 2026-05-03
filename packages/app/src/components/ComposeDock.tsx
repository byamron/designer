import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IconButton } from "./IconButton";
import { Tooltip } from "./Tooltip";
import { IconX } from "./icons";
import { ComposeDockActivityRow } from "./ComposeDockActivityRow";
import type { TabId, WorkspaceId } from "../ipc/types";

/**
 * ComposeDock — the full compose/input surface shared by PlanTab and the
 * unified-thread surface in the workspace-thread sketch. Owns its own draft,
 * attachments, model/effort/plan-mode controls, and drag-and-drop target.
 *
 * Callers pass an `onSend` handler and optionally seed the draft via the
 * imperative handle (used by the thread sketch's empty-state suggestion
 * chips). All styling comes from the existing `.compose` CSS classes —
 * no new tokens, no inline overrides.
 */
export type ComposeModel = "opus-4.7" | "sonnet-4.6" | "haiku-4.5";
export type ComposeEffort = "low" | "medium" | "high";

const MODEL_LABEL: Record<ComposeModel, string> = {
  "opus-4.7": "Opus 4.7",
  "sonnet-4.6": "Sonnet 4.6",
  "haiku-4.5": "Haiku 4.5",
};

const EFFORT_LABEL: Record<ComposeEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface Attachment {
  id: string;
  name: string;
  size: number;
}

export interface ComposeSendPayload {
  text: string;
  attachments: Attachment[];
  meta: { model: ComposeModel; effort: ComposeEffort; planMode: boolean };
}

export interface ComposeDockHandle {
  setDraft: (text: string) => void;
  focus: () => void;
}

export const ComposeDock = forwardRef<
  ComposeDockHandle,
  {
    onSend?: (payload: ComposeSendPayload) => void;
    placeholder?: string;
    /** B14/B17 — while a send is in flight the dock disables its
     *  primary submit and surfaces aria-busy on the textarea so AT
     *  users hear that the input is awaiting confirmation. The
     *  textarea stays editable so the user can keep refining a
     *  follow-up — only the dispatch is gated. */
    busy?: boolean;
    /** Seed value for the draft on mount. Used by per-tab draft
     *  persistence: when a tab is re-mounted (e.g. tab switch +
     *  switch back), the parent reads the saved draft from the app
     *  store and threads it in here so the textarea doesn't appear
     *  empty. Empty string is the default and matches a fresh tab. */
    initialDraft?: string;
    /** Fires on every change to the draft (typing, paste, programmatic
     *  setDraft, send-clear). Parents persist this to the app store
     *  keyed by tab id so leaving + returning preserves the in-progress
     *  text. */
    onDraftChange?: (text: string) => void;
    /** Phase 23.B — when both are present the dock pins a status row
     *  above the textarea showing the per-tab activity state.
     *  Optional so off-thread callers (smoke tests, isolated render
     *  fixtures) can mount without scaffolding the data store. */
    workspaceId?: WorkspaceId;
    tabId?: TabId | null;
  }
>(function ComposeDock(
  {
    onSend,
    placeholder,
    busy = false,
    initialDraft = "",
    onDraftChange,
    workspaceId,
    tabId,
  },
  ref,
) {
  const [draft, setDraftState] = useState(initialDraft);
  // The draft setter is wrapped so every write — keystroke, paste,
  // imperative setDraft, post-send clear — fires `onDraftChange` and
  // the parent stays in sync without each callsite having to remember.
  const setDraft = (next: string) => {
    setDraftState(next);
    onDraftChange?.(next);
  };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [model, setModel] = useState<ComposeModel>("opus-4.7");
  const [effort, setEffort] = useState<ComposeEffort>("medium");
  const [planMode, setPlanMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    setDraft: (text: string) => setDraft(text),
    focus: () => textareaRef.current?.focus(),
  }));

  useEffect(() => {
    // Autofocus whenever the caller seeds a new draft via setDraft().
    if (draft) textareaRef.current?.focus();
  }, [draft]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const added: Attachment[] = [];
    for (const f of Array.from(files)) {
      added.push({ id: crypto.randomUUID(), name: f.name, size: f.size });
    }
    if (added.length) setAttachments((a) => [...a, ...added]);
  };

  const send = () => {
    if (busy) return;
    const trimmed = draft.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend?.({
      text: trimmed,
      attachments,
      meta: { model, effort, planMode },
    });
    setDraft("");
    setAttachments([]);
  };

  return (
    <form
      className="compose"
      data-component="ComposeDock"
      data-dragging={dragging}
      data-busy={busy || undefined}
      aria-label="Send a message"
      aria-busy={busy || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {workspaceId && (
        <ComposeDockActivityRow workspaceId={workspaceId} tabId={tabId} />
      )}

      {attachments.length > 0 && (
        <ul className="compose__attach-list" aria-label="Attachments">
          {attachments.map((a) => (
            <li key={a.id} className="compose__chip">
              <span className="compose__chip-name">{a.name}</span>
              <IconButton
                size="sm"
                label={`Remove ${a.name}`}
                onClick={() =>
                  setAttachments((list) => list.filter((x) => x.id !== a.id))
                }
              >
                <IconX />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div className="compose__body">
        <textarea
          ref={textareaRef}
          className="compose__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            dragging
              ? "Drop files to attach…"
              : placeholder ?? "Say something to the team…"
          }
          rows={3}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline. ⌘/Ctrl+Enter
            // is preserved as an alias so the muscle memory shown in
            // the help dialog still works.
            if (e.key !== "Enter") return;
            if (e.shiftKey) return;
            // Don't intercept the IME composition's confirmation Enter.
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            send();
          }}
          aria-label="Message"
        />
      </div>

      <div className="compose__footer">
        <div className="compose__footer-left">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <ComposeSelect
            label="Model"
            value={model}
            options={MODEL_LABEL}
            onChange={(v) => setModel(v as ComposeModel)}
          />
          <ComposeSelect
            label="Effort"
            value={effort}
            options={EFFORT_LABEL}
            onChange={(v) => setEffort(v as ComposeEffort)}
          />
          <Tooltip label="Plan mode — propose before acting">
            <button
              type="button"
              className="compose__toggle"
              aria-pressed={planMode}
              onClick={() => setPlanMode((p) => !p)}
            >
              <IconPlanMode />
              <span>Plan mode</span>
            </button>
          </Tooltip>
        </div>
        <div className="compose__actions">
          <IconButton
            label="Attach file"
            onClick={() => fileInputRef.current?.click()}
          >
            <IconAttach />
          </IconButton>
          <IconButton label="Dictation — coming soon" disabled>
            <IconMic />
          </IconButton>
          <IconButton
            type="submit"
            label={busy ? "Sending…" : "Send"}
            shortcut="↵"
            className="btn-icon--primary"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            <IconSend />
          </IconButton>
        </div>
      </div>
    </form>
  );
});

function ComposeSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="compose__select">
      <span className="compose__select-label">{label}</span>
      <span className="compose__select-value">{options[value]}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {Object.keys(options).map((k) => (
          <option key={k} value={k}>
            {options[k as T]}
          </option>
        ))}
      </select>
      <IconChevron />
    </label>
  );
}

function IconAttach() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3.5L5 8.5a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2L2.7 6.5a4.5 4.5 0 0 0 6.4 6.4l4.4-4.4" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="1.5" width="4" height="7" rx="2" />
      <path d="M2.5 6.5a4.5 4.5 0 0 0 9 0" />
      <path d="M7 11v1.5" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 11V3" />
      <path d="M3.5 6.5L7 3l3.5 3.5" />
    </svg>
  );
}

function IconPlanMode() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="8" height="8" rx="1.25" />
      <path d="M4 5h4" />
      <path d="M4 7h2.5" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      className="compose__select-chevron"
    >
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  );
}
