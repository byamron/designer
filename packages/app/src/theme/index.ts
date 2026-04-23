// Theme bootstrapping.
//
// Radix Colors v3 activates its dark scale only via the `.dark` / `.dark-theme`
// class on a root element — it does NOT respond to `prefers-color-scheme`. So
// we apply both the Radix class AND Designer's own `data-theme` attribute
// whenever the resolved theme changes. A no-class default leaves Radix in
// light mode regardless of the system preference, which is why the earlier
// bootstrap rendered the app in light mode even on a dark-configured machine.
//
// Modes:
//   - "system" → listen to `prefers-color-scheme` and mirror it.
//   - "light" / "dark" → pinned, persisted in localStorage.

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const MODE_KEY = "designer:theme-override";

let systemMedia: MediaQueryList | null = null;
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;
const listeners = new Set<(mode: ThemeMode, resolved: ResolvedTheme) => void>();
let currentMode: ThemeMode = "system";
let currentResolved: ResolvedTheme = "light";

function resolveSystem(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyToDom(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove("light-theme", "dark-theme", "light", "dark");
  root.classList.add(resolved === "dark" ? "dark-theme" : "light-theme");
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  currentResolved = resolved;
}

function teardownSystemListener() {
  if (systemMedia && systemListener) {
    systemMedia.removeEventListener("change", systemListener);
  }
  systemMedia = null;
  systemListener = null;
}

function installSystemListener() {
  teardownSystemListener();
  systemMedia = window.matchMedia("(prefers-color-scheme: dark)");
  systemListener = (e) => {
    const next: ResolvedTheme = e.matches ? "dark" : "light";
    applyToDom(next);
    listeners.forEach((l) => l(currentMode, next));
  };
  systemMedia.addEventListener("change", systemListener);
}

function readStoredMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(MODE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function getResolvedTheme(): ResolvedTheme {
  return currentResolved;
}

export function setThemeMode(mode: ThemeMode) {
  currentMode = mode;
  if (mode === "system") {
    localStorage.removeItem(MODE_KEY);
    applyToDom(resolveSystem());
    installSystemListener();
  } else {
    localStorage.setItem(MODE_KEY, mode);
    teardownSystemListener();
    applyToDom(mode);
  }
  listeners.forEach((l) => l(currentMode, currentResolved));
}

export function subscribeTheme(
  cb: (mode: ThemeMode, resolved: ResolvedTheme) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function initThemeBootstrap() {
  const mode = readStoredMode();
  setThemeMode(mode);
}

/** React to `prefers-reduced-motion` — Mini's axioms.css already handles CSS;
 *  exposes the boolean so JS-driven animations can also respect the preference. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
