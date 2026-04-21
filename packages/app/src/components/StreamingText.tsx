import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../theme";

/**
 * Types text one character at a time — the Claude-style streaming preview
 * pattern. Respects `prefers-reduced-motion` by rendering instantly.
 */
export function StreamingText({
  text,
  speedMs = 10,
  showCursor = true,
}: {
  text: string;
  speedMs?: number;
  showCursor?: boolean;
}) {
  const [shown, setShown] = useState(() =>
    prefersReducedMotion() ? text : "",
  );
  const [done, setDone] = useState(prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text);
      setDone(true);
      return;
    }
    setShown("");
    setDone(false);
    let i = 0;
    const tick = () => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        setDone(true);
        return;
      }
      id = window.setTimeout(tick, speedMs);
    };
    let id = window.setTimeout(tick, speedMs);
    return () => window.clearTimeout(id);
  }, [text, speedMs]);

  return (
    <span>
      {shown}
      {showCursor && !done && <span className="streaming-cursor" aria-hidden="true" />}
    </span>
  );
}
