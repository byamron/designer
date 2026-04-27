import type { MouseEvent } from "react";
import { startDragging } from "../ipc/tauri";

// Mounted at App-level (not inside AppShell) so SettingsPage and modals
// inherit the same drag region without each having to render their own.
// Both `data-tauri-drag-region` and the explicit `startDragging()` call
// stay wired — the runtime auto-detection silently failed on first
// dogfood (PR #24) and the explicit handler is the belt-and-suspenders.
const onMouseDown = (e: MouseEvent<HTMLElement>): void => {
  if (e.button !== 0) return;
  void startDragging();
};

export function Titlebar() {
  return (
    <div
      className="app-titlebar"
      data-tauri-drag-region=""
      onMouseDown={onMouseDown}
    />
  );
}
