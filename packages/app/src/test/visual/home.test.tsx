// Visual regression — Home (HomeTabA).
//
// Renders the project dashboard with a "Needs your attention" section and
// active workspaces list. Light + dark + a sidebar-collapsed variation
// (Designer is monochrome by policy — axiom #3 — so the third axis is a
// structural variant rather than a chromatic accent).

import { afterEach, beforeEach, describe, it } from "vitest";
import { render } from "@testing-library/react";
import { HomeTabA } from "../../home/HomeTabA";
import {
  __setIpcClient,
  ipcClient as ipcClientFn,
  type IpcClient,
} from "../../ipc/client";
import { dataStore } from "../../store/data";
import { appStore } from "../../store/app";
import {
  createVisualIpcClient,
  fixtureAttentionEvents,
  fixtureProject,
  fixtureProjectSummaries,
  fixtureWorkspaceSummaries,
} from "./fixtures";
import { applyTheme, matchScreenshot } from "./match";

let originalClient: IpcClient;
let visualClient: IpcClient;

beforeEach(() => {
  originalClient = ipcClientFn();
  visualClient = createVisualIpcClient();
  __setIpcClient(visualClient);

  // Hydrate the data store directly. HomeTabA reads workspaces / events
  // from the store, not via IPC, so the visual fixture has to seed it.
  dataStore.set({
    projects: fixtureProjectSummaries,
    workspaces: { [fixtureProject.id]: fixtureWorkspaceSummaries },
    spines: {},
    events: fixtureAttentionEvents,
    loaded: true,
    recentActivityTs: {},
  });
  appStore.set((s) => ({
    ...s,
    activeProject: fixtureProject.id,
    activeWorkspace: null,
    autonomyOverrides: {},
    // Pin the Designer-noticed unread cursor past the seeded events so the
    // badge doesn't render — keeps the home surface stable for the diff.
    noticedLastViewedSeq: 9999,
  }));
});

afterEach(() => {
  __setIpcClient(originalClient);
  // Each test seeds dataStore + appStore in beforeEach. Without an
  // explicit reset here, mutations bleed across cases — e.g. test 3
  // overrides `autonomyOverrides`, test 1 (re-runs in --watch) would
  // inherit it. Reset to a clean slate; beforeEach reseeds.
  dataStore.set({
    projects: [],
    workspaces: {},
    spines: {},
    events: [],
    loaded: false,
    recentActivityTs: {},
  });
  appStore.set((s) => ({
    ...s,
    activeProject: null,
    activeWorkspace: null,
    autonomyOverrides: {},
    noticedLastViewedSeq: 0,
  }));
});

describe("Home (HomeTabA)", () => {
  it("renders in light mode", async () => {
    applyTheme("light");
    render(<HomeTabA project={fixtureProject} />);
    await matchScreenshot("home", { variant: "light" });
  });

  it("renders in dark mode", async () => {
    applyTheme("dark");
    render(<HomeTabA project={fixtureProject} />);
    await matchScreenshot("home", { variant: "dark" });
  });

  it("renders with the autonomy override set to act (variation)", async () => {
    // Structural variant covering the third axis of the matrix. With
    // autonomy=act, the SegmentedToggle thumb shifts to the middle option;
    // catches regressions in the toggle's selection styling without
    // needing a chromatic accent the design system explicitly forbids.
    applyTheme("light");
    appStore.set((s) => ({
      ...s,
      autonomyOverrides: { [fixtureProject.id]: "act" },
    }));
    render(<HomeTabA project={fixtureProject} />);
    await matchScreenshot("home", { variant: "light-autonomy-act" });
  });
});
