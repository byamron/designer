import { useEffect } from "react";
import { Agentation } from "agentation";
import { AppShell } from "./layout/AppShell";
import { QuickSwitcher } from "./layout/QuickSwitcher";
import { SettingsPage } from "./layout/SettingsPage";
import { Onboarding } from "./components/Onboarding";
import { AppDialog } from "./components/AppDialog";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { SurfaceDevPanel } from "./components/SurfaceDevPanel";
import { Titlebar } from "./components/Titlebar";
import { FrictionButton } from "./components/Friction/FrictionButton";
import { SelectionOverlay } from "./components/Friction/SelectionOverlay";
import { FrictionWidget } from "./components/Friction/FrictionWidget";
import { bootData, dataStore, useDataState } from "./store/data";
import {
  appStore,
  closeDialog,
  openCreateProject,
  openDialog,
  selectProject,
  toggleProjectStrip,
  toggleQuickSwitcher,
  toggleSidebar,
  toggleSpine,
  useAppState,
} from "./store/app";
import { isTauri, listen } from "./ipc/tauri";

export function App() {
  const loaded = useDataState((s) => s.loaded);
  const dialog = useAppState((s) => s.dialog);

  useEffect(() => {
    void (async () => {
      await bootData();
      const s = appStore.get();
      const { projects } = dataStore.get();
      if (!s.activeProject && projects.length > 0) {
        selectProject(projects[0].project.id);
      }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleQuickSwitcher();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        toggleProjectStrip();
      } else if (mod && e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.key === "]") {
        e.preventDefault();
        toggleSpine();
      } else if (mod && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        e.preventDefault();
        openDialog("help");
      } else if (e.key === "Escape") {
        toggleQuickSwitcher(false);
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    return listen<void>("designer://menu/new-project", () => {
      openCreateProject();
    });
  }, []);

  // Settings takes over the entire viewport — it's a full page, not a
  // modal. The AppDialog component continues to handle "help".
  const settingsOpen = dialog === "settings";
  const isDev = import.meta.env.MODE === "development";

  return (
    <>
      <Titlebar />
      {!loaded ? (
        <BootingStatus />
      ) : (
        <>
          {settingsOpen ? <SettingsPage /> : <AppShell />}
          <QuickSwitcher />
          <AppDialog />
          <CreateProjectModal />
          <Onboarding />
          {/* Track 13.K — Friction. Bottom-right is reserved for the
              FrictionButton; the dev panel was relocated to bottom-left
              as part of this work. */}
          <FrictionButton />
          <SelectionOverlay />
          <FrictionWidget />
          {isDev && <SurfaceDevPanel />}
          {isDev && <Agentation />}
        </>
      )}
    </>
  );
}

function BootingStatus() {
  return (
    <div role="status" aria-live="polite" className="app-booting">
      Booting…
    </div>
  );
}
