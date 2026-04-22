import { useState } from "react";

interface Annotation {
  id: string;
  x: number; // 0–100
  y: number;
  text: string;
  author: "you" | "design-reviewer";
}

/**
 * Annotation overlay on top of the prototype iframe. Agentation-style: click
 * to drop a pin, type a note; the note is added to a batch that can be sent
 * to the team lead. The pins don't touch the iframe — they live in an overlay
 * above it so the CSP sandbox stays intact.
 */
export function AnnotationLayer({ variant }: { variant: string }) {
  const [pins, setPins] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);

  return (
    <div
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setDraft({ id: crypto.randomUUID(), x, y, text: "", author: "you" });
      }}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "auto",
        cursor: "crosshair",
      }}
      aria-label={`Annotation layer for variant ${variant}`}
    >
      {pins.map((p) => (
        <Pin key={p.id} pin={p} />
      ))}
      {draft && (
        <div
          style={{
            position: "absolute",
            left: `${draft.x}%`,
            top: `${draft.y}%`,
            transform: "translate(-8px, -8px)",
            background: "var(--color-surface-overlay)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
            padding: "var(--space-2)",
            display: "flex",
            gap: "var(--space-2)",
            minWidth: "calc(var(--space-8) * 4)",
            boxShadow: "var(--elevation-overlay)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            placeholder="Leave a note…"
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            title="Note for this pin · ↵ to save"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.text.trim()) {
                  setPins((p) => [...p, draft]);
                  setDraft(null);
                }
              }
            }}
            style={{
              all: "unset",
              flex: 1,
              padding: "var(--space-1) var(--space-2)",
              color: "var(--color-foreground)",
              background: "var(--color-background)",
              borderRadius: "var(--radius-button)",
              border: "1px solid var(--color-border)",
              minHeight: "var(--space-5)",
            }}
          />
          <button
            type="button"
            className="btn"
            data-variant="primary"
            title="Save this annotation pin"
            onClick={() => {
              if (draft.text.trim()) {
                setPins((p) => [...p, draft]);
                setDraft(null);
              }
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function Pin({ pin }: { pin: Annotation }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${pin.x}%`,
        top: `${pin.y}%`,
        transform: "translate(-50%, -50%)",
        width: "var(--space-4)",
        height: "var(--space-4)",
        borderRadius: "var(--radius-pill)",
        background: "var(--info-9)",
        color: "var(--color-background)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--type-caption-size)",
        fontWeight: "var(--weight-semibold)",
        boxShadow: "var(--elevation-overlay)",
      }}
      title={pin.text}
      aria-label={`Annotation: ${pin.text}`}
    >
      !
    </div>
  );
}
