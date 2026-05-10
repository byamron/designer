import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Agentation } from "agentation";
import { cycles, variants, type VariantId } from "./variants";

export function App() {
  const [active, setActive] = useState<VariantId | null>(null);
  const variant = active ? variants.find((v) => v.id === active) : null;

  const stageRef = useRef<HTMLElement | null>(null);
  const scrollMapRef = useRef<Map<VariantId, number>>(new Map());

  // Preserve scroll position per variant.
  useLayoutEffect(() => {
    if (!active || !stageRef.current) return;
    const wrap = stageRef.current.querySelector<HTMLElement>(".chat__thread-wrap");
    if (!wrap) return;

    const saved = scrollMapRef.current.get(active);
    if (saved !== undefined) wrap.scrollTop = saved;

    const onScroll = () => scrollMapRef.current.set(active, wrap.scrollTop);
    wrap.addEventListener("scroll", onScroll, { passive: true });
    return () => wrap.removeEventListener("scroll", onScroll);
  }, [active]);

  // Arrow-key navigation. Implemented as a listbox with aria-activedescendant:
  // DOM focus stays on the container (`.app__rail-listbox`); items never receive
  // focus, so :focus-visible never fires on them during keyboard nav. The active
  // state on the option IS the keyboard-cursor indicator.
  // Window-level handler so arrow keys work even before the user tabs into the rail.
  const move = useCallback((delta: number) => {
    setActive((curr) => {
      if (variants.length === 0) return curr;
      const idx = curr ? variants.findIndex((v) => v.id === curr) : -1;
      const next = Math.max(0, Math.min(variants.length - 1, (idx === -1 ? 0 : idx + delta)));
      return variants[next].id;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) return;
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  return (
    <div className="app">
      {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
      <aside className="app__rail">
        <header className="app__rail-head">
          <p className="app__rail-eyebrow">Designer / Taste loop</p>
          <h1>Workspace thread</h1>
          <p className="app__rail-sub">↑/↓ to switch</p>
        </header>
        {variants.length === 0 ? (
          <p className="app__rail-empty">
            No variants yet. Add one under <code>src/variants/</code> and register it in <code>src/variants/index.ts</code>.
          </p>
        ) : (
          <div
            role="listbox"
            tabIndex={0}
            aria-label="Variants"
            aria-activedescendant={active ? `rail-${active}` : undefined}
            className="app__rail-listbox"
          >
            {cycles.map((group, gi) => (
              <section key={group.label} className="app__rail-group" data-first={gi === 0}>
                <header className="app__rail-group-head">
                  <span className="app__rail-group-label">{group.label}</span>
                </header>
                <div className="app__rail-group-items" role="group">
                  {group.variants.map((v) => (
                    <div
                      key={v.id}
                      id={`rail-${v.id}`}
                      role="option"
                      aria-selected={active === v.id}
                      data-active={active === v.id}
                      className="app__rail-item"
                      onClick={() => setActive(v.id)}
                    >
                      <span className="app__rail-item-headline">{v.headline}</span>
                      <span className="app__rail-item-id">{v.id}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </aside>
      <main className="app__stage" ref={stageRef}>
        <div className="app__panel">
          {variant ? (
            <variant.Component />
          ) : (
            <div className="app__stage-empty">
              <p>Pick a variant to view it. The stage hot-reloads on edit.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
