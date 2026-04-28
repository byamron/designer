// Shared `Anchor` enum — mirror of `crates/designer-core/src/anchor.rs`.
// Locked by Track 13.K spec (`core-docs/roadmap.md` § "Locked contracts").
// Friction (13.K), inline comments (15.H), and finding evidence (Phase 21)
// share this surface; do NOT add a `data-friction-id` attribute — reuse the
// existing component-annotation surface (`data-component`).

export type Anchor =
  | {
      kind: "message-span";
      messageId: string;
      quote: string;
      charRange?: [number, number];
    }
  | { kind: "prototype-point"; tabId: string; nx: number; ny: number }
  | {
      kind: "prototype-element";
      tabId: string;
      selectorPath: string;
      textSnippet?: string;
    }
  | {
      kind: "dom-element";
      selectorPath: string;
      route: string;
      component?: string;
      stableId?: string;
      textSnippet?: string;
    }
  | { kind: "tool-call"; eventId: string; toolName: string }
  | { kind: "file-path"; path: string; lineRange?: [number, number] };

/**
 * Component-annotation attribute reused across Friction (13.K), comments
 * (15.H), and finding evidence (Phase 21). Listed here in priority order so
 * `anchorFromElement` can walk up the tree once and pick the strongest
 * available signal. Update `pattern-log.md` when you add a new entry.
 */
const COMPONENT_ATTRS = ["data-component", "data-block-kind"] as const;

const STABLE_ID_ATTRS = [
  "data-id",
  "data-workspace-id",
  "data-track-id",
  "data-artifact-id",
  "data-project-id",
] as const;

const SNAP_ROLES = new Set(["row", "button", "dialog", "tab", "tabpanel"]);

/**
 * Walks ancestors (including the element itself) and returns the closest one
 * that carries any of {data-component, data-block-kind, role=row|button|…,
 * <dialog>, <button>}. The atomic hovered node is what `Alt` overrides to.
 */
export function snapTarget(el: Element | null): Element | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur instanceof HTMLElement) {
      for (const attr of COMPONENT_ATTRS) {
        if (cur.getAttribute(attr)) return cur;
      }
      const role = cur.getAttribute("role");
      if (role && SNAP_ROLES.has(role)) return cur;
      if (cur.tagName === "BUTTON" || cur.tagName === "DIALOG") return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Build a stable selector for the element. Priority:
 *   1. `data-component` (with optional stable-id qualifier)
 *   2. `data-block-kind`
 *   3. any of STABLE_ID_ATTRS as a `[attr="value"]` selector
 *   4. structural CSS path (last resort — fragile across rerenders)
 *
 * Selectors live alongside other identifiers (component name, stable id) on
 * the Anchor itself so `resolveAnchor` can pick the most reliable signal at
 * resolve time, not the most specific selector at capture time.
 */
export function selectorFor(el: Element): string {
  if (!(el instanceof HTMLElement)) return structuralPath(el);
  const component = el.getAttribute("data-component");
  if (component) {
    for (const attr of STABLE_ID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return `[data-component="${cssEscape(component)}"][${attr}="${cssEscape(v)}"]`;
    }
    return `[data-component="${cssEscape(component)}"]`;
  }
  const block = el.getAttribute("data-block-kind");
  if (block) return `[data-block-kind="${cssEscape(block)}"]`;
  for (const attr of STABLE_ID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) return `[${attr}="${cssEscape(v)}"]`;
  }
  return structuralPath(el);
}

function structuralPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && parts.length < 6) {
    const tag = cur.tagName.toLowerCase();
    let part = tag;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const siblings: Element[] = Array.from(parent.children).filter(
        (c: Element) => c.tagName.toLowerCase() === tag,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    cur = parent;
  }
  return parts.join(" > ");
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/(["\\])/g, "\\$1");
}

function trimSnippet(text: string | null | undefined, max = 80): string | undefined {
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/**
 * Page-level fallback Anchor — used when the user submits a friction
 * report without explicitly anchoring (Track 13.M's typed-sentence
 * default flow). Reuses the locked `dom-element` variant; the projection
 * descriptor falls back to the route, which is the right hint.
 */
export function pageAnchorForRoute(route: string): Anchor {
  return {
    kind: "dom-element",
    selectorPath: "body",
    route,
    component: undefined,
    stableId: undefined,
    textSnippet: undefined,
  };
}

/**
 * Build a `dom-element` Anchor from the given DOM node + active route.
 * `el` is typically the snap-target (component root) but can be the atomic
 * hovered node when the user holds Alt.
 */
export function anchorFromElement(el: Element, route: string): Anchor {
  const component = el.getAttribute("data-component") ?? undefined;
  const stableId = (() => {
    for (const attr of STABLE_ID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) return v;
    }
    return undefined;
  })();
  const textSnippet = trimSnippet((el as HTMLElement).innerText);
  return {
    kind: "dom-element",
    selectorPath: selectorFor(el),
    route,
    component,
    stableId,
    textSnippet,
  };
}

/**
 * Re-locate an Anchor's element. Returns null if the surface has changed
 * enough that the anchor is stale (callers should grey out or remove the
 * pinned widget rather than mis-anchor).
 */
export function resolveAnchor(a: Anchor): Element | null {
  if (a.kind !== "dom-element") return null;
  try {
    return document.querySelector(a.selectorPath);
  } catch {
    return null;
  }
}

/**
 * Friction title synthesis (deterministic, no LLM): `<descriptor>: <body>`
 * truncated. Spec-locked in roadmap.md § Track 13.K → "Title synthesis".
 */
export function synthesizeTitle(anchor: Anchor | null, body: string): string {
  const descriptor = anchor ? anchorDescriptor(anchor) : "Designer";
  const trimmed = body.replace(/\s+/g, " ").trim();
  const head = trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed;
  return head ? `${descriptor}: ${head}` : descriptor;
}

export function anchorDescriptor(a: Anchor): string {
  switch (a.kind) {
    case "dom-element":
      return a.component ?? a.stableId ?? a.route;
    case "message-span":
      return `message ${a.messageId}`;
    case "prototype-point":
      return `prototype ${a.tabId}`;
    case "prototype-element":
      return `prototype ${a.tabId}`;
    case "tool-call":
      return `tool:${a.toolName}`;
    case "file-path":
      return a.lineRange ? `${a.path}:${a.lineRange[0]}-${a.lineRange[1]}` : a.path;
  }
}
