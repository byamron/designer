// Theme bootstrapping. Mini's tokens.css + axioms.css bind themes to
// `prefers-color-scheme` via Radix. All we do here is:
//
//   1. Respect `prefers-reduced-motion` (mirrors Mini's axioms.css).
//   2. Expose a manual `setThemeOverride(mode)` for future settings. Default
//      is "system" (no override).
//
// Dark-mode parity (design language §Theme) is guaranteed by Mini's scales;
// no per-component dark handling required.

export type ThemeMode = "system" | "light" | "dark";

const OVERRIDE_KEY = "designer:theme-override";

export function initThemeBootstrap() {
  const stored = localStorage.getItem(OVERRIDE_KEY);
  if (stored === "light" || stored === "dark") {
    applyOverride(stored);
  }
}

export function setThemeOverride(mode: ThemeMode) {
  if (mode === "system") {
    localStorage.removeItem(OVERRIDE_KEY);
    document.documentElement.style.colorScheme = "";
    document.documentElement.removeAttribute("data-theme");
  } else {
    localStorage.setItem(OVERRIDE_KEY, mode);
    applyOverride(mode);
  }
}

function applyOverride(mode: "light" | "dark") {
  document.documentElement.style.colorScheme = mode;
  document.documentElement.setAttribute("data-theme", mode);
}

/** React to `prefers-reduced-motion` — Mini's axioms.css already handles CSS;
 *  exposes the boolean so JS-driven animations can also respect the preference. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
