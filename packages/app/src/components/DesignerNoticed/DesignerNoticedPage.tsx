import { useEffect, useMemo, useState } from "react";
import type {
  ProjectId,
  ProposalKind,
  ProposalStatus,
  Severity,
} from "../../ipc/types";
import { markNoticedViewed } from "../../store/app";
import { ProposalRow } from "./ProposalRow";
import { useProposals } from "./useProposals";

/**
 * Settings → Activity → "Designer noticed" — the proposal archive
 * (Phase 21.A1.2). Replaces the 21.A1.1 findings archive: findings are
 * never their own list here, they're collapsed evidence under each
 * proposal.
 *
 * Filters: severity, kind, status. The home tab shows the open slice;
 * this page is the full historian — accepted, dismissed, snoozed
 * proposals included by default.
 */
const SEVERITY_OPTIONS: Array<{ value: Severity | "all"; label: string }> = [
  { value: "all", label: "All severities" },
  { value: "warn", label: "Warn" },
  { value: "notice", label: "Notice" },
  { value: "info", label: "Info" },
];

const STATUS_OPTIONS: Array<{ value: ProposalStatus | "all"; label: string }> =
  [
    { value: "all", label: "All statuses" },
    { value: "open", label: "Open" },
    { value: "accepted", label: "Accepted" },
    { value: "dismissed", label: "Dismissed" },
    { value: "snoozed", label: "Snoozed" },
  ];

export function DesignerNoticedPage({
  projectId,
}: {
  projectId: ProjectId | null;
}) {
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [kind, setKind] = useState<ProposalKind | "all">("all");
  const [status, setStatus] = useState<ProposalStatus | "all">("all");

  const statusFilter = status === "all" ? null : status;
  const { proposals, signaled, onSignal, onResolve, loading, error } =
    useProposals(projectId, statusFilter);

  // Opening the archive clears the unread badge — same "I'm caught up"
  // signal as opening the workspace home.
  useEffect(() => {
    if (projectId) markNoticedViewed();
  }, [projectId]);

  const filtered = useMemo(() => {
    return proposals.filter((p) => {
      if (severity !== "all" && p.severity !== severity) return false;
      if (kind !== "all" && p.kind !== kind) return false;
      return true;
    });
  }, [proposals, severity, kind]);

  const knownKinds = useMemo(() => {
    const set = new Set<ProposalKind>();
    for (const p of proposals) set.add(p.kind);
    return Array.from(set).sort();
  }, [proposals]);

  if (!projectId) {
    return (
      <>
        <SectionHeader />
        <p className="settings-page__section-description">
          Open a project to see what Designer's been suggesting.
        </p>
      </>
    );
  }

  return (
    <>
      <SectionHeader />

      <div className="designer-noticed__filters" role="group" aria-label="Filters">
        <label className="designer-noticed__filter">
          <span>Severity</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity | "all")}
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="designer-noticed__filter">
          <span>Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ProposalKind | "all")}
          >
            <option value="all">All kinds</option>
            {knownKinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="designer-noticed__filter">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as ProposalStatus | "all")
            }
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <p className="settings-page__section-description">Loading…</p>
      )}
      {error && (
        <p className="settings-page__section-description" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="settings-page__section-description">
          Nothing to suggest yet — Designer reviews patterns when you
          finish a track or once per day.
        </p>
      )}
      {filtered.length > 0 && (
        <ul className="designer-noticed__list" role="list">
          {filtered.map((p) => (
            <ProposalRow
              key={p.id}
              proposal={p}
              signal={signaled[p.id] ?? null}
              onSignal={onSignal}
              onResolve={onResolve}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function SectionHeader() {
  return (
    <header className="settings-page__section-header">
      <h2 className="settings-page__section-title">Designer noticed</h2>
      <p className="settings-page__section-description">
        Designer reviews patterns at the end of each track and once per
        day. Accepted, dismissed, and snoozed proposals are archived
        here. Findings are collapsed as evidence under each proposal —
        never as their own list.
      </p>
    </header>
  );
}
