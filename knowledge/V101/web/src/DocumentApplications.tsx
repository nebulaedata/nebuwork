import { lazy, type ComponentType } from "react";
import type { Row } from "./api";

export type ApplicationProgressProps = { run?: Row; name: string };
export type DocumentApplicationProps = {
  id: string;
  parseVersion?: string;
  Progress?: ComponentType<ApplicationProgressProps>;
};

// New document applications register their content and progress together.
export const documentApplications = [
  {
    id: "extraction",
    name: "参数提取",
    Content: lazy(() =>
      import("./extraction/Extraction").then((m) => ({
        default: m.DocumentExtraction,
      })),
    ),
    Progress: lazy(() =>
      import("./extraction/ExtractionProgress").then((m) => ({
        default: m.ExtractionProgress,
      })),
    ),
  },
] satisfies {
  id: string;
  name: string;
  Content: ComponentType<DocumentApplicationProps>;
  Progress: ComponentType<ApplicationProgressProps>;
}[];
