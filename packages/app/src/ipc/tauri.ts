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

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const fn = await invokePromise();
  return fn<T>(cmd, args);
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
