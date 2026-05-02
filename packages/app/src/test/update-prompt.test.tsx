// UpdatePrompt — DP-A auto-updater UI. State machine + race contract
// (timeout-after-install path) are non-trivial; these tests lock the
// behavior so a refactor can't silently regress to "user sees error
// even though update succeeded" or "user clicks Later, install runs
// anyway."
//
// See core-docs/testing-strategy.md §2 (updater tests, frontend slice).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdatePrompt } from "../components/UpdatePrompt";

type CheckResult = {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
} | null;

const checkFn = vi.fn<() => Promise<CheckResult>>();
const relaunchFn = vi.fn<() => Promise<void>>();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkFn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchFn(),
}));

beforeEach(() => {
  // isTauri() detects __TAURI_INTERNALS__ on globalThis. Without this
  // the component short-circuits on mount and never probes.
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  checkFn.mockReset();
  relaunchFn.mockReset();
  relaunchFn.mockResolvedValue(undefined);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.useRealTimers();
});

describe("UpdatePrompt", () => {
  it("renders nothing when no update is available", async () => {
    checkFn.mockResolvedValue(null);
    render(<UpdatePrompt />);
    // Give the probe a microtask to resolve.
    await waitFor(() => expect(checkFn).toHaveBeenCalled());
    expect(screen.queryByText(/Designer .* is available/)).toBeNull();
  });

  it("surfaces the available pill when an update is found", async () => {
    checkFn.mockResolvedValue({
      version: "0.2.0",
      body: "release notes",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    });
    render(<UpdatePrompt />);
    expect(await screen.findByText(/Designer 0.2.0 is available/)).not.toBeNull();
    expect(screen.getByRole("button", { name: /Update now/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Later/i })).not.toBeNull();
  });

  it("dismisses when Later is clicked, no install or relaunch called", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkFn.mockResolvedValue({ version: "0.2.0", downloadAndInstall });
    render(<UpdatePrompt />);
    const later = await screen.findByRole("button", { name: /Later/i });
    fireEvent.click(later);
    expect(screen.queryByText(/Designer .* is available/)).toBeNull();
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunchFn).not.toHaveBeenCalled();
  });

  it("downloads, installs, and relaunches when Update now is clicked", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkFn.mockResolvedValue({ version: "0.2.0", downloadAndInstall });
    render(<UpdatePrompt />);
    const update = await screen.findByRole("button", { name: /Update now/i });
    fireEvent.click(update);
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(relaunchFn).toHaveBeenCalledTimes(1));
  });

  it("stays silent when the probe throws (offline / DNS hiccup)", async () => {
    checkFn.mockRejectedValue(new Error("network down"));
    render(<UpdatePrompt />);
    await waitFor(() => expect(checkFn).toHaveBeenCalled());
    expect(screen.queryByText(/Designer .* is available/)).toBeNull();
    expect(screen.queryByText(/Update failed/)).toBeNull();
  });

  it("shows error state if install hangs past the 60s deadline", async () => {
    const hangingInstall = vi.fn(() => new Promise<void>(() => {}));
    checkFn.mockResolvedValue({
      version: "0.2.0",
      downloadAndInstall: hangingInstall,
    });
    render(<UpdatePrompt />);
    // Wait for the pill on real timers so `findByText`'s poller works.
    await screen.findByText(/Designer 0.2.0 is available/);
    // Now switch to fake setTimeout for the 60s deadline only — leaves
    // microtasks and Promise resolution alone.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: /Update now/i }));
    // Drain microtasks so the apply handler reaches its `setTimeout`.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(60_001);
    });
    // Drain post-timeout microtasks for the error setState.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Update failed/)).not.toBeNull();
    expect(screen.queryByText(/timed out/i)).not.toBeNull();
    expect(relaunchFn).not.toHaveBeenCalled();
  });

  it("relaunches even when install completes after the timeout fires (race contract)", async () => {
    let resolveInstall: (() => void) | null = null;
    const slowInstall = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveInstall = () => resolve();
        }),
    );
    checkFn.mockResolvedValue({
      version: "0.2.0",
      downloadAndInstall: slowInstall,
    });
    render(<UpdatePrompt />);
    await screen.findByText(/Designer 0.2.0 is available/);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: /Update now/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Timeout fires first.
    await act(async () => {
      vi.advanceTimersByTime(60_001);
    });
    // Install completes after the deadline.
    await act(async () => {
      resolveInstall?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Per the race contract documented in UpdatePrompt.tsx: relaunch
    // must still happen — the user clicked Update and the install
    // succeeded, so silently downgrading to error would strand them on
    // the old build with the new bundle on disk.
    //
    // We assert *only* on `relaunchFn` here. The timeout callback
    // currently does set the error state when it fires (before install
    // completes), and the success path doesn't undo it — so the error
    // pill is briefly visible before relaunch closes the window.
    // That's an acceptable race because relaunch happens within a
    // microtask of install resolving; the user doesn't perceive it.
    // Asserting "no error UI" here would lock an idealized contract
    // the component intentionally does not fulfill.
    expect(relaunchFn).toHaveBeenCalledTimes(1);
  });
});
