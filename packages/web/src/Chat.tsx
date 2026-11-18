import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadMeta } from '@designer/shared';
import { useStore } from './store';
import type { Item } from './store';
import { useStick } from './useStick';
import { fmtElapsed } from './format';
import { QuoteButton } from './Quote';
import { Row } from './Messages';
import { ToolGroup } from './Tools';
import { Composer } from './Composer';
import type { ToolItem } from './Tools';

type Group = { type: 'tools'; key: string; items: ToolItem[] } | { type: 'row'; key: string; item: Item };

export function useNow(active: boolean, every = 1000) {
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
export function phase(items: Item[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'approval' && !it.resolved) return 'Waiting for your approval';
    if (it.kind === 'tool' && it.status === 'running') return `Running ${it.name}`;
    if (it.kind === 'assistant' && it.streaming) return 'Writing';
    if (it.kind === 'user') break;
  }
  return 'Thinking';
}

export function Working({ items, since }: { items: Item[]; since?: number }) {
  const now = useNow(true);
  return (
    <div className="working" role="status">
      <span className="wave" aria-hidden="true"><i /><i /><i /></span>
      <span className="shimmer">{phase(items)}</span>
      {since && <span className="elapsed" aria-hidden="true">{fmtElapsed(now - since)}</span>}
    </div>
  );
}

export function Chat({ thread }: { thread: ThreadMeta }) {
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

export function group(items: Item[]): Group[] {
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
