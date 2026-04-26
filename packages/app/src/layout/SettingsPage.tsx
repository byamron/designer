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

/**
 * Settings as a full-screen page — replaces the entire AppShell while
 * open. Previously a modal dialog; user feedback: settings are global
 * and deserve the real page register rather than a popover that covers
 * only part of the app. Sections live in a left rail (same visual
 * structure as the workspace sidebar), with the selected section
 * occupying the main area. Escape or the "Back to app" button returns
 * to the workspace.
 */

type SettingsSection = "appearance" | "account" | "models" | "preferences";

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
    <div className="settings-page" role="region" aria-label="Settings">
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
    </>
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
