import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { closeDialog, useAppState } from "../store/app";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { DesignerNoticedPage } from "../components/DesignerNoticed";
import { IconButton } from "../components/IconButton";
import {
  getThemeMode,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from "../theme";
import { ipcClient } from "../ipc/client";
import type { FrictionEntry, FrictionState, KeychainStatus } from "../ipc/types";
import { COST_CHIP_PREFERENCE_EVENT } from "../components/CostChip";

/**
 * Settings as a full-screen page — replaces the entire AppShell while
 * open. Previously a modal dialog; user feedback: settings are global
 * and deserve the real page register rather than a popover that covers
 * only part of the app. Sections live in a left rail (same visual
 * structure as the workspace sidebar), with the selected section
 * occupying the main area. Escape or the "Back to app" button returns
 * to the workspace.
 */

type SettingsSection =
  | "appearance"
  | "account"
  | "models"
  | "preferences"
  | "activity";

const SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, density, and surface register.",
  },
  {
    id: "account",
    label: "Account",
    description: "Claude Code and GitHub connections.",
  },
  {
    id: "models",
    label: "Models",
    description: "Defaults and on-device models.",
  },
  {
    id: "preferences",
    label: "Preferences",
    description: "Autonomy, notifications, and keybindings.",
  },
  {
    // Locked by Track 13.K + Phase 21.A1 specs (`roadmap.md` §"Settings IA").
    // Two sub-pages: Friction (13.K) and Designer noticed (21.A1).
    id: "activity",
    label: "Activity",
    description: "Friction reports and what Designer noticed.",
  },
];

