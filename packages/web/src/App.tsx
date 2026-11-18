import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { PermissionMode, ThreadMeta, Workspace } from '@designer/shared';
import { store, useStore, type Item } from './store';
import { Markdown } from './markdown';
import { useStick } from './useStick';
import { Preview } from './Preview';
import { useSmoothText } from './useSmoothText';
import { fmtElapsed } from './format';
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
      <button className="new" onMouseDown={(e) => e.preventDefault()} onClick={() => setAdding((a) => !a)}>Add folder</button>
      {adding && (
        <div
          className="newform"
          // clicking away dismisses it unless you have typed something other than the suggested path
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && (!path.trim() || path === defaultCwd)) setAdding(false);
          }}
        >
          <label>
            Folder path
            <span className="field-row">
              <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? submit() : e.key === 'Escape' && setAdding(false))} autoFocus spellCheck={false} />
              <button className="icon x" aria-label="Cancel add folder" onClick={() => setAdding(false)}>✕</button>
            </span>
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
        <button className="icon" title="New worktree" aria-label={`New worktree in ${name}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setMaking(!making)}>⎇ +</button>
      </div>
      {making && (
        <div
          className="newform"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !wt.trim()) setMaking(false); // nothing typed: click away cancels
          }}
        >
          <span className="field-row">
            <input
              value={wt}
              placeholder="worktree name"
              onChange={(e) => setWt(e.target.value)}
              onKeyDown={(e) => (e.key === 'Enter' ? create() : e.key === 'Escape' && (setMaking(false), setWt('')))}
              autoFocus
              spellCheck={false}
              aria-label="Worktree name"
            />
            <button className="icon x" aria-label="Cancel new worktree" onClick={() => { setMaking(false); setWt(''); }}>✕</button>
          </span>
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

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [active, every]);
  return now;
}

/** What the agent is doing right now, from the tail of the conversation. */
function phase(items: Item[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'approval' && !it.resolved) return 'Waiting for your approval';
    if (it.kind === 'tool' && it.status === 'running') return `Running ${it.name}`;
    if (it.kind === 'assistant' && it.streaming) return 'Writing';
    if (it.kind === 'user') break;
  }
  return 'Thinking';
}

function Working({ items, since }: { items: Item[]; since?: number }) {
  const now = useNow(true);
  return (
    <div className="working" role="status">
      <span className="wave" aria-hidden="true"><i /><i /><i /></span>
      <span className="shimmer">{phase(items)}</span>
      {since && <span className="elapsed" aria-hidden="true">{fmtElapsed(now - since)}</span>}
    </div>
  );
}

function Chat({ thread }: { thread: ThreadMeta }) {
  const view = useStore((s) => s.views[thread.id]);
  const items = view?.items ?? [];
  const { scroller, content, detached, toBottom } = useStick(thread.id);
  const groups = useMemo(() => group(items), [items]);

  // Rows that appear after the history has loaded get a short entrance; replayed history does not animate.
  const fresh = useRef(new Map<string, boolean>());
  for (const g of groups) if (!fresh.current.has(g.key)) fresh.current.set(g.key, !!view?.loaded);

  // Sending a message always brings you to the bottom, even if you had scrolled up.
  const lastUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    const last = [...items].reverse().find((x) => x.kind === 'user')?.id;
    if (lastUser.current !== undefined && last && last !== lastUser.current && view?.loaded) toBottom();
    lastUser.current = last;
  }, [items, view?.loaded, toBottom]);

  return (
    <>
      <div className="scroller" ref={scroller} tabIndex={0} aria-label="Conversation" role="log">
        <div className="content" ref={content}>
          {view?.loaded && !items.length && <p className="hint">Send a message to start.</p>}
          {groups.map((g) =>
            g.type === 'tools' ? (
              <ToolGroup key={g.key} tools={g.items} fresh={fresh.current.get(g.key)} />
            ) : (
              <Row key={g.key} item={g.item} threadId={thread.id} fresh={fresh.current.get(g.key)} />
            ),
          )}
          {thread.status === 'running' && <Working items={items} since={view?.turnStart} />}
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
    } else out.push({ type: 'row', key: `${it.kind}-${it.id}`, item: it });
  }
  return out;
}

const Row = memo(function Row({ item, threadId, fresh }: { item: Item; threadId: string; fresh?: boolean }) {
  const f = fresh ? ' fresh' : '';
  switch (item.kind) {
    case 'user':
      return <div className={`msg user${f}`}><div className="bubble">{item.text}</div></div>;
    case 'assistant':
      return <Assistant item={item} fresh={f} />;
    case 'approval':
      return <Approval item={item} threadId={threadId} fresh={f} />;
    case 'error':
      return <div className={`msg err${f}`} role="alert">{item.message}</div>;
    case 'done':
      return item.ms && item.ms >= 2000 ? <div className={`turn-note${f}`}>{item.interrupted ? 'Stopped after' : 'Worked for'} {fmtElapsed(item.ms)}</div> : null;
    default:
      return null;
  }
});

function Assistant({ item, fresh }: { item: Extract<Item, { kind: 'assistant' }>; fresh: string }) {
  const text = useSmoothText(item.text, item.streaming);
  const live = item.streaming || text.length < item.text.length;
  return (
    <div className={`msg assistant${live ? ' live' : ' settled'}${fresh}`}>
      <Markdown text={text} />
    </div>
  );
}

function Approval({ item, threadId, fresh }: { item: Extract<Item, { kind: 'approval' }>; threadId: string; fresh: string }) {
  return (
    <div className={`approval${item.resolved ? ' resolved' : ''}${fresh}`} role="group" aria-label="Permission request">
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

const ToolGroup = memo(function ToolGroup({ tools, fresh }: { tools: ToolItem[]; fresh?: boolean }) {
  const live = tools.some((t) => t.status === 'running');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const expanded = open ?? live; // open while live, collapsed once done unless the user chose
  const failed = tools.some((t) => t.status === 'error');
  return (
    <div className={`tools${live ? ' live' : ''}${fresh ? ' fresh' : ''}`}>
      <button className="tools-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span className={`chev${expanded ? ' open' : ''}`} aria-hidden="true">▸</span>
        <span>{summarize(tools)}</span>
        {live && <span className="dot" aria-label="running" />}
        {failed && !live && <span className="fail">failed</span>}
      </button>
      <div className={`tools-body${expanded ? ' open' : ''}`}>
        <div className="tools-inner">
          <ul>
            {tools.map((t) => <ToolLine key={t.id} t={t} />)}
          </ul>
        </div>
      </div>
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
