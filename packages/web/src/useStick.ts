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

  const anim = useRef(0);
  const cancelAnim = useCallback(() => {
    cancelAnimationFrame(anim.current);
    anim.current = 0;
  }, []);

  const set = useCallback((a: boolean) => {
    if (attached.current === a) return;
    attached.current = a;
    setDetached(!a);
  }, []);

  const pin = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /**
   * Animated scroll to the live bottom, so the motion shows which way the view moved.
   * The target is re-read every frame because streaming keeps growing the content.
   * The pill disappears immediately; following resumes on arrival.
   */
  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    cancelAnim();
    const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (dist < 4 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      set(true);
      pin();
      return;
    }
    setDetached(false);
    const start = el.scrollTop;
    const dur = Math.min(420, Math.max(180, Math.sqrt(dist) * 12));
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const target = el.scrollHeight - el.clientHeight;
      el.scrollTop = start + (target - start) * (1 - Math.pow(1 - t, 3));
      if (t < 1) anim.current = requestAnimationFrame(step);
      else {
        anim.current = 0;
        attached.current = true;
        setDetached(false);
        pin();
      }
    };
    anim.current = requestAnimationFrame(step);
  }, [set, pin, cancelAnim]);

  useEffect(() => {
    const el = scroller.current;
    const body = content.current;
    if (!el || !body) return;
    let lastTop = el.scrollTop;
    let scrollbarDrag = false;
    let touchY = 0;

    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= REATTACH_PX;
    let lastUserUp = 0; // when the user last scrolled up (wheel, touch, key, scrollbar)
    const detach = () => {
      lastUserUp = performance.now();
      cancelAnim();
      attached.current = false;
      setDetached(true);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) detach();
      else if (anim.current) cancelAnim(); // scrolling down yourself: let go of the animation
    };
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (y > touchY + 2) detach(); // finger moving down = content scrolls up
      touchY = y;
    };
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && e.target === el) detach();
    };
    const onPointerDown = (e: PointerEvent) => {
      // a press on the scrollbar track/thumb targets the scroller itself, right of the content box
      if (e.target === el && e.offsetX >= el.clientWidth) scrollbarDrag = true;
    };
    const onPointerUp = () => (scrollbarDrag = false);
    const onScroll = () => {
      const top = el.scrollTop;
      if (scrollbarDrag && top < lastTop) detach();
      // Re-attach only when the user really moved DOWN to the bottom. A scroll event left over from our own animation or pin
      // (same or slightly larger position) can arrive right after an upward wheel and must not undo it.
      if (!anim.current && !attached.current && nearBottom() && top > lastTop && performance.now() - lastUserUp > 250) set(true);
      lastTop = top;
    };
    const ro = new ResizeObserver(() => {
      if (attached.current && !anim.current) pin();
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
  }, [set, pin, cancelAnim]);

  // new thread: start attached at the bottom
  useEffect(() => {
    cancelAnim();
    set(true);
    pin();
  }, [resetKey, set, pin, cancelAnim]);

  return { scroller, content, detached, toBottom };
}
