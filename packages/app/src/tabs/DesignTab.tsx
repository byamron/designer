import type { Tab, Workspace } from "../ipc/types";
import { ComponentCatalog } from "../lab/ComponentCatalog";
import { PrototypePreview } from "../lab/PrototypePreview";
import { TabLayout } from "../layout/TabLayout";

export function DesignTab({ tab, workspace }: { tab: Tab; workspace: Workspace }) {
  return (
    <TabLayout>
      <header className="tab-header">
        <h2 className="tab-title">{tab.title}</h2>
        <p className="tab-subtitle">
          Prototype browser + component catalog. All previews render in a
          strict-CSP sandbox.
        </p>
      </header>

      <section aria-labelledby="prototype-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h3 id="prototype-heading" className="card__title" style={{ fontSize: "var(--type-h3-size)" }}>
          Prototype preview
        </h3>
        <PrototypePreview workspace={workspace} />
      </section>

      <section aria-labelledby="catalog-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h3 id="catalog-heading" className="card__title" style={{ fontSize: "var(--type-h3-size)" }}>
          Component catalog
        </h3>
        <ComponentCatalog />
      </section>
    </TabLayout>
  );
}
