import { useEffect } from "react";
import { AppShell } from "./layout/AppShell";
import { QuickSwitcher } from "./layout/QuickSwitcher";
import { Onboarding } from "./components/Onboarding";
import {
  bootData,
  dataStore,
  promptCreateProject,
  useDataState,
} from "./store/data";
import {
  appStore,
  selectProject,
  selectWorkspace,
  toggleQuickSwitcher,
} from "./store/app";

export function App() {
  const loaded = useDataState((s) => s.loaded);

  useEffect(() => {
    void (async () => {
      await bootData();
      const s = appStore.get();
      const { projects, workspaces } = dataStore.get();
      if (!s.activeProject && projects.length > 0) {
        selectProject(projects[0].project.id);
        const list = workspaces[projects[0].project.id];
        if (list && list.length > 0) selectWorkspace(list[0].workspace.id);
      }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleQuickSwitcher();
      } else if (e.key === "Escape") {
        toggleQuickSwitcher(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tauri-only: File > New Project… menu item emits this event. In the web /
  // test build, __TAURI_INTERNALS__ is absent and we skip.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    let unlisten: (() => void) | null = null;
    let torn = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const u = await listen<void>("designer://menu/new-project", () => {
        void (async () => {
          const id = await promptCreateProject();
          if (id) selectProject(id);
        })();
      });
      if (torn) u();
      else unlisten = u;
    })().catch((err) => {
      console.warn("menu listener registration failed", err);
    });
    return () => {
      torn = true;
      if (unlisten) unlisten();
    };
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
    </>
  );
}
