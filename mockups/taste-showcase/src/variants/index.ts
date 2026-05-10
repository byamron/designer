import type { ComponentType } from "react";
import V1ColorHierarchy from "./v1-color-hierarchy";
import V2SpatialRhythm from "./v2-spatial-rhythm";
import V3DocumentRegister from "./v3-document-register";
import V4CoalesceDisclose from "./v4-coalesce-disclose";
import V5ActiveAmbient from "./v5-active-ambient";
import C2AHospitality from "./c2-a-hospitality";
import C2BRichDensity from "./c2-b-rich-density";
import C2CActiveAmbientChat from "./c2-c-active-ambient-chat";
import C2DCoalesceRight from "./c2-d-coalesce-right";
import C3Synthesis from "./c3-synthesis";
import C4ACleanReport from "./c4-a-clean-report";
import C4BStatusChipReport from "./c4-b-status-chip-report";
import C4CTextLabelReport from "./c4-c-text-label-report";
import C5AReportAsProse from "./c5-a-report-as-prose";
import C5BReportAsStructured from "./c5-b-report-as-structured";

export type VariantId = string;

export type Variant = {
  id: VariantId;
  // Headline drops the id prefix (the small mono badge in the rail carries that).
  // Should describe the *bet* the variant makes, not restate the id.
  headline: string;
  Component: ComponentType;
};

export type CycleGroup = {
  label: string;
  variants: Variant[];
};

export const cycles: CycleGroup[] = [
  {
    label: "Cycle 5",
    variants: [
      { id: "c5-a", headline: "Report as prose", Component: C5AReportAsProse },
      { id: "c5-b", headline: "Report as structured artifact", Component: C5BReportAsStructured },
    ],
  },
  {
    label: "Cycle 4",
    variants: [
      { id: "c4-a", headline: "Clean bordered report", Component: C4ACleanReport },
      { id: "c4-b", headline: "Classification chip", Component: C4BStatusChipReport },
      { id: "c4-c", headline: "Uppercase text label", Component: C4CTextLabelReport },
    ],
  },
  {
    label: "Cycle 3",
    variants: [
      { id: "c3", headline: "Conversation visible, operation collapsed", Component: C3Synthesis },
    ],
  },
  {
    label: "Cycle 2",
    variants: [
      { id: "c2-a", headline: "Hospitality moments", Component: C2AHospitality },
      { id: "c2-b", headline: "Rich agent prose, tight density", Component: C2BRichDensity },
      { id: "c2-c", headline: "Streaming ambient lift", Component: C2CActiveAmbientChat },
      { id: "c2-d", headline: "Coalesce + progressive disclosure", Component: C2DCoalesceRight },
    ],
  },
  {
    label: "Cycle 1",
    variants: [
      { id: "v1", headline: "Color-hierarchy", Component: V1ColorHierarchy },
      { id: "v2", headline: "Spatial-rhythm", Component: V2SpatialRhythm },
      { id: "v3", headline: "Document register", Component: V3DocumentRegister },
      { id: "v4", headline: "Coalesce-disclose", Component: V4CoalesceDisclose },
      { id: "v5", headline: "Active-ambient", Component: V5ActiveAmbient },
    ],
  },
];

export const variants: Variant[] = cycles.flatMap((c) => c.variants);
