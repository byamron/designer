import { useEffect, useMemo, useState } from 'react';
import type { Workspace } from '@designer/shared';
import { store, useStore } from './store';

export function Sidebar() {
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

export function Project({ name, list, activeWs, running, onOpen }: { name: string; list: Workspace[]; activeWs?: string; running: (id: string) => boolean; onOpen: (id: string) => void }) {
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
