import type { CSSProperties, ReactNode } from "react";

/**
 * Team-color catalog (Phase 22.G).
 *
 * Renders all sixteen --team-N hues with their light + dark variants
 * side-by-side, plus the per-team pulse animation, so the palette
 * can be inspected as one surface for visual review. Lab-only and
 * dev-only — no consumer UI references --team-* tokens yet.
 *
 * Each row has six cells:
 *   [ index | dot+rate (light) | tint (light) | dot+rate (dark) | tint (dark) | hue ]
 *
 * Light + dark cells force their own theme by setting `data-theme` and
 * the matching Radix `light-theme` / `dark-theme` class on a wrapper
 * div, so the catalog renders both regardless of the user's active
 * appearance setting.
 */

const TEAM_COUNT = 16;

const RATES = [
  "1.413s",
  "1.451s",
  "1.487s",
  "1.523s",
  "1.559s",
  "1.597s",
  "1.633s",
  "1.669s",
  "1.709s",
  "1.747s",
  "1.787s",
  "1.823s",
  "1.867s",
  "1.913s",
  "1.951s",
  "1.991s",
];

function ModeFrame({
  mode,
  children,
  ariaLabel,
}: {
  mode: "light" | "dark";
  children: ReactNode;
  ariaLabel: string;
}) {
  const className = mode === "dark" ? "dark-theme" : "light-theme";
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--color-content-surface)",
    border: "var(--border-thin) solid var(--color-border-soft)",
    borderRadius: "var(--radius-card)",
    color: "var(--color-foreground)",
    minWidth: "calc(var(--space-8) * 3)",
  };
  return (
    <div
      className={className}
      data-theme={mode}
      role="group"
      aria-label={ariaLabel}
      style={style}
    >
      {children}
    </div>
  );
}

function TeamRow({ index }: { index: number }) {
  const dotClass = `team-dot team-dot--${index}`;
  const tintVar = `var(--team-${index}-tint)`;
  const inkedVar = `var(--team-${index})`;
  const rate = RATES[index - 1];
  const hueDeg = ((index - 1) * 22.5).toFixed(1);

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto 1fr 1fr 1fr 1fr auto",
    alignItems: "center",
    gap: "var(--space-3)",
  };

  const indexStyle: CSSProperties = {
    fontFamily: "var(--type-family-mono)",
    fontSize: "var(--type-caption-size)",
    color: "var(--color-muted)",
    minWidth: "calc(var(--space-5))",
    textAlign: "right",
  };

  const tintStyle: CSSProperties = {
    background: tintVar,
    border: "var(--border-thin) solid var(--color-border-soft)",
    borderRadius: "var(--radius-button)",
    padding: "var(--space-2) var(--space-3)",
    minWidth: "calc(var(--space-7) * 2)",
    fontSize: "var(--type-caption-size)",
    color: "var(--color-foreground)",
    fontFamily: "var(--type-family-mono)",
  };

  const swatchStyle: CSSProperties = {
    width: "var(--space-4)",
    height: "var(--space-4)",
    borderRadius: "var(--radius-pill)",
    background: inkedVar,
    border: "var(--border-thin) solid var(--color-border-soft)",
  };

  const rateStyle: CSSProperties = {
    fontFamily: "var(--type-family-mono)",
    fontSize: "var(--type-caption-size)",
    color: "var(--color-muted)",
  };

  const hueStyle: CSSProperties = {
    fontFamily: "var(--type-family-mono)",
    fontSize: "var(--type-caption-size)",
    color: "var(--color-muted)",
  };

  return (
    <li style={rowStyle} aria-label={`Team ${index} — hue ${hueDeg}°`}>
      <span style={indexStyle} aria-hidden="true">
        {index.toString().padStart(2, "0")}
      </span>
      <ModeFrame mode="light" ariaLabel={`Team ${index} light mode`}>
        <span className={dotClass} aria-hidden="true" />
        <span style={swatchStyle} aria-hidden="true" />
        <span style={rateStyle}>{rate}</span>
      </ModeFrame>
      <ModeFrame mode="light" ariaLabel={`Team ${index} light tint`}>
        <span style={tintStyle}>tint · row bg</span>
      </ModeFrame>
      <ModeFrame mode="dark" ariaLabel={`Team ${index} dark mode`}>
        <span className={dotClass} aria-hidden="true" />
        <span style={swatchStyle} aria-hidden="true" />
        <span style={rateStyle}>{rate}</span>
      </ModeFrame>
      <ModeFrame mode="dark" ariaLabel={`Team ${index} dark tint`}>
        <span style={tintStyle}>tint · row bg</span>
      </ModeFrame>
      <span style={hueStyle} aria-hidden="true">
        {hueDeg}°
      </span>
    </li>
  );
}

export function TeamColorCatalog() {
  const rows = Array.from({ length: TEAM_COUNT }, (_, i) => i + 1);
  return (
    <section
      data-component="TeamColorCatalog"
      aria-labelledby="team-catalog-title"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-5)",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <h3 id="team-catalog-title" style={{ margin: 0 }}>
          Team identity palette · 22.G
        </h3>
        <p
          style={{
            margin: 0,
            color: "var(--color-muted)",
            fontSize: "var(--type-caption-size)",
          }}
        >
          Sixteen OKLCH hues, light + dark, with per-team pulse rates in
          [1.4 s, 2.0 s]. Honors prefers-reduced-motion.
        </p>
      </header>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        {rows.map((index) => (
          <TeamRow key={index} index={index} />
        ))}
      </ol>
    </section>
  );
}
