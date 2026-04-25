import { useEffect, useState } from "react";
import { ipcClient } from "../ipc/client";
import type {
  CostStatus,
  StreamEvent,
  WorkspaceId,
} from "../ipc/types";
import type { CostChipPreferences } from "../ipc/client";

/**
 * Cost chip — Phase 13.G workspace topbar widget.
 *
 * - Shows `<spent> / <cap>` with a colored band:
 *   green ≤50%, amber ≤80%, red >80%, dimmed when no cap is set.
 * - Hidden by default per spec Decision 34. The Preferences toggle in
 *   Settings → Preferences flips `cost_chip_enabled`; this component
 *   refreshes the preference when the `designer.cost-chip.preference-changed`
 *   custom event fires.
 * - Polls + updates on every `cost_recorded` stream event so the chip
 *   reflects per-turn cost without explicit refresh.
 * - Click → expands a popover with daily/weekly/per-track placeholder so
 *   the visual register is real before the data lands (note in 13.G:
 *   "skeleton for now; full breakdown is fine to defer").
 */

export const COST_CHIP_PREFERENCE_EVENT = "designer.cost-chip.preference-changed";

interface CostChipProps {
  workspaceId: WorkspaceId;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function bandFor(ratio: number | null): "muted" | "ok" | "warn" | "danger" {
  if (ratio == null) return "muted";
  if (ratio < 0.5) return "ok";
  if (ratio < 0.8) return "warn";
  return "danger";
}

export function CostChip({ workspaceId }: CostChipProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<CostStatus | null>(null);
  const [open, setOpen] = useState(false);

  // Preference fetch + change listener.
  useEffect(() => {
    let cancelled = false;
    const refreshPreference = async () => {
      try {
        const pref = await ipcClient().getCostChipPreference();
        if (!cancelled) setEnabled(pref.enabled);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    };
    void refreshPreference();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<CostChipPreferences>).detail;
      if (detail && typeof detail.enabled === "boolean") {
        setEnabled(detail.enabled);
      } else {
        void refreshPreference();
      }
    };
    window.addEventListener(COST_CHIP_PREFERENCE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(COST_CHIP_PREFERENCE_EVENT, onChange);
    };
  }, []);

  // Status fetch + cost-recorded event refresh.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await ipcClient().getCostStatus(workspaceId);
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void refresh();
    const unsub = ipcClient().stream((ev: StreamEvent) => {
      if (ev.kind !== "cost_recorded") return;
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [enabled, workspaceId]);

  if (!enabled || !status) return null;

  const band = bandFor(status.ratio);
  const spentLabel = formatDollars(status.spent_dollars_cents);
  const capLabel =
    status.cap_dollars_cents != null
      ? formatDollars(status.cap_dollars_cents)
      : "no cap";

  return (
    <div className="cost-chip-wrap">
      <button
        type="button"
        className="cost-chip"
        data-band={band}
        aria-expanded={open}
        aria-label={`Cost ${spentLabel} of ${capLabel}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="cost-chip__dot" aria-hidden="true" />
        <span className="cost-chip__amount">{spentLabel}</span>
        <span className="cost-chip__sep" aria-hidden="true">
          /
        </span>
        <span className="cost-chip__cap">{capLabel}</span>
      </button>
      {open && (
        <div className="cost-chip__popover" role="dialog" aria-label="Cost breakdown">
          <h3 className="cost-chip__popover-title">Spend</h3>
          <dl className="cost-chip__breakdown">
            <div>
              <dt>Today</dt>
              <dd>{spentLabel}</dd>
            </div>
            <div>
              <dt>This week</dt>
              <dd className="cost-chip__deferred">tracked next phase</dd>
            </div>
            <div>
              <dt>Per track</dt>
              <dd className="cost-chip__deferred">tracked next phase</dd>
            </div>
          </dl>
          <p className="cost-chip__footnote">
            Cap: {capLabel}. Tokens: {status.spent_tokens.toLocaleString()}
            {status.cap_tokens != null
              ? ` of ${status.cap_tokens.toLocaleString()}`
              : ""}
            .
          </p>
        </div>
      )}
    </div>
  );
}
