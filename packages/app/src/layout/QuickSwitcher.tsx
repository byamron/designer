import { useEffect, useMemo, useRef, useState } from "react";
import {
  selectProject,
  selectWorkspace,
  toggleQuickSwitcher,
  useAppState,
} from "../store/app";
import { useDataState } from "../store/data";

interface Hit {
  id: string;
  label: string;
  kind: "project" | "workspace";
  projectId?: string;
  meta?: string;
}

export function QuickSwitcher() {
  const open = useAppState((s) => s.quickSwitcherOpen);
  const projects = useDataState((s) => s.projects);
  const workspaces = useDataState((s) => s.workspaces);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const all: Hit[] = [];
    for (const p of projects) {
      all.push({
        id: `p:${p.project.id}`,
        label: p.project.name,
        kind: "project",
        meta: `${p.workspace_count} workspaces`,
      });
      const group = workspaces[p.project.id] ?? [];
      for (const w of group) {
        all.push({
          id: `w:${w.workspace.id}`,
          label: w.workspace.name,
          kind: "workspace",
          projectId: p.project.id,
          meta: `${p.project.name} · ${w.workspace.base_branch}`,
        });
      }
    }
    if (!query) return all.slice(0, 10);
    const q = query.toLowerCase();
    return all
      .map((h) => ({ h, score: matchScore(h.label, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.h)
      .slice(0, 10);
  }, [query, projects, workspaces]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  if (!open) return null;

  const commit = (hit: Hit) => {
    if (hit.kind === "project") {
      selectProject(hit.id.slice(2));
    } else {
      if (hit.projectId) selectProject(hit.projectId);
      selectWorkspace(hit.id.slice(2));
    }
    toggleQuickSwitcher(false);
  };

  return (
    <div
      className="quick-switcher-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) toggleQuickSwitcher(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        className="quick-switcher"
        onKeyDownCapture={(e) => {
          // Focus trap: cycle tab within the dialog so keyboard users can't
          // escape to hidden background content.
          if (e.key === "Tab") {
            const root = e.currentTarget;
            const focusables = root.querySelectorAll<HTMLElement>(
              'input, button, [tabindex]:not([tabindex="-1"])',
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && active === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && active === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <input
          ref={inputRef}
          className="quick-switcher__input"
          placeholder="Search projects, workspaces…"
          title="Type to filter · ↑↓ to move · ↵ to jump"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = hits[index];
              if (hit) commit(hit);
            } else if (e.key === "Escape") {
              toggleQuickSwitcher(false);
            }
          }}
        />
        <div
          className="quick-switcher__list"
          role="listbox"
          aria-activedescendant={hits[index]?.id ?? undefined}
        >
          {hits.length === 0 ? (
            <p
              style={{
                color: "var(--color-muted)",
                padding: "var(--space-2) var(--space-3)",
              }}
            >
              No matches.
            </p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.id}
                type="button"
                className="quick-switcher__row"
                role="option"
                id={hit.id}
                aria-selected={i === index}
                data-active={i === index}
                title={`Go to ${hit.label}${hit.meta ? ` · ${hit.meta}` : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => commit(hit)}
              >
                <span>{hit.label}</span>
                <span className="quick-switcher__meta">{hit.meta}</span>
              </button>
            ))
          )}
        </div>
        <p
          style={{
            color: "var(--color-muted)",
            fontSize: "var(--type-caption-size)",
            margin: 0,
            padding: "var(--space-2) var(--space-3)",
            display: "flex",
            gap: "var(--space-2)",
          }}
        >
          <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close
        </p>
      </div>
    </div>
  );
}

function matchScore(label: string, query: string): number {
  const lower = label.toLowerCase();
  if (lower === query) return 100;
  if (lower.startsWith(query)) return 80;
  if (lower.includes(query)) return 60;
  // simple subsequence match
  let i = 0;
  for (const ch of lower) {
    if (ch === query[i]) i++;
    if (i === query.length) return 30;
  }
  return 0;
}
