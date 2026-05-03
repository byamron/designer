import { useEffect, useState } from "react";
import { useDataState } from "../store/data";
import type { ProjectId, WorkspaceSummary } from "../ipc/types";
import { booleanDecoder, persisted } from "../util/persisted";

/**
 * One-time tutorial banner for the per-tab agent model that shipped
 * with Phase 23.E. Originally framed as a migration notice ("your
 * existing chats start fresh") for users upgrading from a pre-23.E
 * build whose claude sessions were reset by the `SESSION_NAMESPACE`
 * rotation. The 23.E.f1 follow-up reframed it as a universal tutorial:
 *
 * 1. The detection signal ("any project carries a workspace") was a
 *    proxy for "had Designer before the upgrade." It produced a small
 *    but real false-positive: a fresh-install user who creates their
 *    first workspace post-23.E briefly saw "your existing chats start
 *    fresh" — but they had no existing chats. The copy lied.
 * 2. Tightening detection to "had pre-23.E chats" requires reading
 *    event timestamps from the projector, which is real backend work
 *    for a banner that fires once per install.
 * 3. Reframing the copy as a tutorial about the per-tab feature is
 *    true for both upgraders and fresh-installers. The migration-
 *    specific detail (session memory was reset) lives in release
 *    notes / Help — most upgraders never observe it in practice
 *    because claude sessions are rarely long-lived across days.
 *
 * **Detection.** "Any project carries at least one workspace." Fresh
 * installs land on the empty Home where the Onboarding modal carries
 * the first-run copy; this banner stays silent there. Once the user
 * has a workspace open, the tutorial lands once, dismisses for good.
 *
 * **Persistence.** localStorage, mirroring `Onboarding`. One-time UI
 * state, never needs to leave the device.
 */
const STORAGE_KEY = "designer:phase-23e-banner-dismissed";

const dismissedFlag = persisted<boolean>(STORAGE_KEY, false, booleanDecoder);

export function PreTabSessionBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => dismissedFlag.read());

  // "Has at least one workspace" gate. Holds the banner back from
  // firing on the empty Home (Onboarding owns that surface) and lets
  // the parallel-tabs tutorial land once the user is in workspace
  // context. We read the entire workspaces map
  // (Record<ProjectId, WorkspaceSummary[]>) so the active project
  // doesn't gate the signal — any project with a workspace counts.
  const hasPriorWorkspaces = useDataState<boolean>((s) => {
    const map = s.workspaces as Record<ProjectId, WorkspaceSummary[]>;
    for (const list of Object.values(map)) {
      if (list && list.length > 0) return true;
    }
    return false;
  });
  const dataLoaded = useDataState((s) => s.loaded);

  const dismiss = () => {
    dismissedFlag.write(true);
    setDismissed(true);
  };

  // Keyboard parity with `Onboarding` — Escape dismisses. Bound only
  // while the banner is actually rendered so we don't intercept the
  // key globally when it isn't on screen.
  useEffect(() => {
    if (dismissed || !dataLoaded || !hasPriorWorkspaces) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed, dataLoaded, hasPriorWorkspaces]);

  if (dismissed) return null;
  if (!dataLoaded) return null;
  if (!hasPriorWorkspaces) return null;

  return (
    <div
      className="pretab-banner"
      data-component="PreTabSessionBanner"
      role="status"
      aria-live="polite"
    >
      <div className="pretab-banner__body">
        <span className="pretab-banner__title">Each tab is its own conversation</span>
        <span className="pretab-banner__meta">
          Tabs run independent claude agents — open more from + to work on parallel things side by side.
        </span>
      </div>
      <button
        type="button"
        className="pretab-banner__btn"
        onClick={dismiss}
        title="Got it — don't show this again"
      >
        Got it
      </button>
    </div>
  );
}
