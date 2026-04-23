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
 * the empty canvas to drop a pin, type a note, save. Previously-saved pins
 * are clickable to re-read and edit the note — the first pass only rendered
 * a one-letter glyph with a title-attribute tooltip, which hid the entire
 * value of the annotation once it was saved.
 */
export function AnnotationLayer({ variant }: { variant: string }) {
  const [pins, setPins] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);

  const savePin = (pin: Annotation) => {
    if (!pin.text.trim()) return;
    setPins((list) => {
      const existing = list.findIndex((p) => p.id === pin.id);
      if (existing >= 0) {
        const next = list.slice();
        next[existing] = pin;
        return next;
      }
      return [...list, pin];
    });
    setDraft(null);
    setOpenPin(null);
  };

  return (
    <div
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setOpenPin(null);
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
      {pins.map((p, i) => (
        <Pin
          key={p.id}
          index={i + 1}
          pin={p}
          open={openPin === p.id}
          onOpen={(e) => {
            e.stopPropagation();
            setDraft(null);
            setOpenPin((curr) => (curr === p.id ? null : p.id));
          }}
          onRemove={(e) => {
            e.stopPropagation();
            setPins((list) => list.filter((x) => x.id !== p.id));
            setOpenPin(null);
          }}
        />
      ))}
      {draft && (
        <PinDraft
          draft={draft}
          onChange={(next) => setDraft(next)}
          onSave={() => savePin(draft)}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}

function Pin({
  pin,
  index,
  open,
  onOpen,
  onRemove,
}: {
  pin: Annotation;
  index: number;
  open: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${pin.x}%`,
        top: `${pin.y}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-2)",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="annotation-pin"
        aria-label={`Annotation ${index}: ${pin.text}`}
        aria-expanded={open}
      >
        {index}
      </button>
      {open && (
        <div
          className="annotation-popover"
          role="dialog"
          aria-label={`Annotation ${index}`}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="annotation-popover__body">{pin.text}</p>
          <div className="annotation-popover__meta">
            <span>{pin.author}</span>
            <button
              type="button"
              className="annotation-popover__remove"
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PinDraft({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Annotation;
  onChange: (next: Annotation) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="annotation-draft"
      style={{
        position: "absolute",
        left: `${draft.x}%`,
        top: `${draft.y}%`,
        transform: "translate(-8px, -8px)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        placeholder="Leave a note…"
        autoFocus
        value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        className="annotation-draft__input"
        aria-label="Note for this pin"
      />
      <div className="annotation-draft__actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn" data-variant="primary" onClick={onSave}>Save</button>
      </div>
    </div>
  );
}
