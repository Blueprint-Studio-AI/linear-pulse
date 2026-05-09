import type { LinearWebhookPayload } from "../types/linear";
import type { DisplayConfig } from "../types/config";
import { DEFAULT_DISPLAY_CONFIG } from "../types/config";

export interface FormattedMessage {
  text: string;
  url: string;
  projectId?: string;
}

const PRIORITY_LABEL: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

const STATUS_EMOJI: Record<string, string> = {
  backlog: "\ud83d\udce5",
  unstarted: "\u2b55",
  started: "\ud83d\udd35",
  completed: "\u2705",
  canceled: "\ud83d\udeab",
  triage: "\ud83d\udccb",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "...";
}

function firstName(payload: LinearWebhookPayload): string {
  const name = payload.actor?.name ?? "Someone";
  return name.split(" ")[0]!;
}

function getDataField<T>(
  data: Record<string, unknown>,
  field: string
): T | undefined {
  return data[field] as T | undefined;
}

// Display-aware helpers
function titleLine(rawTitle: string, identifier: string, d: DisplayConfig): string {
  const title = escapeHtml(rawTitle);
  if (d.showIdentifier && identifier) return `<b>${title}</b> (${identifier})`;
  return `<b>${title}</b>`;
}

function byActor(actor: string, d: DisplayConfig): string {
  return d.showActor ? ` by ${actor}` : "";
}

function urgentTag(priority: number): string {
  return priority === 1 ? " \ud83d\udd34" : "";
}

function inProject(project: { name: string } | undefined, d: DisplayConfig): string {
  if (!d.showProject || !project) return "";
  return ` in ${escapeHtml(project.name)}`;
}

export function formatLinearEvent(
  payload: LinearWebhookPayload,
  display?: DisplayConfig
): FormattedMessage | null {
  const d = display ?? DEFAULT_DISPLAY_CONFIG;

  switch (payload.type) {
    case "Issue":
      return formatIssueEvent(payload, d);
    case "Comment":
      return formatCommentEvent(payload, d);
    case "ProjectUpdate":
      return formatProjectUpdateEvent(payload, d);
    // Suppress noise: label changes, project metadata edits, reactions, etc.
    case "Project":
    case "IssueLabel":
    case "IssueSLA":
    case "Reaction":
    case "Cycle":
    case "Document":
    case "User":
    case "Customer":
    case "CustomerRequest":
      return null;
    default:
      return null;
  }
}

function formatIssueEvent(
  payload: LinearWebhookPayload,
  d: DisplayConfig
): FormattedMessage | null {
  const data = payload.data as Record<string, unknown>;
  const identifier = (data.identifier as string) || "";
  const title = (data.title as string) || "Untitled";
  const actor = escapeHtml(firstName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const priority = (data.priority as number) ?? 0;
  const state = getDataField<{ name: string; type: string }>(data, "state");

  if (payload.action === "create") {
    return {
      text: `\ud83d\udccb New issue${inProject(project, d)}${byActor(actor, d)}${urgentTag(priority)}\n${titleLine(title, identifier, d)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if (payload.action === "remove") {
    return null;
  }

  const updatedFrom = payload.updatedFrom ?? {};

  if ("state" in updatedFrom || "stateId" in updatedFrom) {
    const interestingStates = ["unstarted", "started", "completed"];
    const stateType = state?.type ?? "";
    if (!interestingStates.includes(stateType)) return null;

    const oldState = updatedFrom.state as { name: string; type: string } | undefined;
    const oldStateName = oldState?.name;
    const emoji = STATUS_EMOJI[stateType] ?? "\ud83d\udd04";
    let statusText: string;
    if (d.showTransition && oldStateName) {
      statusText = `${escapeHtml(oldStateName)} \u2192 ${escapeHtml(state?.name ?? "Unknown")}`;
    } else {
      statusText = escapeHtml(state?.name ?? "Unknown");
    }
    return {
      text: `${emoji} ${statusText}${byActor(actor, d)}\n${titleLine(title, identifier, d)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if ("assignee" in updatedFrom || "assigneeId" in updatedFrom) {
    const assignee = getDataField<{ name: string }>(data, "assignee");
    if (assignee) {
      const assigneeFirst = assignee.name.split(" ")[0]!;
      return {
        text: `\ud83d\udc64 Assigned to ${escapeHtml(assigneeFirst)}${byActor(actor, d)}\n${titleLine(title, identifier, d)}`,
        url: payload.url,
        projectId: project?.id,
      };
    } else {
      return {
        text: `\ud83d\udc64 Unassigned${byActor(actor, d)}\n${titleLine(title, identifier, d)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }
  }

  if ("priority" in updatedFrom) {
    const oldPriority = updatedFrom.priority as number;
    const isEscalation = priority < oldPriority;

    if (priority === 1) {
      return {
        text: `\ud83d\udd34 Escalated to Urgent${byActor(actor, d)}\n${titleLine(title, identifier, d)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }

    if (isEscalation) {
      const newLabel = PRIORITY_LABEL[priority] ?? "Unknown";
      return {
        text: `\u26a1 Priority raised to ${escapeHtml(newLabel)}${byActor(actor, d)}\n${titleLine(title, identifier, d)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }

    return null;
  }

  return null;
}

function formatCommentEvent(
  payload: LinearWebhookPayload,
  d: DisplayConfig
): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(firstName(payload));
  const issue = getDataField<{ identifier: string; title: string }>(data, "issue");
  const body = truncate(escapeHtml((data.body as string) || ""), 200);

  if (payload.action === "create") {
    const onIssue = issue ? ` on ${titleLine(issue.title, d.showIdentifier ? issue.identifier : "", d)}` : "";
    return {
      text: `\ud83d\udcac ${d.showActor ? actor : "New"} commented${onIssue}\n\u201c${body}\u201d`,
      url: payload.url,
    };
  }

  const onIssue = issue ? `\n${titleLine(issue.title, d.showIdentifier ? issue.identifier : "", d)}` : "";
  return {
    text: `\ud83d\udcac Comment ${payload.action}d${byActor(actor, d)}${onIssue}`,
    url: payload.url,
  };
}

function formatProjectEvent(
  payload: LinearWebhookPayload,
  d: DisplayConfig
): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const name = escapeHtml((data.name as string) || "Untitled");
  const actor = escapeHtml(firstName(payload));

  return {
    text: `\ud83d\udcc1 Project ${payload.action}d${byActor(actor, d)}\n<b>${name}</b>`,
    url: payload.url,
    projectId: data.id as string,
  };
}

function formatProjectUpdateEvent(
  payload: LinearWebhookPayload,
  d: DisplayConfig
): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(firstName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const body = truncate(escapeHtml((data.body as string) || ""), 200);

  return {
    text: `\ud83d\udce2 ${d.showActor ? actor : "Update"}${d.showActor ? " posted an update" : ""}${inProject(project, d)}\n\u201c${body}\u201d`,
    url: payload.url,
    projectId: project?.id,
  };
}

function formatGenericEvent(
  payload: LinearWebhookPayload,
  d: DisplayConfig
): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(firstName(payload));
  const name =
    (data.name as string) ||
    (data.title as string) ||
    (data.identifier as string) ||
    "";

  return {
    text: `\ud83d\udd14 ${payload.type} ${payload.action}d${byActor(actor, d)}${name ? `\n<b>${escapeHtml(name)}</b>` : ""}`,
    url: payload.url,
  };
}
