import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PermissionMode, ThreadMeta } from '@designer/shared';
import { store, useStore } from './store';

export const MODES: [PermissionMode, string][] = [
  ['default', 'Ask before edits & commands'],
  ['auto', 'Auto: Claude decides, asks when unsure'],
  ['acceptEdits', 'Auto-accept edits'],
  ['bypassPermissions', 'Full access (no prompts)'],
];

export function Composer({ thread, queue }: { thread: ThreadMeta; queue: string[] }) {
  const [text, setText] = useState('');
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
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);
  const submit = () => {
    if (!text.trim()) return;
    store.say(thread.id, text);
    setText('');
  };
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
          <span>Queued: {q}</span>
          <button onClick={() => store.dropQueued(thread.id, i)} aria-label="Remove queued message">✕</button>
        </div>
      ))}
      <div className="box" data-ring-parent>
        <textarea ref={ta} rows={1} value={text} placeholder={running ? 'Type to queue a follow-up…' : 'Message Claude…'} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Message" />
        {running ? (
          <button className="stop" onClick={() => store.interrupt(thread.id)} aria-label="Stop (Esc)">■ Stop</button>
        ) : (
          <button className="send" onClick={submit} disabled={!text.trim()}>Send</button>
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
