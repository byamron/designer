import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';

type Probe = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'blocked' | 'unreachable'; reason: string };
const isUrl = (s: string) => /^https?:\/\//i.test(s);

export function Preview({ workspaceId, threadId, onClose }: { workspaceId: string; threadId: string; onClose: () => void }) {
  const previewPort = useStore((s) => s.previewPort);
  const turns = useStore((s) => s.views[threadId]?.turns ?? 0);
  const key = `designer.preview.${workspaceId}`;
  const [target, setTarget] = useState(() => {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  });
  const [draft, setDraft] = useState(target);
  const [files, setFiles] = useState<string[]>([]);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);

  // switching workspace restores that workspace's last preview
  useEffect(() => {
    let t = '';
    try { t = localStorage.getItem(key) ?? ''; } catch { /* ignore */ }
    setTarget(t);
    setDraft(t);
  }, [key]);

  useEffect(() => {
    let live = true;
    fetch(`/api/html?workspace=${encodeURIComponent(workspaceId)}`).then((r) => r.json()).then((f) => live && setFiles(f)).catch(() => {});
    return () => { live = false; };
  }, [workspaceId, turns]); // new files may appear after the agent finishes a turn

  const external = isUrl(target);
  const src = useMemo(() => {
    if (!target) return '';
    if (external) return target;
    if (!previewPort) return '';
    return `${location.protocol}//${location.hostname}:${previewPort}/${workspaceId}/${target.split('/').map(encodeURIComponent).join('/')}`;
  }, [target, external, previewPort, workspaceId]);

  // Pages the agent just edited are served from disk: refresh when it finishes a turn.
  useEffect(() => {
    if (turns > 0 && target && !external) setReload((n) => n + 1);
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!external) return setProbe({ state: 'idle' });
    let live = true;
    setProbe({ state: 'checking' });
    fetch(`/api/probe?url=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((p: { ok: boolean; framable: boolean; reason?: string }) => {
        if (!live) return;
        if (!p.ok) setProbe({ state: 'unreachable', reason: p.reason ?? 'Cannot reach this page.' });
        else if (!p.framable) setProbe({ state: 'blocked', reason: p.reason ?? 'This page cannot be shown here.' });
        else setProbe({ state: 'ok' });
      })
      .catch(() => live && setProbe({ state: 'unreachable', reason: 'Could not check this page.' }));
    return () => { live = false; };
  }, [target, external, reload]);

  useEffect(() => setLoading(!!src), [src, reload]); // a new document is loading until the iframe says otherwise

  const go = (v: string) => {
    const t = v.trim();
    setTarget(t);
    setDraft(t);
    setReload((n) => n + 1);
    try { localStorage.setItem(key, t); } catch { /* ignore */ }
  };

  return (
    <div className="preview">
      <div className="preview-bar">
        <input
          list="html-files"
          value={draft}
          placeholder="URL, localhost:3000, or an HTML file in this workspace"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go(/^(localhost|127\.0\.0\.1)(:|\/|$)/.test(draft.trim()) ? `http://${draft.trim()}` : draft)}
          spellCheck={false}
          aria-label="Preview address"
        />
        <datalist id="html-files">{files.map((f) => <option key={f} value={f} />)}</datalist>
        <button className="icon" onClick={() => setReload((n) => n + 1)} disabled={!target} aria-label="Reload preview" title="Reload">↻</button>
        {src && <a className="icon" href={src} target="_blank" rel="noreferrer noopener" aria-label="Open in new tab" title="Open in new tab">↗</a>}
        <button className="icon" onClick={onClose} aria-label="Close preview" title="Close preview">✕</button>
      </div>
      <div className="preview-body">
        {loading && (probe.state === 'ok' || !external) && <div className="loadbar" role="progressbar" aria-label="Loading preview" />}
        {!target && (
          <div className="preview-empty">
            <p>Show a page next to the chat.</p>
            {files.length > 0 && (
              <ul>
                {files.slice(0, 8).map((f) => (
                  <li key={f}><button onClick={() => go(f)}>{f}</button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        {target && probe.state === 'checking' && <div className="preview-empty">Checking {target}…</div>}
        {target && (probe.state === 'blocked' || probe.state === 'unreachable') && (
          <div className="preview-empty" role="status">
            <p>{probe.reason}</p>
            {probe.state === 'blocked' && <p className="muted">Open it in a new tab for now. The desktop app will be able to show it here.</p>}
            <a href={target} target="_blank" rel="noreferrer noopener">Open in new tab ↗</a>
          </div>
        )}
        {src && (!external || probe.state === 'ok') && (
          <iframe key={`${src}|${reload}`} src={src} title="Preview" onLoad={() => setLoading(false)} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" />
        )}
      </div>
    </div>
  );
}
