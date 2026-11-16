import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { PermissionMode, ThreadMeta, Workspace } from '@designer/shared';
import { store, useStore, type Item } from './store';
import { Markdown } from './markdown';
import { useStick } from './useStick';
import { Preview } from './Preview';
import { MIN_CHAT, clampChat, useLayout } from './layout';

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
  const workspaces = useStore((s) => s.workspaces);
  const threads = useStore((s) => s.threads);
  const activeWs = useStore((s) => s.threads.find((t) => t.id === s.activeId)?.workspaceId);
  const defaultCwd = useStore((s) => s.defaultCwd);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  useEffect(() => setPath((c) => c || defaultCwd), [defaultCwd]);
  const submit = () => {
    if (!path.trim()) return;
    store.addFolder(path.trim());
    setAdding(false);
  };
  // group by repo: the main folder first, then its worktrees
  const projects = useMemo(() => {
    const by = new Map<string, Workspace[]>();
    for (const w of workspaces) by.set(w.repoPath ?? w.path, [...(by.get(w.repoPath ?? w.path) ?? []), w]);
    return [...by].map(([key, list]) => ({ key, list: list.sort((a, b) => (a.kind === 'folder' ? -1 : 0) - (b.kind === 'folder' ? -1 : 0) || a.createdAt - b.createdAt) }));
  }, [workspaces]);
  const running = (wid: string) => threads.some((t) => t.workspaceId === wid && !t.archived && t.status === 'running');
  const firstSession = (wid: string) => threads.find((t) => t.workspaceId === wid && !t.archived);
  return (
    <aside className="sidebar">
      <button className="new" onClick={() => setAdding((a) => !a)}>Add folder</button>
      {adding && (
        <div className="newform">
          <label>
            Folder path
            <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus spellCheck={false} />
          </label>
          <button onClick={submit}>Add</button>
        </div>
      )}
      <nav className="projects" aria-label="Workspaces">
        {projects.map((p) => (
          <Project key={p.key} name={p.key.split('/').filter(Boolean).slice(-1)[0] ?? p.key} list={p.list} activeWs={activeWs} running={running} onOpen={(wid) => { const t = firstSession(wid); t ? store.open(t.id) : store.newSession(wid); }} />
        ))}
        {!projects.length && <p className="empty-side">Add a folder to start.</p>}
      </nav>
    </aside>
  );
}

