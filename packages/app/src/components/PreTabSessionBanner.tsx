import { useEffect, useState } from "react";
import { useDataState } from "../store/data";
import type { ProjectId, WorkspaceSummary } from "../ipc/types";
import { booleanDecoder, persisted } from "../util/persisted";

/**
 * Phase 23.E migration notice. The session-id derivation rotated when
 * Phase 23.E shipped (`SESSION_NAMESPACE` change in
 * `crates/designer-claude/src/claude_code.rs`); existing claude
 * conversations were retired by design because they had cross-tab
 * framing baked into saved memory. The next post in any tab starts a
 * clean per-tab session — but the user has no way to know that without
 * a notice, so this banner explains the migration once, then dismisses
 * for good.
 *
 * **Detection.** Fresh installs land on the empty Home — there's
 * nothing to migrate, and the Onboarding modal already covers the
 * first-run copy, so the banner stays silent there. The signal we use
 * is "does the user already have at least one workspace?" — that's the
 * cheap, reliable proxy for "had Designer before the upgrade." A
 * timestamp-based check would be brittle (clock skew across machines,
 * machines that boot Designer for the first time long after the 23.E
 * release).
 *
 * **Persistence.** localStorage, mirroring `Onboarding`'s pattern. A
 * settings-flag round-trip would buy nothing — this is one-time UI
 * state, not business state, and never needs to leave the device.
 */
const STORAGE_KEY = "designer:phase-23e-banner-dismissed";

const dismissedFlag = persisted<boolean>(STORAGE_KEY, false, booleanDecoder);

export function PreTabSessionBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => dismissedFlag.read());

  // "Has prior chats" proxy: any project carries at least one workspace.
  // Workspaces predate Phase 23.E, so any pre-existing one indicates the
  // user is upgrading rather than installing fresh. We read the entire
  // workspaces map (Record<ProjectId, WorkspaceSummary[]>) rather than
  // a slice because the active project may not be the one the user
  // had pre-23.E history in.
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
        <span className="pretab-banner__title">Tabs are now parallel agents</span>
        <span className="pretab-banner__meta">
          Each tab gets its own conversation. Your existing chats start fresh on the next message.
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
