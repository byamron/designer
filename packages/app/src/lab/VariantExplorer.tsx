export function VariantExplorer({
  selected,
  onSelect,
}: {
  selected: "A" | "B" | "C";
  onSelect: (v: "A" | "B" | "C") => void;
}) {
  const options: Array<"A" | "B" | "C"> = ["A", "B", "C"];
  return (
    <div
      role="tablist"
      aria-label="Variant"
      style={{ display: "inline-flex", gap: "var(--space-1)" }}
    >
      {options.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={selected === v}
          className="btn"
          data-variant={selected === v ? "primary" : undefined}
          onClick={() => onSelect(v)}
        >
          Variant {v}
        </button>
      ))}
    </div>
  );
}