export function SettingsPage() {
  const [active, setActive] = useState<SettingsSection>("appearance");
  // DP-C — `models` is a placeholder pane (no real selection wired); hide
  // it behind the `show_models_section` feature flag so a fresh dogfood
  // install doesn't bump into a half-baked surface. Falls back to the
  // first visible section if the user is somehow on `models` when the
  // flag flips off.
  const [showModels, setShowModels] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setShowModels(f.show_models_section);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => s.id !== "models" || showModels),
    [showModels],
  );
  useEffect(() => {
    if (!visibleSections.some((s) => s.id === active)) {
      setActive(visibleSections[0]?.id ?? "appearance");
    }
  }, [visibleSections, active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="settings-page" data-component="SettingsPage" role="region" aria-label="Settings">
      <header className="settings-page__topbar">
        <button
          type="button"
          className="settings-page__back"
          onClick={closeDialog}
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Back to app</span>
        </button>
        <h1 className="settings-page__title">Settings</h1>
      </header>

      <div className="settings-page__body">
        <nav className="settings-page__nav" aria-label="Settings sections">
          <ul className="settings-page__nav-list" role="list">
            {visibleSections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className="settings-page__nav-item"
                  data-active={active === section.id}
                  onClick={() => setActive(section.id)}
                >
                  <span className="settings-page__nav-label">{section.label}</span>
                  <span className="settings-page__nav-meta">{section.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="settings-page__content" aria-label={`${active} settings`}>
          <div className="settings-page__surface">
            {active === "appearance" && <AppearanceSection />}
            {active === "account" && <AccountSection />}
            {active === "models" && <ModelsSection />}
            {active === "preferences" && <PreferencesSection />}
            {active === "activity" && <ActivitySection />}
          </div>
        </main>
      </div>
    </div>
  );
}

function AppearanceSection() {
  return (
    <>
      <SettingsSectionHeader
        label="Appearance"
        description="Control how Designer looks on this device. Changes apply immediately and persist per user."
      />
      <SettingsRow label="Theme" description="Follow the system appearance or force light / dark.">
        <ThemePicker />
      </SettingsRow>
      <SettingsRow label="Density" description="Information density for rows, tabs, and chrome.">
        <span className="settings-page__meta">balanced</span>
      </SettingsRow>
    </>
  );
}

/**
 * Account stays global. The previously-bundled Repository row was
 * per-project (the linked repo is per-workspace, project-scoped) and
 * moved to Project Home — see spec §"Settings scope" (D2026-05).
 */
function AccountSection() {
  return (
    <>
      <SettingsSectionHeader
        label="Account"
        description="Designer orchestrates your local Claude Code installation — we never store your OAuth tokens."
      />
      <SettingsRow label="Claude Code" description="Signed in via the local CLI.">
        <span className="settings-page__meta">signed in on this machine</span>
      </SettingsRow>
      <SettingsRow
        label="Keychain"
        description="Read-only check that Claude Code's macOS Keychain credential is reachable. Designer never reads or writes your token."
      >
        <KeychainStatusReadout />
      </SettingsRow>
    </>
  );
}

function KeychainStatusReadout() {
  const [status, setStatus] = useState<KeychainStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    ipcClient()
      .getKeychainStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return <span className="settings-page__meta">checking…</span>;
  }
  // Stable copy regardless of state — screen readers won't be re-announced
  // on minor state churn. The status itself is a token, not displayed copy.
  const dotClass = `settings-page__keychain-dot settings-page__keychain-dot--${status.state}`;
  return (
    <span
      className="settings-page__keychain"
      role="status"
      aria-live="polite"
      data-state={status.state}
    >
      <span className={dotClass} aria-hidden="true" />
      <span className="settings-page__meta">{status.message}</span>
    </span>
  );
}

function ModelsSection() {
  return (
    <>
      <SettingsSectionHeader
        label="Models"
        description="Defaults for the main plan/design/build workflows. Per-tab overrides still win."
      />
      <SettingsRow label="Default" description="Used unless a tab or agent specifies otherwise.">
        <span className="settings-page__meta">opus-4.7</span>
      </SettingsRow>
      <SettingsRow label="Local (on-device)" description="Apple Foundation Models or MLX, selected automatically.">
        <span className="settings-page__meta">mlx · auto</span>
      </SettingsRow>
    </>
  );
}

function PreferencesSection() {
  return (
    <>
      <SettingsSectionHeader
        label="Preferences"
        description="Default behaviors across projects. Per-project overrides still apply."
      />
      {/* TODO(DP-C): re-add a "Default autonomy" row once we wire a real
          global default that backs the per-project autonomy override
          (currently per-project only via HomeTab's SegmentedToggle).
          Audit table: core-docs/plan.md § Feature readiness. */}
      <SettingsRow
        label="Show cost in topbar"
        description="Adds a chip to the workspace topbar showing spend against the cap. Off by default — turn on if you want spend visible at all times."
      >
        <CostChipToggle />
      </SettingsRow>
      <SettingsRow
        label="Show placeholder Models section"
        description="The Models pane is a placeholder — defaults are static and not yet selectable. Off by default; flip on if you want to peek at the planned layout."
      >
        <ModelsSectionToggle />
      </SettingsRow>
      <SettingsRow
        label="Show all artifacts in activity rail"
        description="Surfaces every artifact event — including per-tool-use 'Used Read / Used Edit' cards — in the right-hand rail. Off by default; flip on for debugging when triaging what the orchestrator emitted."
      >
        <SpineAllArtifactsToggle />
      </SettingsRow>
      <SettingsRow
        label="Show roadmap canvas (Phase 22.A preview)"
        description="Renders the Roadmap canvas as the lead surface on the project Home tab. Off by default — when on, replaces the Active workspaces, Autonomy, and Needs-your-attention sections at project altitude."
      >
        <RoadmapCanvasToggle />
      </SettingsRow>
      <SettingsRow
        label="Show Recent Reports on Home"
        description="Adds a curated highlights surface to the project Home tab — recent shipped work in plain language, with a chip for the kind of change and a link to the PR. Off by default during initial rollout."
      >
        <RecentReportsToggle />
      </SettingsRow>
    </>
  );
}

function RoadmapCanvasToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setEnabled(f.show_roadmap_canvas);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const onChange = async (next: "on" | "off") => {
    const wantOn = next === "on";
    setEnabled(wantOn);
    try {
      const updated = await ipcClient().setFeatureFlag(
        "show_roadmap_canvas",
        wantOn,
      );
      setEnabled(updated.show_roadmap_canvas);
    } catch {
      setEnabled(!wantOn);
    }
  };
  return (
    <div data-component="RoadmapCanvasToggle">
      <SegmentedToggle<"on" | "off">
        ariaLabel="Show roadmap canvas on Home tab"
        value={enabled === null ? "off" : enabled ? "on" : "off"}
        onChange={onChange}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />
    </div>
  );
}

function ModelsSectionToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setEnabled(f.show_models_section);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const onChange = async (next: "on" | "off") => {
    const wantOn = next === "on";
    setEnabled(wantOn);
    try {
      const updated = await ipcClient().setFeatureFlag(
        "show_models_section",
        wantOn,
      );
      setEnabled(updated.show_models_section);
    } catch {
      // Roll back the optimistic flip; preference write failed.
      setEnabled(!wantOn);
    }
  };
  return (
    <div data-component="ModelsSectionToggle">
      <SegmentedToggle<"on" | "off">
        ariaLabel="Show placeholder Models section"
        value={enabled === null ? "off" : enabled ? "on" : "off"}
        onChange={onChange}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />
    </div>
  );
}

function RecentReportsToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setEnabled(f.show_recent_reports_v2);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const onChange = async (next: "on" | "off") => {
    const wantOn = next === "on";
    setEnabled(wantOn);
    try {
      const updated = await ipcClient().setFeatureFlag(
        "show_recent_reports_v2",
        wantOn,
      );
      setEnabled(updated.show_recent_reports_v2);
    } catch {
      setEnabled(!wantOn);
    }
  };
  return (
    <div data-component="RecentReportsToggle">
      <SegmentedToggle<"on" | "off">
        ariaLabel="Show Recent Reports on Home"
        value={enabled === null ? "off" : enabled ? "on" : "off"}
        onChange={onChange}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />
    </div>
  );
}

function SpineAllArtifactsToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setEnabled(f.show_all_artifacts_in_spine);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const onChange = async (next: "on" | "off") => {
    const wantOn = next === "on";
    setEnabled(wantOn);
    try {
      const updated = await ipcClient().setFeatureFlag(
        "show_all_artifacts_in_spine",
        wantOn,
      );
      setEnabled(updated.show_all_artifacts_in_spine);
    } catch {
      setEnabled(!wantOn);
    }
  };
  return (
    <div data-component="SpineAllArtifactsToggle">
      <SegmentedToggle<"on" | "off">
        ariaLabel="Show all artifacts in activity rail"
        value={enabled === null ? "off" : enabled ? "on" : "off"}
        onChange={onChange}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />
    </div>
  );
}

function CostChipToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    ipcClient()
      .getCostChipPreference()
      .then((p) => {
        if (!cancelled) setEnabled(p.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null) return <span className="settings-page__meta">checking…</span>;

  const choose = async (next: "off" | "on") => {
    const desired = next === "on";
    setEnabled(desired);
    try {
      const pref = await ipcClient().setCostChipPreference(desired);
      window.dispatchEvent(
        new CustomEvent(COST_CHIP_PREFERENCE_EVENT, { detail: pref }),
      );
    } catch {
      // Roll back on failure so the UI doesn't lie about persisted state.
      setEnabled(!desired);
    }
  };

  return (
    <SegmentedToggle<"off" | "on">
      ariaLabel="Show cost in topbar"
      value={enabled ? "on" : "off"}
      onChange={(v) => void choose(v)}
      options={[
        { value: "off", label: "Off", tooltip: "Hide the cost chip" },
        { value: "on", label: "On", tooltip: "Show spend vs cap" },
      ]}
    />
  );
}

function SettingsSectionHeader({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <header className="settings-page__section-header">
      <h2 className="settings-page__section-title">{label}</h2>
      <p className="settings-page__section-description">{description}</p>
    </header>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-page__row">
      <div className="settings-page__row-text">
        <span className="settings-page__row-label">{label}</span>
        <span className="settings-page__row-description">{description}</span>
      </div>
      <div className="settings-page__row-control">{children}</div>
    </section>
  );
}

function ThemePicker() {
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());

  useEffect(() => {
    const unsub = subscribeTheme((m) => setMode(m));
    return unsub;
  }, []);

  return (
    <SegmentedToggle<ThemeMode>
      ariaLabel="Theme"
      value={mode}
      onChange={setThemeMode}
      options={[
        { value: "system", label: "System", tooltip: "Follow macOS appearance" },
        { value: "light", label: "Light", tooltip: "Force light mode" },
        { value: "dark", label: "Dark", tooltip: "Force dark mode" },
      ]}
    />
  );
}

/**
 * Activity section — hosts Friction (Track 13.K) and "Designer noticed"
 * (Phase 21.A1). Settings IA is locked here per `roadmap.md` §"Settings
 * IA (locked)" — both feature owners share this section.
 */
function ActivitySection() {
  const activeProjectId = useAppState((s) => s.activeProject);
  const [tab, setTab] = useState<"noticed" | "friction">("friction");
  return (
    <>
      <SettingsSectionHeader
        label="Activity"
        description="Capture friction as you work and review what Designer's been noticing across this project."
      />
      <div className="activity-section__tabs">
        <SegmentedToggle<"noticed" | "friction">
          ariaLabel="Activity sub-page"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "friction",
              label: "Friction",
              tooltip: "Captured friction reports and triage state",
            },
            {
              value: "noticed",
              label: "Designer noticed",
              tooltip: "Findings from the learning layer",
            },
          ]}
        />
      </div>
      {tab === "friction" && <FrictionTriageSection />}
      {tab === "noticed" && <DesignerNoticedPage projectId={activeProjectId} />}
    </>
  );
}

