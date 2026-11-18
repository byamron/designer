import type { ThreadMeta } from '@designer/shared';
import { store, useStore } from './store';

export function Tabs({ thread }: { thread: ThreadMeta }) {
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
