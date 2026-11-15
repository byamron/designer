import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PermissionMode, ThreadMeta } from '@designer/shared';
import { store, useStore, type Item } from './store';
import { Markdown } from './markdown';
import { useStick } from './useStick';

export function App() {
  const connected = useStore((s) => s.connected);
  return (
    <div className="app">
      <Sidebar />
      <Main />
      {!connected && <div className="conn">Reconnecting…</div>}
    </div>
  );
}

function Sidebar() {
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeId);
  const defaultCwd = useStore((s) => s.defaultCwd);
  const [adding, setAdding] = useState(false);
  const [cwd, setCwd] = useState('');
  useEffect(() => setCwd((c) => c || defaultCwd), [defaultCwd]);
  const submit = () => {
    if (!cwd.trim()) return;
    store.createThread(cwd.trim());
    setAdding(false);
  };
  return (
    <aside className="sidebar">
      <button className="new" onClick={() => setAdding((a) => !a)}>New chat</button>
      {adding && (
        <div className="newform">
          <label>
            Folder
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus spellCheck={false} />
          </label>
          <button onClick={submit}>Start</button>
        </div>
      )}
      <nav className="threads" aria-label="Chats">
        {threads.map((t) => (
          <ThreadRow key={t.id} t={t} active={t.id === activeId} />
        ))}
        {!threads.length && <p className="empty-side">No chats yet.</p>}
      </nav>
    </aside>
  );
}

const ThreadRow = memo(function ThreadRow({ t, active }: { t: ThreadMeta; active: boolean }) {
  return (
    <button className={`thread${active ? ' active' : ''}`} onClick={() => store.open(t.id)} aria-current={active}>
      <span className="thread-title">{t.title}</span>
      <span className="thread-sub">
        {t.status === 'running' && <span className="dot" aria-label="running" />}
        {t.cwd.split('/').filter(Boolean).slice(-1)[0] ?? t.cwd}
      </span>
    </button>
  );
});

function Main() {
  const activeId = useStore((s) => s.activeId);
  const thread = useStore((s) => s.threads.find((t) => t.id === s.activeId));
  const notice = useStore((s) => s.notice);
  if (!activeId || !thread) {
    return (
      <main className="main empty">
        <p>Pick a chat or start a new one.</p>
      </main>
    );
  }
  return (
    <main className="main">
      <header className="top">
        <span className="top-title">{thread.title}</span>
        <span className="top-cwd">{thread.cwd}</span>
      </header>
      {notice && <div className="notice" role="alert" onClick={() => store.open(activeId)}>{notice}</div>}
      <Chat key={activeId} thread={thread} />
    </main>
  );
}

function Chat({ thread }: { thread: ThreadMeta }) {
  const view = useStore((s) => s.views[thread.id]);
  const items = view?.items ?? [];
  const { scroller, content, detached, toBottom } = useStick(thread.id);
  const groups = useMemo(() => group(items), [items]);
  return (
    <>
      <div className="scroller" ref={scroller} tabIndex={0} aria-label="Conversation" role="log">
        <div className="content" ref={content}>
          {view?.loaded && !items.length && <p className="hint">Send a message to start.</p>}
          {groups.map((g) =>
            g.type === 'tools' ? <ToolGroup key={g.key} tools={g.items} threadId={thread.id} /> : <Row key={g.key} item={g.item} threadId={thread.id} />,
          )}
          {thread.status === 'running' && <div className="working" aria-live="polite">Working…</div>}
        </div>
        {detached && (
          <button className="jump" onClick={toBottom}>
            Jump to latest ↓
          </button>
        )}
      </div>
      <Composer thread={thread} queue={view?.queue ?? []} />
    </>
  );
}

type ToolItem = Extract<Item, { kind: 'tool' }>;
type Group = { type: 'tools'; key: string; items: ToolItem[] } | { type: 'row'; key: string; item: Item };

