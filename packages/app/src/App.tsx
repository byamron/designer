import { useEffect } from "react";
import { Agentation } from "agentation";
import { AppShell } from "./layout/AppShell";
import { QuickSwitcher } from "./layout/QuickSwitcher";
import { SettingsPage } from "./layout/SettingsPage";
import { Onboarding } from "./components/Onboarding";
import { AppDialog } from "./components/AppDialog";
import { SurfaceDevPanel } from "./components/SurfaceDevPanel";
import {
  bootData,
  dataStore,
  promptCreateProject,
  useDataState,
} from "./store/data";
import {
  appStore,
  closeDialog,
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
      void (async () => {
        const id = await promptCreateProject();
        if (id) selectProject(id);
      })();
    });
  }, []);

  if (!loaded) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "var(--color-muted)",
        }}
      >
        Booting…
      </div>
    );
  }

  // Settings takes over the entire viewport — it's a full page, not a
  // modal. The AppDialog component continues to handle "help" (which
  // remains modal — short, informational, doesn't warrant a page).
  const settingsOpen = dialog === "settings";

  return (
    <>
      {settingsOpen ? <SettingsPage /> : <AppShell />}
      <QuickSwitcher />
      <AppDialog />
      <Onboarding />
      {import.meta.env.MODE === "development" && <SurfaceDevPanel />}
      {import.meta.env.MODE === "development" && <Agentation />}
    </>
  );
}
