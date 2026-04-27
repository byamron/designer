import type { ReactNode } from "react";

/**
 * Tab layout primitive. Provides a scrollable content region with optional
 * bottom-docked input area (chat/compose patterns). The dock stays fixed at
 * the bottom of the tab body while content above scrolls.
 *
 * Centered max-width matches for both content and dock so the dock doesn't
 * feel like it's anchored to the window edges.
 */
export function TabLayout({
  children,
  dock,
}: {
  children: ReactNode;
  dock?: ReactNode;
}) {
  return (
    <div className="tab-layout" data-component="TabLayout">
      <div className="tab-layout__scroll">
        <div className="tab-layout__inner">{children}</div>
      </div>
      {dock && (
        <div className="tab-layout__dock">
          <div className="tab-layout__dock-inner">{dock}</div>
        </div>
      )}
    </div>
  );
}