/** Consecutive tool calls collapse into one run. Approvals stay as their own rows. */
function group(items: Item[]): Group[] {
  const out: Group[] = [];
  for (const it of items) {
    if (it.kind === 'tool') {
      const last = out.at(-1);
      if (last?.type === 'tools') last.items.push(it);
      else out.push({ type: 'tools', key: `g-${it.id}`, items: [it] });
    } else if (it.kind === 'done') {
      continue;
    } else out.push({ type: 'row', key: `${it.kind}-${it.id}`, item: it });
  }
  return out;
}

const Row = memo(function Row({ item, threadId }: { item: Item; threadId: string }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg user"><div className="bubble">{item.text}</div></div>;
    case 'assistant':
      return (
        <div className={`msg assistant${item.streaming ? '' : ' settled'}`}>
          <Markdown text={item.text} />
        </div>
      );
    case 'approval':
      return <Approval item={item} threadId={threadId} />;
    case 'error':
      return <div className="msg err" role="alert">{item.message}</div>;
    default:
      return null;
  }
});

function Approval({ item, threadId }: { item: Extract<Item, { kind: 'approval' }>; threadId: string }) {
  return (
    <div className={`approval${item.resolved ? ' resolved' : ''}`} role="group" aria-label="Permission request">
      <div className="approval-q">
        <strong>{item.toolName}</strong> <code>{item.label}</code>
      </div>
      {item.resolved ? (
        <span className="approval-res">{item.resolved === 'allow' ? 'Allowed' : 'Denied'}</span>
      ) : (
        <div className="approval-btns">
          <button className="primary" onClick={() => store.respond(threadId, item.id, 'allow')}>Allow</button>
          <button onClick={() => store.respond(threadId, item.id, 'deny')}>Deny</button>
        </div>
      )}
    </div>
  );
}

const VERB: Record<string, [string, string, string]> = {
  read: ['Read', 'file', 'files'], command: ['Ran', 'command', 'commands'], file_change: ['Edited', 'file', 'files'],
  search: ['Searched', 'time', 'times'], other: ['Used', 'tool', 'tools'],
};
function summarize(tools: ToolItem[]) {
  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.toolKind, (counts.get(t.toolKind) ?? 0) + 1);
  return [...counts].map(([k, n]) => {
    const [verb, one, many] = VERB[k] ?? VERB.other;
    return `${verb} ${n} ${n === 1 ? one : many}`;
  }).join(', ');
}

const ToolGroup = memo(function ToolGroup({ tools }: { tools: ToolItem[]; threadId: string }) {
  const live = tools.some((t) => t.status === 'running');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const expanded = open ?? live; // open while live, collapsed once done unless the user chose
  const failed = tools.some((t) => t.status === 'error');
  return (
    <div className={`tools${live ? ' live' : ''}`}>
      <button className="tools-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span className="chev">{expanded ? '▾' : '▸'}</span>
        <span>{summarize(tools)}</span>
        {live && <span className="dot" aria-label="running" />}
        {failed && !live && <span className="fail">failed</span>}
      </button>
      {expanded && (
        <ul>
          {tools.map((t) => <ToolLine key={t.id} t={t} />)}
        </ul>
      )}
    </div>
  );
});

function ToolLine({ t }: { t: ToolItem }) {
  const [show, setShow] = useState(false);
  return (
    <li className={`tool ${t.status}`}>
      <button className="tool-line" onClick={() => t.output && setShow(!show)} disabled={!t.output}>
        <span className="tool-name">{t.name}</span>
        <span className="tool-label">{t.label}</span>
        <span className="tool-status">{t.status === 'running' ? '…' : t.status === 'error' ? '✕' : '✓'}</span>
      </button>
      {show && t.output && <pre className="tool-out">{t.output}</pre>}
    </li>
  );
}

const MODES: [PermissionMode, string][] = [['default', 'Ask before edits & commands'], ['acceptEdits', 'Auto-accept edits'], ['bypassPermissions', 'Full access (no prompts)']];

function Composer({ thread, queue }: { thread: ThreadMeta; queue: string[] }) {
  const [text, setText] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = thread.status === 'running';
  useEffect(() => ta.current?.focus(), [thread.id]);
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
      <div className="box">
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
