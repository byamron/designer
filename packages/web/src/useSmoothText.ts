import { useEffect, useRef, useState } from 'react';

/**
 * Streamed text arrives in lumps (tens of characters every ~65 ms). Reveal it at a steady pace instead:
 * each frame shows a fraction of what is still waiting, so we never fall more than ~100 ms behind
 * and a big lump eases in rather than popping. Finished text is shown whole, immediately.
 */
export function useSmoothText(full: string, streaming: boolean): string {
  const shown = useRef(streaming ? 0 : full.length);
  const target = useRef(full.length);
  target.current = full.length;
  const [, setN] = useState(shown.current);
  const raf = useRef(0);

  useEffect(() => {
    const tick = () => {
      raf.current = 0;
      const backlog = target.current - shown.current;
      if (backlog <= 0) return;
      shown.current = Math.min(target.current, shown.current + Math.max(1, Math.ceil(backlog * 0.16)));
      setN(shown.current);
      if (shown.current < target.current) raf.current = requestAnimationFrame(tick);
    };
    if (!streaming || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      shown.current = full.length;
      setN(full.length);
    } else if (!raf.current && shown.current < full.length) {
      raf.current = requestAnimationFrame(tick);
    }
  }, [full, streaming]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const end = Math.min(shown.current, full.length);
  const code = full.charCodeAt(end - 1);
  return full.slice(0, code >= 0xd800 && code <= 0xdbff ? end + 1 : end); // never split a surrogate pair
}
