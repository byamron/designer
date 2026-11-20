import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { PermissionMode, ThreadMeta } from '@designer/shared';
import { store, useStore } from './store';
import type { Queued } from './store';
import { ACCEPT, filesOf, readFiles, uploads } from './imageFiles';
import type { Draft } from './imageFiles';
import { DraftThumbs, discard } from './Attachments';

export const MODES: [PermissionMode, string][] = [
  ['default', 'Ask before edits & commands'],
  ['auto', 'Auto: Claude decides, asks when unsure'],
  ['acceptEdits', 'Auto-accept edits'],
  ['bypassPermissions', 'Full access (no prompts)'],
];

export function Composer({ thread, queue }: { thread: ThreadMeta; queue: Queued[] }) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [problem, setProblem] = useState('');
  const [over, setOver] = useState(false);
  const live = useRef<Draft[]>([]);
  live.current = drafts;
  useEffect(() => () => discard(live.current), []); // free the previews when this composer goes away
  const file = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = thread.status === 'running';
  useEffect(() => ta.current?.focus(), [thread.id]);
  const quote = useStore((s) => s.quote);
  useEffect(() => {
    if (!quote || quote.threadId !== thread.id) return;
    const block = quote.text.split('\n').map((l) => `> ${l}`).join('\n');
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n\n` : '') + block + '\n\n');
    store.clearQuote();
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [quote, thread.id]);
  const prefill = useStore((s) => s.prefill);
  useEffect(() => {
    if (!prefill || prefill.threadId !== thread.id) return;
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n\n` : '') + prefill.text);
    store.clearPrefill();
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [prefill, thread.id]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);
  const add = async (files: File[]) => {
    if (!files.length) return;
    const { drafts: added, refused } = await readFiles(files, live.current.length);
    setProblem(refused.join(' '));
    if (added.length) setDrafts((d) => [...d, ...added]);
  };
  const remove = (key: string) => {
    discard(drafts.filter((d) => d.key === key));
    setDrafts((d) => d.filter((x) => x.key !== key));
    setProblem('');
    ta.current?.focus();
  };
  const canSend = !!text.trim() || drafts.length > 0;
  const submit = () => {
    if (!canSend) return;
    store.say(thread.id, text, uploads(drafts));
    discard(drafts);
    setDrafts([]);
    setProblem('');
    setText('');
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesOf(e.clipboardData);
    if (!files.length) return; // plain text pastes as usual
    e.preventDefault();
    void add(files);
  };
  const onDrop = (e: DragEvent) => {
    setOver(false);
    const files = filesOf(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    void add(files);
  };
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && running) store.interrupt(thread.id);
  };
  return (
    <div className="composer">
      {queue.map((q, i) => (
        <div className="queued" key={i}>
          <span>Queued: {q.text.trim() || 'images'}{q.images.length ? ` · ${q.images.length} image${q.images.length === 1 ? '' : 's'}` : ''}</span>
          <button onClick={() => store.dropQueued(thread.id, i)} aria-label="Remove queued message">✕</button>
        </div>
      ))}
      <DraftThumbs drafts={drafts} onRemove={remove} />
      {problem && <div className="attach-problem" role="alert">{problem}</div>}
      <div
        className={`box${over ? ' dropping' : ''}`}
        data-ring-parent
        onDragEnter={(e) => hasFiles(e) && (e.preventDefault(), setOver(true))}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
        onDrop={onDrop}
      >
        <input ref={file} type="file" accept={ACCEPT} multiple hidden tabIndex={-1} data-testid="attach-input" onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button className="attach" onClick={() => file.current?.click()} aria-label="Attach images" title="Attach images">+</button>
        <textarea ref={ta} rows={1} value={text} placeholder={running ? 'Type to queue a follow-up…' : 'Message Claude…'} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} aria-label="Message" />
        {running ? (
          <button className="stop" onClick={() => store.interrupt(thread.id)} aria-label="Stop (Esc)">■ Stop</button>
        ) : (
          <button className="send" onClick={submit} disabled={!canSend}>Send</button>
        )}
      </div>
      <div className="opts">
        <select value={thread.permissionMode ?? 'default'} onChange={(e) => store.setMode(thread.id, e.target.value as PermissionMode)} aria-label="Permissions">
          {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}
