export type Author = "user" | "agent";

export type ArtifactBase = {
  id: string;
  author: Author;
  timestamp: string;
};

export type MessageArtifact = ArtifactBase & {
  kind: "message";
  body: string;
  streaming?: boolean;
};

export type ToolCallArtifact = ArtifactBase & {
  kind: "tool-call";
  verb: string;
  target: string;
  durationMs?: number;
  status?: "ok" | "running" | "error";
};

export type CodeChangeArtifact = ArtifactBase & {
  kind: "code-change";
  file: string;
  added: number;
  removed: number;
  summary: string;
  diffPreview?: string;
};

export type ReportArtifact = ArtifactBase & {
  kind: "report";
  title: string;
  body: string;
  classification?: "feature" | "fix" | "improvement";
};

export type ApprovalArtifact = ArtifactBase & {
  kind: "approval";
  title: string;
  context: string;
  team?: string;
  actions: { label: string; intent: "primary" | "ghost" | "danger" }[];
};

export type Artifact =
  | MessageArtifact
  | ToolCallArtifact
  | CodeChangeArtifact
  | ReportArtifact
  | ApprovalArtifact;
