export type LinearAction = "create" | "update" | "remove";
export type LinearSLAAction = "set" | "highRisk" | "breached";

export type LinearResourceType =
  | "Issue"
  | "Comment"
  | "IssueLabel"
  | "Project"
  | "ProjectUpdate"
  | "Cycle"
  | "Reaction"
  | "Document"
  | "Initiative"
  | "InitiativeUpdate"
  | "Customer"
  | "CustomerRequest"
  | "IssueSLA"
  | "User";

export interface LinearActor {
  id: string;
  type: string;
  name: string;
  email?: string;
}

export interface LinearWebhookPayload {
  action: LinearAction | LinearSLAAction;
  type: LinearResourceType;
  actor?: LinearActor;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
  url: string;
  createdAt: string;
  webhookTimestamp: number;
  webhookId: string;
  organizationId: string;
}

export interface LinearIssueData {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; type: string };
  assignee?: { id: string; name: string };
  project?: { id: string; name: string };
  team: { id: string; name: string; key: string };
  labels: Array<{ id: string; name: string }>;
  description?: string;
  url: string;
}

export interface LinearCommentData {
  id: string;
  body: string;
  issue: { id: string; identifier: string; title: string };
  user: { id: string; name: string };
  url: string;
}

export interface LinearProjectData {
  id: string;
  name: string;
  state: string;
  lead?: { id: string; name: string };
  url: string;
}

export interface LinearProjectUpdateData {
  id: string;
  body: string;
  project: { id: string; name: string };
  user: { id: string; name: string };
  url: string;
}
