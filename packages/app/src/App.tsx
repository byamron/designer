import { useEffect } from "react";
import { Agentation } from "agentation";
import { AppShell } from "./layout/AppShell";
import { QuickSwitcher } from "./layout/QuickSwitcher";
import { Onboarding } from "./components/Onboarding";
import { bootData, dataStore, useDataState } from "./store/data";
import {
  appStore,
  selectProject,
  toggleProjectStrip,
  toggleQuickSwitcher,
} from "./store/app";

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleQuickSwitcher();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleProjectStrip();
      } else if (e.key === "Escape") {
        toggleQuickSwitcher(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      <Onboarding />
      {import.meta.env.MODE === "development" && <Agentation />}
    </>
  );
}