// Drops the explicit "addressed" chip per the agent-driven triage redesign:
// the user only cares about "still on me" vs "done". Addressed entries
// (rows the agent has touched but not yet resolved) fold under "Open" with
// a visual marker so the user can still see "agent is on it" without
// clicking. Mark-addressed itself is now exclusively the agent's job via
// `designer friction address` — no FE path remains.
type FrictionFilter = "open" | "resolved" | "all";

interface FilterDef {
  value: FrictionFilter;
  label: string;
}

const FILTERS: FilterDef[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

type RowAction = "resolve" | "reopen" | "show-record" | "show-screenshot";

// Slightly longer than `--motion-emphasized` (400ms) so the
// `data-just-updated` attribute lingers a beat past the animation —
// avoids the attribute clearing mid-frame and aborting the flash.
const FLASH_TIMER_MS = 600;

/// Parse a GitHub PR URL into `owner/repo#123` for the row-meta chip.
/// Returns the raw host fallback if the URL doesn't match the expected
/// shape — better to surface *something* than to drop the chip silently.
function shortPrLabel(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (m) return `${m[1]}/${m[2]}#${m[3]}`;
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

/// Exported so the test suite can mount the section in isolation
/// without booting the full SettingsPage.
export function FrictionTriageSection() {
  const [entries, setEntries] = useState<FrictionEntry[] | null>(null);
  const [filter, setFilter] = useState<FrictionFilter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Highlight rows whose state changed since the last fetch so an
  // external refresh (CLI write, optimistic update) is *visible*. Set
  // is the source of truth; per-id timers in the ref clear entries
  // ~1.8s after they're added.
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(() => new Set());
  const prevStateRef = useRef<Map<string, FrictionState> | null>(null);
  const flashTimersRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (entries === null) return;
    const next = new Map(entries.map((e) => [e.friction_id, e.state] as const));
    const prev = prevStateRef.current;
    prevStateRef.current = next;
    // First fetch is the baseline — don't flash everything on mount.
    if (prev === null) return;
    const changed: string[] = [];
    for (const [id, state] of next) {
      const before = prev.get(id);
      // Either a state transition OR a brand-new id (external creation).
      if (before === undefined || before !== state) changed.push(id);
    }
    if (changed.length === 0) return;
    setRecentlyUpdated((curr) => {
      const merged = new Set(curr);
      for (const id of changed) merged.add(id);
      return merged;
    });
    for (const id of changed) {
      const existing = flashTimersRef.current.get(id);
      if (existing !== undefined) window.clearTimeout(existing);
      // Slightly longer than `--motion-emphasized` (400ms) so the
      // attribute clears after the animation has finished playing.
      const handle = window.setTimeout(() => {
        flashTimersRef.current.delete(id);
        setRecentlyUpdated((curr) => {
          if (!curr.has(id)) return curr;
          const next2 = new Set(curr);
          next2.delete(id);
          return next2;
        });
      }, FLASH_TIMER_MS);
      flashTimersRef.current.set(id, handle);
    }
  }, [entries]);
  useEffect(
    () => () => {
      for (const handle of flashTimersRef.current.values()) {
        window.clearTimeout(handle);
      }
      flashTimersRef.current.clear();
    },
    [],
  );

  // Initial load — apply the projection synchronously and auto-fall-through
  // from the default "Open" filter to "All" when there's history but no
  // open *or* addressed items, so the user doesn't land on a dead empty
  // state. "Open" includes addressed (agent-owned) rows since the redesign.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await ipcClient().listFriction();
        if (cancelled) return;
        setEntries(list);
        if (
          list.length > 0 &&
          list.every((e) => e.state !== "open" && e.state !== "addressed")
        ) {
          setFilter("all");
        }
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch when the on-disk event store changes externally — the most
  // common trigger is the `designer` CLI's `friction address|resolve|
  // reopen` (the dogfood "ask Claude to fix it" loop). Deliberately
  // does NOT touch `filter`: external writes shouldn't bounce the user
  // off the chip they're sitting on.
  useEffect(() => {
    let cancelled = false;
    const off = ipcClient().onStoreChanged(() => {
      void (async () => {
        try {
          const list = await ipcClient().listFriction();
          if (!cancelled) setEntries(list);
        } catch {
          // Swallow — the next refresh (or a manual tab bounce) will
          // recover. A toast on every transient fs hiccup would be
          // worse than the silent retry.
        }
      })();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const counts = useMemo(() => {
    let openOrAddressed = 0;
    let resolved = 0;
    let addressed = 0;
    let all = 0;
    for (const e of entries ?? []) {
      all += 1;
      if (e.state === "open" || e.state === "addressed") openOrAddressed += 1;
      if (e.state === "resolved") resolved += 1;
      if (e.state === "addressed") addressed += 1;
    }
    return { open: openOrAddressed, resolved, all, addressed };
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    if (filter === "all") return entries;
    if (filter === "open") {
      return entries.filter((e) => e.state === "open" || e.state === "addressed");
    }
    return entries.filter((e) => e.state === filter);
  }, [entries, filter]);

  const filterOptions = useMemo(
    () =>
      FILTERS.map((f) => ({
        value: f.value,
        label: `${f.label} (${counts[f.value]})`,
      })),
    [counts],
  );

  // Group rows by humanized anchor so reports filed against the same
  // surface visually cluster — sets the agent's mental model ("fix the
  // cluster") and dedups visual noise. Single-anchor groups render flat
  // (no header). Order within each group preserves the projection's
  // most-recent-first sort; group order matches the first row's position
  // in `filtered` so the most recently active surface stays at the top.
  const clusters = useMemo(() => {
    if (!filtered) return null;
    const order: string[] = [];
    const map = new Map<string, FrictionEntry[]>();
    for (const e of filtered) {
      const key = e.anchor_descriptor || "(unanchored)";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(e);
    }
    return order.map((key) => ({
      key,
      label: humanizeAnchor(key),
      rows: map.get(key)!,
    }));
  }, [filtered]);

  // Empty-state copy keyed by filter. Note: the "Open" filter folds
  // addressed (agent-owned) rows in, so when the Open list is empty it's
  // empty for real — there's no need for a separate "all caught up but
  // the agent has work in flight" message. (That path was considered
  // pre-implementation but is unreachable: if addressed > 0, the rows
  // are visible.)
  const emptyCopy = useMemo(() => {
    if (filter === "resolved") return "Nothing resolved yet.";
    if (filter === "all") return "No friction captured yet. Press ⌘⇧F to start.";
    return "No open friction. Press ⌘⇧F to capture something.";
  }, [filter]);

  // Apply a state transition optimistically + dispatch the IPC call. Keeps
  // the UI responsive even on a large event store; the next refresh
  // reconciles if the backend ever rejects.
  const runAction = async (entry: FrictionEntry, action: RowAction) => {
    if (action === "show-record") {
      if (entry.local_path) await ipcClient().revealInFinder(entry.local_path);
      return;
    }
    if (action === "show-screenshot") {
      if (entry.screenshot_path) await ipcClient().revealInFinder(entry.screenshot_path);
      return;
    }
    setBusyId(entry.friction_id);
    setEntries((prev) =>
      prev
        ? prev.map((e) =>
            e.friction_id === entry.friction_id
              ? { ...e, state: action === "reopen" ? "open" : "resolved" }
              : e,
          )
        : prev,
    );
    try {
      const client = ipcClient();
      const req = { friction_id: entry.friction_id, workspace_id: entry.workspace_id };
      await (action === "reopen" ? client.reopenFriction(req) : client.resolveFriction(req));
    } finally {
      setBusyId(null);
    }
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <SettingsSectionHeader
        label="Friction"
        description="Capture internal feedback via the bottom-right button or ⌘⇧F. Reports persist as local markdown files in the linked repo (gitignored by default). The Triage button hands the active set to an agent — your job is to file, not sort."
      />
      <div className="friction-triage__filters">
        <SegmentedToggle<FrictionFilter>
          ariaLabel="Filter friction by state"
          value={filter}
          onChange={setFilter}
          options={filterOptions}
        />
        <CopyBatchPromptButton entries={filtered} filter={filter} />
      </div>
      {filtered === null ? (
        <ul className="friction-triage" aria-label={`Friction — ${filter}`}>
          <li className="friction-triage__empty">Loading…</li>
        </ul>
      ) : filtered.length === 0 ? (
        <ul className="friction-triage" aria-label={`Friction — ${filter}`}>
          <li className="friction-triage__empty">{emptyCopy}</li>
        </ul>
      ) : (
        <div className="friction-triage" aria-label={`Friction — ${filter}`}>
          {clusters!.map((c) => (
            <FrictionCluster
              key={c.key}
              label={c.label}
              count={c.rows.length}
              showHeader={c.rows.length > 1}
            >
              {c.rows.map((e) => (
                <FrictionRow
                  key={e.friction_id}
                  entry={e}
                  expanded={expanded.has(e.friction_id)}
                  busy={busyId === e.friction_id}
                  justUpdated={recentlyUpdated.has(e.friction_id)}
                  onToggle={() => toggleExpanded(e.friction_id)}
                  onAction={(action) => runAction(e, action)}
                />
              ))}
            </FrictionCluster>
          ))}
        </div>
      )}
    </>
  );
}

/// Group of rows sharing an `anchor_descriptor`. Single-row clusters
/// render flat (no header) so the redesign doesn't add visual noise to
/// the most common case (one report, one place). Multi-row clusters get
/// a small header that reads as the agent's mental model: "fix the
/// cluster," not "fix each row."
function FrictionCluster({
  label,
  count,
  showHeader,
  children,
}: {
  label: string;
  count: number;
  showHeader: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="friction-triage__cluster">
      {showHeader && (
        <header className="friction-triage__cluster-header">
          <span className="friction-triage__cluster-name">{label}</span>
          <span aria-hidden="true">·</span>
          <span className="friction-triage__cluster-count">
            {count} reports
          </span>
        </header>
      )}
      <ul className="friction-triage__cluster-rows" role="list">
        {children}
      </ul>
    </section>
  );
}

/// Convert an `anchor_descriptor` (developer-shaped string from
/// `Anchor::descriptor()` in `designer-core`) to something a manager can
/// read. PascalCase components → spaced words; routes → breadcrumb;
/// already-prefixed shapes ("tool:Read", "message X", "src/foo.rs:10-12")
/// pass through unchanged because they're already legible.
export function humanizeAnchor(descriptor: string): string {
  if (!descriptor) return "Unanchored";
  if (descriptor.startsWith("/")) {
    const parts = descriptor.split("/").filter(Boolean);
    if (parts.length === 0) return "Home";
    return parts
      .map((p) =>
        p
          .replace(/[-_]/g, " ")
          .replace(/\b([a-z])/g, (_, c) => c.toUpperCase()),
      )
      .join(" › ");
  }
  if (/^[A-Z][A-Za-z0-9]+$/.test(descriptor)) {
    return descriptor.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  }
  return descriptor;
}

/// Compact relative-time label for the row meta line. The previous
/// `toLocaleString()` (e.g., "5/3/2026, 2:45:30 PM") wraps badly at the
/// 960px min window; "2h ago" / "3d ago" reads as the manager-grade
/// "when, roughly" the surface actually wants. Falls back to a compact
/// month+day for anything older than a week, plus a year suffix when the
/// entry is older than the current calendar year. Pure for unit-testing;
/// the row passes a stable `now` only in tests — production calls fall
/// through to `Date.now()` so the relative read keeps ticking forward
/// across re-renders without explicit time wiring.
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = now - then;
  // Future or clock skew → don't render a negative duration; treat the
  // entry as fresh and let the next refresh reconcile the wall clock.
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const month = d.toLocaleString(undefined, { month: "short" });
  return sameYear ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

/// One row in the master list. Split out so the row is a `<li>` with
/// non-nested-button siblings (chevron toggle + ⋯ menu) rather than the
/// row-summary `<button>` containing other buttons — invalid HTML.
///
/// Per the agent-driven triage redesign:
/// - The row chrome is title + state + ⋯; everything else collapses into
///   the menu so the content can breathe.
/// - "Addressed" rows surface an inline `agent · …` marker so the user
///   can see "the agent is on it" without having to switch filters or
///   expand the row. This is the trust signal that lets "Open" silently
///   contain agent-owned rows.
function FrictionRow({
  entry: e,
  expanded,
  busy,
  justUpdated,
  onToggle,
  onAction,
}: {
  entry: FrictionEntry;
  expanded: boolean;
  busy: boolean;
  justUpdated: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void | Promise<void>;
}) {
  return (
    <li
      className="friction-triage__row"
      data-state={e.state}
      data-just-updated={justUpdated || undefined}
      data-component="FrictionTriageRow"
    >
      <button
        type="button"
        className="friction-triage__toggle"
        aria-expanded={expanded}
        aria-controls={`friction-detail-${e.friction_id}`}
        onClick={onToggle}
      >
        <ChevronRight
          className="friction-triage__chevron"
          size={14}
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <span className="friction-triage__title" title={e.title}>
          {e.title || e.body}
        </span>
        <span className="friction-triage__meta">
          <span className="friction-triage__state" data-state={e.state}>
            <span className="friction-triage__state-dot" aria-hidden="true" />
            {e.state}
          </span>
          {e.state === "addressed" && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="friction-triage__agent"
                title="An agent is working on this report — it will move to Resolved when the PR lands."
              >
                {e.pr_url ? `agent · ${shortPrLabel(e.pr_url)}` : "agent · working"}
              </span>
            </>
          )}
          {e.state === "resolved" && e.pr_url && (
            <>
              <span aria-hidden="true">·</span>
              <span className="friction-triage__pr">{shortPrLabel(e.pr_url)}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span title={new Date(e.created_at).toLocaleString()}>
            {formatRelativeTime(e.created_at)}
          </span>
        </span>
      </button>
      <div className="friction-triage__actions">
        <FrictionRowMenu entry={e} busy={busy} onAction={onAction} />
      </div>
      {expanded && (
        <div
          className="friction-triage__detail"
          id={`friction-detail-${e.friction_id}`}
        >
          {e.body && <p className="friction-triage__body">{e.body}</p>}
          {e.screenshot_path && (
            <button
              type="button"
              className="friction-triage__screenshot-link"
              onClick={() => onAction("show-screenshot")}
            >
              Show screenshot in Finder
            </button>
          )}
          {e.pr_url && (
            <div className="friction-triage__pr-link">
              PR:{" "}
              <a href={e.pr_url} target="_blank" rel="noreferrer noopener">
                {e.pr_url}
              </a>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/// ⋯ menu trigger + popover. Hand-rolled (no Mini Menu primitive yet —
/// see pattern-log entry 2026-05-03 "FrictionRowMenu inline popover" for
/// the rationale). When the second menu need lands we'll promote this to
/// a real primitive; until then a 60-line one-off is cheaper than a new
/// archetype.
///
/// Behavior: click trigger toggles. ESC closes + restores focus to the
/// trigger. Click outside closes. Items render conditionally on row
/// state — Resolved hides "Mark resolved", Open hides "Reopen". Disabled
/// items are still rendered (greyed) so menu height doesn't dance
/// between rows.
function FrictionRowMenu({
  entry: e,
  busy,
  onAction,
}: {
  entry: FrictionEntry;
  busy: boolean;
  onAction: (action: RowAction) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { copied: pathCopied, copy: copyPath } = useCopyWithFeedback();
  const { copied: promptCopied, copy: copyPrompt } = useCopyWithFeedback();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Auto-focus the first menu item when the menu opens, so the keyboard
  // path ("Tab to ⋯, Enter, ↓ to choose") works without a hover.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      "[role='menuitem']:not([disabled])",
    );
    first?.focus();
  }, [open]);

  const close = () => setOpen(false);
  const run = async (action: RowAction) => {
    close();
    await onAction(action);
  };

  return (
    <div className="friction-triage__menu-wrap">
      <IconButton
        ref={triggerRef}
        size="sm"
        label="More actions"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
      >
        <MoreHorizontal size={14} strokeWidth={1.6} aria-hidden="true" />
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          className="friction-triage__menu"
          role="menu"
          aria-label={`Actions for ${e.title || "report"}`}
        >
          <button
            type="button"
            role="menuitem"
            className="friction-triage__menu-item"
            disabled={!e.local_path}
            onClick={async () => {
              if (!e.local_path) return;
              await copyPrompt(buildAgentPrompt(e));
              close();
            }}
          >
            {promptCopied ? "Copied!" : "Copy prompt for agent"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="friction-triage__menu-item"
            disabled={!e.local_path}
            onClick={() => void run("show-record")}
          >
            Show in Finder
          </button>
          <button
            type="button"
            role="menuitem"
            className="friction-triage__menu-item"
            disabled={!e.local_path}
            onClick={async () => {
              if (!e.local_path) return;
              await copyPath(e.local_path);
              close();
            }}
          >
            {pathCopied ? "Copied!" : "Copy path"}
          </button>
          <div
            className="friction-triage__menu-sep"
            role="separator"
            aria-hidden="true"
          />
          {e.state !== "resolved" && (
            <button
              type="button"
              role="menuitem"
              className="friction-triage__menu-item"
              onClick={() => void run("resolve")}
            >
              Mark resolved
            </button>
          )}
          {e.state !== "open" && (
            <button
              type="button"
              role="menuitem"
              className="friction-triage__menu-item"
              onClick={() => void run("reopen")}
            >
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/// Copy `text` to the clipboard and flip the button label to a confirm
/// state for ~1.4s. Hook so the two row-level copy buttons share one
/// feedback path without duplicating timer + cleanup wiring.
function useCopyWithFeedback(): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can fail in non-secure contexts. Stay silent — the
      // path is also reachable via "Show in Finder", and a thrown alert
      // would punish a corner case (browser dev preview, no HTTPS).
    }
  };
  return { copied, copy };
}

/// Single source of truth for the close-the-loop CLI invocation that
/// gets baked into every agent prompt. Both `buildAgentPrompt` (one
/// row) and `buildBatchAgentPrompt` (filter bundle) reference this so a
/// future change to the CLI surface only needs one edit.
const ADDRESS_CLI = "designer friction address";

/// Build a self-contained prompt that hands an external agent (Claude Code,
/// Codex CLI, etc.) everything needed to read the report and close the
/// loop with `designer friction address`. The id is baked in so the user
/// doesn't have to remember the round-trip command.
function buildAgentPrompt(entry: FrictionEntry): string {
  const lines = [
    "Read this Designer friction report and propose a fix:",
    entry.local_path,
    "",
    "After opening a PR, close the loop:",
    `${ADDRESS_CLI} ${entry.friction_id} --pr <PR_URL>`,
  ];
  return lines.join("\n");
}

/// Build a single prompt that bundles every entry currently shown by the
/// filter so the user can hand the whole batch to one agent session
/// rather than dispatching them one at a time. Each entry contributes a
/// path; the agent reads the records itself. The header phrasing
/// adapts to the active filter so "open" / "addressed" reads as a noun
/// modifier rather than the literal token.
function buildBatchAgentPrompt(entries: FrictionEntry[], filter: FrictionFilter): string {
  if (entries.length === 0) return "";
  const stateLabel = filter === "all" ? "" : `${filter} `;
  const lines: string[] = [
    `You are triaging ${entries.length} ${stateLabel}Designer friction reports.`,
    "",
    "Reports:",
  ];
  for (const e of entries) {
    if (e.local_path) lines.push(`- ${e.local_path}`);
  }
  lines.push(
    "",
    "Do all of the following:",
    "1. Read every report.",
    "2. Cluster reports that describe the same root cause or touch the same surface; treat each cluster as one unit of work.",
    "3. For each cluster, plan the smallest correct fix and ship it as a single PR (one PR per cluster, not per report).",
    "4. As soon as a cluster's PR is open, run this for every friction id in that cluster so the user sees the agent picked it up:",
    "",
    `   ${ADDRESS_CLI} <friction_id> --pr <PR_URL>`,
    "",
    "5. After the PR is merged, mark each id resolved:",
    "",
    "   designer friction resolve <friction_id>",
    "",
    "6. If a report is invalid, already fixed, or a duplicate, mark it resolved and add a one-line note in the PR or the closing comment.",
    "",
    "(Friction ids are the `frc_…` slug at the start of each filename.)",
  );
  return lines.join("\n");
}

/// Section-level primary CTA: copies a single prompt that hands the
/// active filter to an agent for triage (cluster, plan, ship one PR per
/// cluster, close the loop). The visual primary register signals "this
/// is the path you should be using" — the per-row menu's "Copy prompt"
/// is the fallback for one-off dispatch.
///
/// The component accepts `entries: FrictionEntry[] | null` so the parent
/// can pass `filtered` directly without a `?? []` fallback that would
/// briefly render a count-bearing label during the initial fetch.
/// `null` → loading register (no count, disabled); `[]` → loaded-empty
/// register (no count, disabled); `[…]` → ready (count, enabled).
function CopyBatchPromptButton({
  entries,
  filter,
}: {
  entries: FrictionEntry[] | null;
  filter: FrictionFilter;
}) {
  const { copied, copy } = useCopyWithFeedback();
  const usable = entries?.filter((e) => e.local_path) ?? [];
  const ready = entries !== null;
  const disabled = !ready || usable.length === 0;
  // Label hides the count in both the loading and loaded-empty states
  // so the user never sees an honest-but-noisy "Triage 0" mid-fetch.
  const label =
    !ready || usable.length === 0
      ? "Triage with agent"
      : `Triage ${usable.length} with agent`;
  const title = !ready
    ? "Loading friction records…"
    : disabled
      ? "No friction records in this filter"
      : `Hand ${usable.length} ${filter} report${usable.length === 1 ? "" : "s"} to an agent — it will cluster, plan, ship PRs, and close the loop`;
  return (
    <button
      type="button"
      className="btn friction-triage__batch-copy"
      data-variant="primary"
      disabled={disabled}
      onClick={() => copy(buildBatchAgentPrompt(usable, filter))}
      title={title}
      aria-live="polite"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