function Project({ name, list, activeWs, running, onOpen }: { name: string; list: Workspace[]; activeWs?: string; running: (id: string) => boolean; onOpen: (id: string) => void }) {
  const [making, setMaking] = useState(false);
  const [wt, setWt] = useState('');
  const base = list.find((w) => w.kind === 'folder') ?? list[0];
  const create = () => {
    if (!wt.trim()) return;
    store.createWorktree(base.id, wt.trim());
    setMaking(false);
    setWt('');
  };
  return (
    <section className="project">
      <div className="project-head">
        <span className="project-name">{name}</span>
        <button className="icon" title="New worktree" aria-label={`New worktree in ${name}`} onClick={() => setMaking(!making)}>⎇ +</button>
      </div>
      {making && (
        <div className="newform">
          <input value={wt} placeholder="worktree name" onChange={(e) => setWt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus spellCheck={false} aria-label="Worktree name" />
        </div>
      )}
      {list.map((w) => (
        <div key={w.id} className={`ws${w.id === activeWs ? ' active' : ''}`}>
          <button className="ws-main" onClick={() => onOpen(w.id)} aria-current={w.id === activeWs}>
            <span className="ws-name">{w.kind === 'folder' ? 'Main folder' : w.name}</span>
            {w.branch && <span className="ws-branch">{w.branch}</span>}
            {running(w.id) && <span className="dot" aria-label="running" />}
          </button>
          <button className="icon x" title={w.kind === 'worktree' ? 'Remove worktree (only if it has no uncommitted changes)' : 'Forget folder (files are not deleted)'} aria-label={`Remove ${w.name}`} onClick={() => store.removeWorkspace(w.id)}>✕</button>
        </div>
      ))}
    </section>
  );
}

function Tabs({ thread }: { thread: ThreadMeta }) {
  const tabs = useStore((s) => s.threads.filter((t) => t.workspaceId === thread.workspaceId && !t.archived).sort((a, b) => a.createdAt - b.createdAt));
  return (
    <div className="tabs" role="tablist" aria-label="Sessions">
      {tabs.map((t) => (
        <div key={t.id} className={`tab${t.id === thread.id ? ' active' : ''}`} role="presentation">
          <button role="tab" aria-selected={t.id === thread.id} className="tab-main" onClick={() => store.open(t.id)}>
            {t.status === 'running' && <span className="dot" aria-label="running" />}
            <span className="tab-title">{t.title}</span>
          </button>
          <button className="icon x" aria-label={`Close ${t.title}`} onClick={() => store.closeSession(t.id)}>✕</button>
        </div>
      ))}
      <button className="icon" aria-label="New session" title="New session" onClick={() => store.newSession(thread.workspaceId)}>+</button>
    </div>
  );
}

function Main() {
  const activeId = useStore((s) => s.activeId);
  const thread = useStore((s) => s.threads.find((t) => t.id === s.activeId));
  const notice = useStore((s) => s.notice);
  const [layout, setLayout] = useLayout();
  const panes = useRef<HTMLDivElement>(null);
  if (!activeId || !thread) {
    return (
      <main className="main empty">
        <p>Add a folder, then pick a workspace.</p>
      </main>
    );
  }
  const drag = (e: RPointerEvent<HTMLDivElement>) => {
    const box = panes.current?.getBoundingClientRect();
    if (!box || !(e.buttons & 1)) return;
    const w = layout.side === 'right' ? e.clientX - box.left : box.right - e.clientX;
    setLayout({ chatW: clampChat(w, box.width) });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const box = panes.current?.getBoundingClientRect();
    if (!box || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const dir = (e.key === 'ArrowRight' ? 1 : -1) * (layout.side === 'right' ? 1 : -1);
    setLayout({ chatW: clampChat(layout.chatW + dir * 24, box.width) });
  };
  return (
    <main className="main">
      <header className="top">
        <span className="top-cwd">{thread.cwd}</span>
        <span className="top-actions">
          {layout.open && (
            <button className="icon" onClick={() => setLayout({ side: layout.side === 'right' ? 'left' : 'right' })} aria-label="Swap chat and preview" title="Swap sides">⇄</button>
          )}
          <button className={`icon${layout.open ? ' on' : ''}`} onClick={() => setLayout({ open: !layout.open })} aria-pressed={layout.open} aria-label="Preview" title="Show or hide the preview">Preview</button>
        </span>
      </header>
      {notice && <div className="notice" role="alert" onClick={() => store.open(activeId)}>{notice}</div>}
      <div className={`panes ${layout.side}`} ref={panes} style={{ ['--chat-w' as string]: `${layout.chatW}px` }}>
        <section className={`chat-col${layout.open ? '' : ' solo'}`}>
          <Tabs thread={thread} />
          <Chat key={activeId} thread={thread} />
        </section>
        {layout.open && (
          <>
            <div
              className="sep"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat and preview"
              aria-valuemin={MIN_CHAT}
              aria-valuenow={layout.chatW}
              tabIndex={0}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={drag}
              onKeyDown={key}
            />
            <section className="preview-col">
              <Preview workspaceId={thread.workspaceId} threadId={thread.id} onClose={() => setLayout({ open: false })} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function QuoteButton({ threadId }: { threadId: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sel = window.getSelection();
        const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
        if (!sel || sel.isCollapsed || !sel.toString().trim() || !node?.closest('.msg.assistant')) return setPos(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        setPos({ x: Math.max(8, r.left), y: Math.max(8, r.top - 38) });
      });
    };
    document.addEventListener('selectionchange', check);
    return () => {
      document.removeEventListener('selectionchange', check);
      cancelAnimationFrame(raf);
    };
  }, []);
  if (!pos) return null;
  return (
    <button
      className="quote-btn"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()} // keep the selection until we read it
      onClick={() => {
        const text = window.getSelection()?.toString().trim();
        if (text) store.quote(threadId, text);
        window.getSelection()?.removeAllRanges();
        setPos(null);
      }}
    >
      Quote
    </button>
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
      <QuoteButton threadId={thread.id} />
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
