import { useRef, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { store, useStore } from './store';
import { Preview } from './Preview';
import { MIN_CHAT, clampChat, useLayout } from './layout';
import { Tabs } from './Tabs';
import { Chat } from './Chat';
import { InspectorPanel } from './inspector/Panel';
import { useInspector } from './inspector/bridge';

export function Main() {
  const activeId = useStore((s) => s.activeId);
  const thread = useStore((s) => s.threads.find((t) => t.id === s.activeId));
  const notice = useStore((s) => s.notice);
  const [layout, setLayout] = useLayout();
  const inspecting = useInspector((s) => s.on);
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
      <div className={`panes ${layout.side}${layout.open && inspecting ? ' inspecting' : ''}`} ref={panes} style={{ ['--chat-w' as string]: `${layout.chatW}px` }}>
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
            {inspecting && <InspectorPanel workspaceId={thread.workspaceId} threadId={thread.id} />}
          </>
        )}
      </div>
    </main>
  );
}
