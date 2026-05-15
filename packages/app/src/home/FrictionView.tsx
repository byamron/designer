import { MessageSquareWarning } from "lucide-react";
import type { Project } from "../ipc/types";
import { TabLayout } from "../layout/TabLayout";
import { FrictionTriageSection } from "../layout/SettingsPage";

/**
 * Project-scoped friction triage — destination for the sidebar's Friction
 * tab. Same component as the global triage list in Settings, scoped to the
 * active project so each project's friction stays separate.
 *
 * The header makes the project scope explicit so an empty list reads as
 * "you haven't filed anything in this project yet" instead of "friction is
 * broken" (per PR #138 staff-review UX feedback). The shared description
 * inside FrictionTriageSection still mentions "the linked repo" — that
 * statement is accurate at workspace scope, and the header above clarifies
 * we're filtering, not storing per-project.
 */
export function FrictionView({ project }: { project: Project }) {
  return (
    <TabLayout>
      <div className="home-a">
        <header className="archived-view__head">
          <MessageSquareWarning size={16} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <h2 className="archived-view__title">Friction · {project.name}</h2>
            <p className="archived-view__subtitle">
              Capture reports anywhere with ⌘⇧F. This view shows only reports
              filed in this project.
            </p>
          </div>
        </header>
        <FrictionTriageSection projectId={project.id} />
      </div>
    </TabLayout>
  );
}
