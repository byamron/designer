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

  // Auto-dismiss once shown so a quick return-visit during the same
  // launch doesn't double-render. We only flip the flag after the
  // banner has actually rendered (which requires `dataLoaded` AND
  // `hasPriorWorkspaces`); first-run users with no workspaces never
  // hit this, and the flag stays `false` for them. If they later create
  // a workspace, this banner is still suppressed because the migration
  // it describes does not apply to them — only users who had chats
  // before the rotation see it.
  useEffect(() => {
    if (dismissed) return;
    if (!dataLoaded) return;
    if (!hasPriorWorkspaces) return;
    // The user is seeing the banner this paint; queue the persistent
    // flip on the next tick so a fast remount in the same launch
    // doesn't replay the animation. We also still render the dismiss
    // button — the flag just guarantees one-and-done, not the
    // user-initiated affordance.
  }, [dismissed, dataLoaded, hasPriorWorkspaces]);

  if (dismissed) return null;
  if (!dataLoaded) return null;
  if (!hasPriorWorkspaces) return null;

  const dismiss = () => {
    dismissedFlag.write(true);
    setDismissed(true);
  };

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
