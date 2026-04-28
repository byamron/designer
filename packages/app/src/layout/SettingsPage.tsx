import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { closeDialog, useAppState } from "../store/app";
import { useDataState } from "../store/data";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { RepoLinkModal } from "../components/RepoLinkModal";
import { DesignerNoticedPage } from "../components/DesignerNoticed";
import { IconButton } from "../components/IconButton";
import { IconX } from "../components/icons";
import { messageFromError, useFocusTrap } from "../lib/modal";
import { emptyArray } from "../util/empty";
import type { Workspace, WorkspaceSummary } from "../ipc/types";
import {
  getThemeMode,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from "../theme";
import { ipcClient } from "../ipc/client";
import type { FrictionEntry, KeychainStatus } from "../ipc/types";
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
            {SECTIONS.map((section) => (
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

function AccountSection() {
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
  const summaries = useDataState<WorkspaceSummary[]>((s) =>
    activeProjectId ? s.workspaces[activeProjectId] ?? emptyArray() : emptyArray(),
  );
  const targetWorkspace: Workspace | null = useMemo(() => {
    if (!summaries.length) return null;
    if (activeWorkspaceId) {
      const match = summaries.find((s) => s.workspace.id === activeWorkspaceId);
      if (match) return match.workspace;
    }
    return summaries[0].workspace;
  }, [summaries, activeWorkspaceId]);
  const [linkOpen, setLinkOpen] = useState(false);
  const linkedPath = targetWorkspace?.worktree_path ?? null;

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
      <SettingsRow
        label="Repository"
        description={
          targetWorkspace
            ? `Linked to the active workspace "${targetWorkspace.name}".`
            : "Open a workspace to link a repository."
        }
      >
        {linkedPath ? (
          <span className="settings-page__meta">{linkedPath}</span>
        ) : (
          <span className="settings-page__meta">not linked</span>
        )}
        {targetWorkspace && (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            style={{ marginLeft: "var(--space-2)" }}
            onClick={() => setLinkOpen(true)}
          >
            {linkedPath ? "Re-link" : "Link"}
          </button>
        )}
      </SettingsRow>
      {targetWorkspace && (
        <RepoLinkModal
          workspaceId={targetWorkspace.id}
          initialPath={linkedPath ?? ""}
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
        />
      )}
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
      <SettingsRow label="Default autonomy" description="Suggest-only, act-on-approval, or scheduled autonomy.">
        <span className="settings-page__meta">suggest</span>
      </SettingsRow>
      <SettingsRow
        label="Show cost in topbar"
        description="Adds a chip to the workspace topbar showing spend against the cap. Off by default — turn on if you want spend visible at all times."
      >
        <CostChipToggle />
      </SettingsRow>
    </>
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

type FrictionFilter = "open" | "addressed" | "resolved" | "all";

interface FilterDef {
  value: FrictionFilter;
  label: string;
  emptyCopy: string;
}

const FILTERS: FilterDef[] = [
  {
    value: "open",
    label: "Open",
    emptyCopy: "No open friction. Press ⌘⇧F to capture something.",
  },
  {
    value: "addressed",
    label: "Addressed",
    emptyCopy: "Nothing addressed yet — items move here when you mark them addressed.",
  },
  { value: "resolved", label: "Resolved", emptyCopy: "Nothing resolved yet." },
  { value: "all", label: "All", emptyCopy: "No friction captured yet. Press ⌘⇧F to start." },
];

type RowAction = "address" | "resolve" | "reopen" | "show-record" | "show-screenshot";

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

function FrictionTriageSection() {
  const [entries, setEntries] = useState<FrictionEntry[] | null>(null);
  const [filter, setFilter] = useState<FrictionFilter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [addressTarget, setAddressTarget] = useState<FrictionEntry | null>(null);

  // Initial load — apply the projection synchronously and auto-fall-through
  // from the default "Open" filter to "All" when there's history but no
  // open items, so the user doesn't land on a dead empty state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await ipcClient().listFriction();
        if (cancelled) return;
        setEntries(list);
        if (list.length > 0 && list.every((e) => e.state !== "open")) {
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

  const counts = useMemo(() => {
    const c = { open: 0, addressed: 0, resolved: 0, all: 0 };
    for (const e of entries ?? []) {
      c.all += 1;
      c[e.state] += 1;
    }
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    return filter === "all" ? entries : entries.filter((e) => e.state === filter);
  }, [entries, filter]);

  const filterOptions = useMemo(
    () => FILTERS.map((f) => ({ value: f.value, label: `${f.label} (${counts[f.value]})` })),
    [counts],
  );

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
    if (action === "address") {
      setAddressTarget(entry);
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
        description="Internal feedback captured via the bottom-right button or ⌘⇧F. Records persist as local markdown files in the linked repo (gitignored by default)."
      />
      <div className="friction-triage__filters">
        <SegmentedToggle<FrictionFilter>
          ariaLabel="Filter friction by state"
          value={filter}
          onChange={setFilter}
          options={filterOptions}
        />
      </div>
      <ul className="friction-triage" aria-label={`Friction — ${filter}`}>
        {filtered === null ? (
          <li className="friction-triage__empty">Loading…</li>
        ) : filtered.length === 0 ? (
          <li className="friction-triage__empty">
            {FILTERS.find((f) => f.value === filter)?.emptyCopy}
          </li>
        ) : (
          filtered.map((e) => (
            <FrictionRow
              key={e.friction_id}
              entry={e}
              expanded={expanded.has(e.friction_id)}
              busy={busyId === e.friction_id}
              onToggle={() => toggleExpanded(e.friction_id)}
              onAction={(action) => runAction(e, action)}
            />
          ))
        )}
      </ul>
      {addressTarget && (
        <AddressFrictionDialog
          entry={addressTarget}
          onCancel={() => setAddressTarget(null)}
          onSubmit={async (prUrl) => {
            const target = addressTarget;
            setAddressTarget(null);
            setBusyId(target.friction_id);
            setEntries((prev) =>
              prev
                ? prev.map((e) =>
                    e.friction_id === target.friction_id
                      ? { ...e, state: "addressed", pr_url: prUrl }
                      : e,
                  )
                : prev,
            );
            try {
              await ipcClient().addressFriction({
                friction_id: target.friction_id,
                workspace_id: target.workspace_id,
                pr_url: prUrl,
              });
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}
    </>
  );
}

/// One row in the master list. Split out so the row is a `<li>` with
/// non-nested-button siblings (chevron toggle + actions row) rather than
/// the row-summary `<button>` containing other buttons — invalid HTML
/// that the previous draft tripped on.
function FrictionRow({
  entry: e,
  expanded,
  busy,
  onToggle,
  onAction,
}: {
  entry: FrictionEntry;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void | Promise<void>;
}) {
  return (
    <li
      className="friction-triage__row"
      data-state={e.state}
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
          <span aria-hidden="true">·</span>
          <span>{new Date(e.created_at).toLocaleString()}</span>
          <span aria-hidden="true">·</span>
          <span>{e.anchor_descriptor}</span>
          {e.pr_url && (
            <>
              <span aria-hidden="true">·</span>
              <span className="friction-triage__pr">{shortPrLabel(e.pr_url)}</span>
            </>
          )}
        </span>
      </button>
      <div className="friction-triage__actions">
        {(e.state === "open" || e.state === "addressed") && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onAction("address")}
          >
            {e.state === "open" ? "Mark addressed" : "Update PR"}
          </button>
        )}
        {e.state !== "resolved" && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onAction("resolve")}
          >
            Mark resolved
          </button>
        )}
        {e.state !== "open" && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onAction("reopen")}
          >
            Reopen
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={!e.local_path}
          onClick={() => onAction("show-record")}
        >
          Show in Finder
        </button>
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

function AddressFrictionDialog({
  entry,
  onCancel,
  onSubmit,
}: {
  entry: FrictionEntry;
  onCancel: () => void;
  onSubmit: (prUrl: string | null) => void | Promise<void>;
}) {
  const [value, setValue] = useState(entry.pr_url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useFocusTrap(dialogRef, { onEscape: onCancel, busy });

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      setError("Enter a full URL starting with http:// or https://, or leave it blank.");
      return;
    }
    setBusy(true);
    try {
      void onSubmit(trimmed.length > 0 ? trimmed : null);
    } catch (err) {
      setError(messageFromError(err, "mark addressed"));
      setBusy(false);
    }
  };

  return (
    <div
      className="app-dialog-scrim"
      data-component="AddressFrictionDialog"
      role="presentation"
      onClick={(e) => {
        // `click` fires only when both mousedown and mouseup land on the
        // scrim — so a drag started inside the card and released on the
        // scrim doesn't surprise-dismiss.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-friction-title"
      >
        <header className="app-dialog__head">
          <h2 className="app-dialog__title" id="address-friction-title">
            Mark addressed
          </h2>
          <IconButton label="Close" shortcut="Esc" onClick={onCancel} disabled={busy}>
            <IconX size={12} />
          </IconButton>
        </header>
        <div className="app-dialog__body">
          <section className="app-dialog__section">
            <span className="app-dialog__section-label">Friction</span>
            <p className="address-friction__entry-title" title={entry.title}>
              {entry.title}
            </p>
          </section>
          <section className="app-dialog__section" aria-label="PR URL">
            <label
              className="app-dialog__section-label"
              htmlFor="address-friction-pr"
            >
              PR URL (optional)
            </label>
            <input
              ref={inputRef}
              id="address-friction-pr"
              type="url"
              className="quick-switcher__input"
              placeholder="https://github.com/owner/repo/pull/123"
              value={value}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? "address-friction-error" : undefined}
              disabled={busy}
            />
            {error && (
              <p
                id="address-friction-error"
                role="alert"
                className="address-friction__error"
              >
                {error}
              </p>
            )}
          </section>
          <div className="address-friction__actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Saving…" : "Mark addressed"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
