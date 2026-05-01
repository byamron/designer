import { useEffect, useState } from "react";
import { isTauri } from "../ipc/tauri";

/**
 * DP-A — auto-updater prompt.
 *
 * On first paint after the app boots, asks the Tauri updater plugin
 * whether a newer release is available on GitHub. If so, surfaces a
 * non-blocking pill in the bottom-left corner with two actions:
 *
 *   • Update now — downloads the signed bundle, applies in-place,
 *                  triggers a graceful relaunch.
 *   • Later     — dismisses for this session.
 *
 * The prompt stays out of the way for the dogfood register; one tap to
 * stay current, no nag. We deliberately do *not* auto-apply: trust is
 * earned by asking, even for the user's own self-built app.
 *
 * Renders only inside the Tauri runtime (the web build has no updater);
 * the dynamic import keeps the plugin out of the vitest bundle.
 */

type UpdateState =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "applying" }
  | { kind: "error"; message: string };

export function UpdatePrompt() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled || !update) return;
        setState({
          kind: "available",
          version: update.version,
          notes: update.body ?? undefined,
        });
      } catch (err) {
        // Silent on probe failure — offline or DNS hiccup shouldn't
        // shout at the user. The next launch tries again.
        // eslint-disable-next-line no-console
        console.warn("update check failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "idle" || dismissed) return null;

  const apply = async () => {
    setState({ kind: "applying" });
    // Hard timeout — if download / install hangs (slow network, locked
    // installer state) the user shouldn't see frozen UI forever. 60 s
    // is generous: a typical signed DMG is ~30 MB and downloads in
    // single-digit seconds even on patchy connections.
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      setState({
        kind: "error",
        message: "Update timed out. Try again from Help → Check for updates.",
      });
    }, 60_000);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        // Vanished between probe and apply — dismiss quietly.
        window.clearTimeout(deadline);
        setDismissed(true);
        return;
      }
      await update.downloadAndInstall();
      window.clearTimeout(deadline);
      if (!timedOut) await relaunch();
    } catch (err) {
      window.clearTimeout(deadline);
      if (timedOut) return;
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", message });
    }
  };

  return (
    <div
      className="update-prompt"
      data-component="UpdatePrompt"
      data-state={state.kind}
      role="status"
      aria-live="polite"
    >
      <div className="update-prompt__body">
        {state.kind === "available" && (
          <>
            <span className="update-prompt__title">
              Designer {state.version} is available
            </span>
            <span className="update-prompt__meta">
              Will restart automatically
            </span>
          </>
        )}
        {state.kind === "applying" && (
          <span className="update-prompt__title">Updating…</span>
        )}
        {state.kind === "error" && (
          <>
            <span className="update-prompt__title">Update failed</span>
            <span className="update-prompt__meta">{state.message}</span>
          </>
        )}
      </div>
      <div className="update-prompt__actions">
        {state.kind === "available" && (
          <>
            <button
              type="button"
              className="update-prompt__btn update-prompt__btn--primary"
              onClick={() => void apply()}
            >
              Update now
            </button>
            <button
              type="button"
              className="update-prompt__btn"
              onClick={() => setDismissed(true)}
            >
              Later
            </button>
          </>
        )}
        {state.kind === "error" && (
          <button
            type="button"
            className="update-prompt__btn"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
