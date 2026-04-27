// Tauri runtime adapter. Centralizes the `__TAURI_INTERNALS__` detection, the
// module-level promise cache for dynamic imports, and the shared "async
// listener with immediate-teardown" pattern. Callers never touch the Tauri
// packages directly — that keeps the web/test build from pulling in native
// bridges and keeps the teardown race-condition handled in one place.

export function isTauri(): boolean {
  return typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
}

// Promises resolved once per process. Subsequent `await` hits the ES-module
// cache; these just skip the repeated property lookup through `import()`.
const invokePromise = () =>
  import("@tauri-apps/api/core").then((m) => m.invoke);
const listenPromise = () =>
  import("@tauri-apps/api/event").then((m) => m.listen);
const windowPromise = () =>
  import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
const dialogOpenPromise = () =>
  import("@tauri-apps/plugin-dialog").then((m) => m.open);

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const fn = await invokePromise();
  return fn<T>(cmd, args);
}

// Tauri's `data-tauri-drag-region` auto-detect is fragile; calling
// `startDragging()` explicitly from a mousedown handler bypasses it.
// No-op outside Tauri so the handler can stay mounted in web/test.
export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  try {
    const win = await windowPromise();
    await win.startDragging();
  } catch (err) {
    console.warn("startDragging failed", err);
  }
}

// Returns the picked absolute path, `null` on cancel or non-Tauri.
// `defaultPath` seeds the picker so it opens at the user's last entry.
export async function pickFolder(
  defaultPath?: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const open = await dialogOpenPromise();
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose project folder",
      defaultPath: defaultPath || undefined,
    });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    console.warn("folder picker failed", err);
    return null;
  }
}

/**
 * Subscribe to a Tauri event. Returns a teardown that is safe to call before
 * the underlying listener has even registered — the "torn before ready" race
 * would otherwise leak a subscription for the life of the window.
 */
export function listen<T>(
  channel: string,
  handler: (payload: T) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let torn = false;
  (async () => {
    const fn = await listenPromise();
    const u = await fn<T>(channel, (e) => handler(e.payload));
    if (torn) u();
    else unlisten = u;
  })().catch((err) => {
    console.warn(`event subscription failed (${channel})`, err);
  });
  return () => {
    torn = true;
    if (unlisten) unlisten();
  };
}
