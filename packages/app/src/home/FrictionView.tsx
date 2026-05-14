import type { Project } from "../ipc/types";
import { TabLayout } from "../layout/TabLayout";
import { FrictionTriageSection } from "../layout/SettingsPage";

/**
 * Project-scoped friction triage — destination for the sidebar's Friction
 * tab. Same component as the global triage list in Settings, scoped to the
 * active project so each project's friction stays separate.
 */
export function FrictionView({ project }: { project: Project }) {
  return (
    <TabLayout>
      <div className="home-a">
        <FrictionTriageSection projectId={project.id} />
      </div>
    </TabLayout>
  );
}
