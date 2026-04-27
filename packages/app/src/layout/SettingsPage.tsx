import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { closeDialog, useAppState } from "../store/app";
import { useDataState } from "../store/data";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { RepoLinkModal } from "../components/RepoLinkModal";
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
  | "activity-friction";

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
    // Track 13.K — locks the Activity IA section. 21.A1 will land
    // "Designer noticed" as a sibling here. Don't reshuffle without
    // updating both specs + pattern-log.md.
    id: "activity-friction",
    label: "Activity · Friction",
    description: "Captured friction reports and their triage state.",
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
            {active === "activity-friction" && <FrictionTriageSection />}
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

function FrictionTriageSection() {
  const [entries, setEntries] = useState<FrictionEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await ipcClient().listFriction();
      setEntries(list);
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <>
      <SettingsSectionHeader
        label="Friction"
        description="Internal feedback captured via the bottom-right button or ⌘⇧F. Filed entries link to GitHub issues; local-only entries can be filed later."
      />
      <div className="friction-triage">
        {entries === null ? (
          <div className="friction-triage__empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="friction-triage__empty">
            No friction captured yet. Press ⌘⇧F to start.
          </div>
        ) : (
          entries.map((e) => (
            <div className="friction-triage__row" key={e.friction_id}>
              <div>
                <div className="friction-triage__title" title={e.title}>
                  {e.title || e.body}
                </div>
                <div className="friction-triage__meta">
                  <span className="friction-triage__state" data-state={e.state}>
                    {e.state.replace("_", " ")}
                  </span>
                  {" · "}
                  {new Date(e.created_at).toLocaleString()}
                  {" · "}
                  {e.anchor_descriptor}
                  {e.error ? ` · ${e.error}` : ""}
                </div>
              </div>
              <div className="friction-triage__actions">
                {e.github_issue_url && (
                  <a
                    className="btn"
                    href={e.github_issue_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open
                  </a>
                )}
                {e.state !== "filed" && e.state !== "resolved" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === e.friction_id}
                    onClick={async () => {
                      setBusyId(e.friction_id);
                      try {
                        await ipcClient().retryFileFriction(e.friction_id);
                        await refresh();
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    File on GitHub
                  </button>
                )}
                {e.state !== "resolved" && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === e.friction_id}
                    onClick={async () => {
                      setBusyId(e.friction_id);
                      try {
                        await ipcClient().resolveFriction(e.friction_id);
                        await refresh();
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    Mark resolved
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
