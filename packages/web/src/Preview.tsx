import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from './store';
import { isLocalUrl } from './localUrls';
import { api } from './auth';
import { InspectToggle, usePreviewInspect } from './inspector/usePreviewInspect';

type Probe = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'blocked' | 'unreachable'; reason: string };
const isUrl = (s: string) => /^https?:\/\//i.test(s);
export const START_PROMPT = "Start this project's dev server in the background (if it is not already running) and give me the URL.";
export const restartPrompt = (url: string) => `The preview at ${url} is not responding. Please restart it and give me the URL.`;
const REACH: Record<string, string> = { checking: 'Checking…', ok: 'Reachable', blocked: 'Reachable, but it cannot be shown here', unreachable: 'Not responding' };

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
  const [recheck, setRecheck] = useState(0);
  const probed = useRef('');
  const lastCheck = useRef(0);

  // switching workspace restores that workspace's last preview
  useEffect(() => {
    let t = '';
    try { t = localStorage.getItem(key) ?? ''; } catch { /* ignore */ }
    setTarget(t);
    setDraft(t);
  }, [key]);

  useEffect(() => {
    let live = true;
    api(`/api/html?workspace=${encodeURIComponent(workspaceId)}`).then((r) => r.json()).then((f) => live && setFiles(f)).catch(() => {});
    return () => { live = false; };
  }, [workspaceId, turns]); // new files may appear after the agent finishes a turn

  const external = isUrl(target);
  const src = useMemo(() => {
    if (!target) return '';
    if (external) return target;
    if (!previewPort) return '';
    return `${location.protocol}//${location.hostname}:${previewPort}/${workspaceId}/${target.split('/').map(encodeURIComponent).join('/')}`;
  }, [target, external, previewPort, workspaceId]);

  // Pages the agent just edited are served from disk: refresh when it finishes a turn (unless visual edits are pending).
  const insp = usePreviewInspect({ target, external, probe: probe.state, src, turns, reload: () => setReload((n) => n + 1) });

  useEffect(() => {
    if (!external) {
      probed.current = '';
      return setProbe({ state: 'idle' });
    }
    let live = true;
    const sig = `${target}|${reload}`;
    // a recheck of the same page runs quietly so a working iframe is never unmounted by it
    if (probed.current !== sig) setProbe({ state: 'checking' });
    probed.current = sig;
    lastCheck.current = Date.now();
    api(`/api/probe?url=${encodeURIComponent(target)}&parent=${encodeURIComponent(location.origin)}`)
      .then((r) => r.json())
      .then((p: { ok: boolean; framable: boolean; reason?: string }) => {
        if (!live) return;
        if (!p.ok) setProbe({ state: 'unreachable', reason: p.reason ?? 'Cannot reach this page.' });
        else if (!p.framable) setProbe({ state: 'blocked', reason: p.reason ?? 'This page cannot be shown here.' });
        else setProbe({ state: 'ok' });
      })
      .catch(() => live && setProbe({ state: 'unreachable', reason: 'Could not check this page.' }));
    return () => { live = false; };
  }, [target, external, reload, recheck]);

  useEffect(() => setLoading(!!insp.src), [insp.src, reload]); // a new document is loading until the iframe says otherwise

  const go = (v: string) => {
    const t = v.trim();
    setTarget(t);
    setDraft(t);
    setReload((n) => n + 1);
    try { localStorage.setItem(key, t); } catch { /* ignore */ }
  };

  // a local link or chip in the chat asks us to show a URL
  const req = useStore((s) => s.previewReq);
  useEffect(() => {
    if (!req || req.workspaceId !== workspaceId) return;
    go(req.url);
    store.clearPreviewReq(req.n);
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  // focusing the pane re-checks that the server is still there (at most every couple of seconds)
  const onFocus = () => {
    if (external && Date.now() - lastCheck.current > 2000) setRecheck((n) => n + 1);
  };

  return (
    <div className="preview" onFocus={onFocus}>
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
        <InspectToggle on={insp.on} reason={insp.reason} onClick={insp.toggle} />
        {external && probe.state !== 'idle' && (
          <span className={`reach ${probe.state}`} role="img" aria-label={REACH[probe.state]} title={REACH[probe.state]} />
        )}
        <button className="icon" onClick={() => setReload((n) => n + 1)} disabled={!target} aria-label="Reload preview" title="Reload">↻</button>
        {src && <a className="icon" href={src} target="_blank" rel="noreferrer noopener" aria-label="Open in new tab" title="Open in new tab">↗</a>}
        <button className="icon" onClick={onClose} aria-label="Close preview" title="Close preview">✕</button>
      </div>
      {insp.proxied && <p className="preview-note" role="status">Shown through Designer’s proxy so it can be inspected; some sites with logins may not work.</p>}
      {insp.error && <p className="preview-note warn" role="alert">{insp.error}</p>}
      {insp.held && (
        <p className="preview-note" role="status">
          The agent finished, but the page was not reloaded because you have {insp.pending} unsaved visual edit{insp.pending === 1 ? '' : 's'}.{' '}
          <button className="ins-link" onClick={insp.reloadAnyway}>Reload and discard edits</button>
        </p>
      )}
      <div className="preview-body">
        {loading && (probe.state === 'ok' || !external) && <div className="loadbar" role="progressbar" aria-label="Loading preview" />}
        {!target && (
          <div className="preview-empty">
            <p>Show a page next to the chat.</p>
            <button className="ask-start" onClick={() => store.prefill(threadId, START_PROMPT)}>Ask Claude to start it</button>
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
        {target && !insp.proxied && (probe.state === 'blocked' || probe.state === 'unreachable') && !insp.waitingForProxy && (
          <div className="preview-empty" role="status">
            <p>{probe.reason}</p>
            {probe.state === 'blocked' && <p className="muted">Open it in a new tab for now. The desktop app will be able to show it here.</p>}
            {probe.state === 'unreachable' && isLocalUrl(target) && (
              <button className="ask-start" onClick={() => store.prefill(threadId, restartPrompt(target))}>Ask Claude to start it</button>
            )}
            <a href={target} target="_blank" rel="noreferrer noopener">Open in new tab ↗</a>
          </div>
        )}
        {insp.src && (!external || probe.state === 'ok' || insp.proxied) && (
          <iframe key={`${insp.src}|${reload}`} ref={insp.frame} src={insp.src} title="Preview" onLoad={() => { setLoading(false); insp.onLoad(); }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" />
        )}
      </div>
    </div>
  );
}
