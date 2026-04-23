import { useEffect } from "react";
import { Agentation } from "agentation";
import { AppShell } from "./layout/AppShell";
import { QuickSwitcher } from "./layout/QuickSwitcher";
import { Onboarding } from "./components/Onboarding";
import { AppDialog } from "./components/AppDialog";
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
} from "./store/app";
import { isTauri, listen } from "./ipc/tauri";

export function App() {
  const loaded = useDataState((s) => s.loaded);

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

  return (
    <>
      <AppShell />
      <QuickSwitcher />
      <AppDialog />
      <Onboarding />
      {import.meta.env.MODE === "development" && <Agentation />}
    </>
  );
}
