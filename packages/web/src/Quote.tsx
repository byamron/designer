import { useEffect, useState } from 'react';
import { store } from './store';

export function QuoteButton({ threadId }: { threadId: string }) {
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
