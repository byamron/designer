// Everything the preview pane needs from the inspector, kept out of Preview.tsx: the Inspect toggle, showing URL
// targets through Designer's proxy, attaching to the iframe, and holding the auto-reload while edits are pending.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../auth';
import { inspector, useChangeCount, useInspector } from './bridge';

interface Args {
  target: string;
  external: boolean;
  /** Probe state of an external page: 'unreachable' disables inspecting. */
  probe: string;
  /** The address Preview would show without the inspector. */
  src: string;
  turns: number;
  reload: () => void;
}

const originOf = (src: string) => {
  try {
    return new URL(src).origin;
  } catch {
    return '';
  }
};

export function usePreviewInspect({ target, external, probe, src, turns, reload }: Args) {
  const on = useInspector((s) => s.on);
  const pending = useChangeCount();
  const frame = useRef<HTMLIFrameElement>(null);
  const [proxied, setProxied] = useState<{ url: string; src: string } | null>(null);
  const [error, setError] = useState('');
  const [held, setHeld] = useState(false);
  const seenTurns = useRef(turns);

  useEffect(() => inspector.setTarget(target), [target]);

  // a different page: forget the proxied address and any selection
  useEffect(() => {
    setProxied(null);
    setError('');
    setHeld(false);
    inspector.detach();
  }, [target]);
  useEffect(() => () => { inspector.setOn(false); inspector.detach(); }, []);

  // URL targets are only inspectable through the proxy (it adds the page agent)
  useEffect(() => {
    if (!on || !external || proxied?.url === target) return;
    let live = true;
    api(`/api/proxy?url=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((p: { port?: number; path?: string; error?: string }) => {
        if (!live) return;
        if (p.port === undefined) throw new Error(p.error ?? 'The proxy could not open this page.');
        setProxied({ url: target, src: `http://localhost:${p.port}${p.path ?? '/'}` });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : 'The proxy could not open this page.');
        inspector.setOn(false);
      });
    return () => { live = false; };
  }, [on, external, target, proxied]);

  // Pages we serve reload when the agent finishes a turn, unless that would throw away visual edits.
  useEffect(() => {
    if (turns === seenTurns.current) return;
    seenTurns.current = turns;
    if (turns > 0 && target && !external) {
      if (pending > 0) setHeld(true);
      else reload();
    }
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // once a URL target went through the proxy it stays there (switching back would reload the page)
  const viaProxy = external && proxied?.url === target;
  const inspectable = !external || viaProxy;

  const reason = !target ? 'Open a page to inspect it' : external && probe === 'unreachable' ? 'This page cannot be reached' : '';

  const toggle = useCallback(() => {
    setError('');
    inspector.setOn(!inspector.state.on);
  }, []);

  const onLoad = useCallback(() => {
    const win = frame.current?.contentWindow ?? null;
    const origin = originOf(frame.current?.src ?? '');
    if (win && origin && inspectable) inspector.attach(win, origin);
  }, [inspectable]);

  const reloadAnyway = () => {
    setHeld(false);
    reload();
  };
  // any reload (the user's, or ours) starts a fresh document
  useEffect(() => { if (pending === 0) setHeld(false); }, [pending]);

  return {
    on,
    pending,
    frame: frame as RefObject<HTMLIFrameElement>,
    /** The address to put in the iframe (differs from `src` when showing a page through the proxy). */
    src: viaProxy ? proxied!.src : external && on ? '' : src,
    /** An external page is shown through the proxy. */
    proxied: viaProxy,
    waitingForProxy: external && on && !viaProxy && !error,
    error,
    reason,
    held: held && pending > 0,
    toggle,
    onLoad,
    reloadAnyway,
  };
}

export function InspectToggle({ on, reason, onClick }: { on: boolean; reason: string; onClick: () => void }) {
  return (
    <button className={`icon${on ? ' on' : ''}`} onClick={onClick} disabled={!!reason} aria-pressed={on} aria-label="Inspect" title={reason || 'Select elements and edit how they look'}>
      Inspect
    </button>
  );
}
