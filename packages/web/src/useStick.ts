import { useCallback, useEffect, useRef, useState } from 'react';

const REATTACH_PX = 8;

/**
 * Follow/detach scroll state machine driven by user input, not scroll position:
 * an upward wheel, touch drag, nav key or scrollbar drag detaches; getting back to the
 * bottom (within a few px) re-attaches. While attached, content growth is pinned to the
 * bottom from a ResizeObserver, which runs before paint.
 */
export function useStick(resetKey: string) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const attached = useRef(true);
  const [detached, setDetached] = useState(false);

  const set = useCallback((a: boolean) => {
    if (attached.current === a) return;
    attached.current = a;
    setDetached(!a);
  }, []);

  const pin = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const toBottom = useCallback(() => {
    set(true);
    pin();
  }, [set, pin]);

  useEffect(() => {
    const el = scroller.current;
    const body = content.current;
    if (!el || !body) return;
    let lastTop = el.scrollTop;
    let scrollbarDrag = false;
    let touchY = 0;

    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= REATTACH_PX;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) set(false);
    };
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (y > touchY + 2) set(false); // finger moving down = content scrolls up
      touchY = y;
    };
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && e.target === el) set(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      // a press on the scrollbar track/thumb targets the scroller itself, right of the content box
      if (e.target === el && e.offsetX >= el.clientWidth) scrollbarDrag = true;
    };
    const onPointerUp = () => (scrollbarDrag = false);
    const onScroll = () => {
      const top = el.scrollTop;
      if (scrollbarDrag && top < lastTop) set(false);
      if (!attached.current && nearBottom() && top >= lastTop) set(true);
      lastTop = top;
    };
    const ro = new ResizeObserver(() => {
      if (attached.current) pin();
    });
    ro.observe(body);
    ro.observe(el);

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('scroll', onScroll);
    };
  }, [set, pin]);

  // new thread: start attached at the bottom
  useEffect(() => {
    set(true);
    pin();
  }, [resetKey, set, pin]);

  return { scroller, content, detached, toBottom };
}
