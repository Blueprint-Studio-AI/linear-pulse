import type { LinearWebhookPayload } from "../types/linear";

export interface FormattedMessage {
  text: string;
  url: string;
  projectId?: string;
}

const PRIORITY_EMOJI: Record<number, string> = {
  0: "",
  1: "\ud83d\udd34",
  2: "\ud83d\udfe0",
  3: "\ud83d\udfe1",
  4: "\ud83d\udd35",
};

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

function actorName(payload: LinearWebhookPayload): string {
  return payload.actor?.name ?? "Someone";
}

function getDataField<T>(
  data: Record<string, unknown>,
  field: string
): T | undefined {
  return data[field] as T | undefined;
}

export function formatLinearEvent(
  payload: LinearWebhookPayload
): FormattedMessage | null {
  switch (payload.type) {
    case "Issue":
      return formatIssueEvent(payload);
    case "Comment":
      return formatCommentEvent(payload);
    case "Project":
      return formatProjectEvent(payload);
    case "ProjectUpdate":
      return formatProjectUpdateEvent(payload);
    case "IssueSLA":
      return formatSLAEvent(payload);
    default:
      return formatGenericEvent(payload);
  }
}

function formatIssueEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const identifier = (data.identifier as string) || "";
  const title = escapeHtml((data.title as string) || "Untitled");
  const actor = escapeHtml(actorName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const team = getDataField<{ name: string }>(data, "team");
  const priority = (data.priority as number) ?? 0;
  const priorityLabel = (data.priorityLabel as string) ?? "";
  const state = getDataField<{ name: string; type: string }>(data, "state");

  if (payload.action === "create") {
    const pEmoji = PRIORITY_EMOJI[priority] ?? "";
    const pLabel = priorityLabel || (PRIORITY_LABEL[priority] ?? "");
    let details = pEmoji || pLabel ? `Priority: ${pEmoji} ${escapeHtml(pLabel)}`.trim() : "";
    if (project) details += `${details ? " \u00b7 " : ""}Project: ${escapeHtml(project.name)}`;

    return {
      text: `\ud83d\udccb <b>New issue</b> by ${actor}\n<b>${identifier}: ${title}</b>\n${details}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if (payload.action === "remove") {
    return {
      text: `\ud83d\uddd1 <b>Issue removed</b> by ${actor}\n<b>${identifier}: ${title}</b>`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Update — determine what changed
  const updatedFrom = payload.updatedFrom ?? {};

  // Status change
  if ("state" in updatedFrom) {
    const oldState = updatedFrom.state as { name: string; type: string };
    const emoji = STATUS_EMOJI[state?.type ?? ""] ?? "\ud83d\udd04";
    return {
      text: `${emoji} <b>Marked as ${escapeHtml(state?.name ?? "Unknown")}</b> by ${actor}\n<b>${identifier}: ${title}</b>\nWas: ${escapeHtml(oldState.name)} \u2192 Now: ${escapeHtml(state?.name ?? "Unknown")}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Assignee change
  if ("assignee" in updatedFrom || "assigneeId" in updatedFrom) {
    const assignee = getDataField<{ name: string }>(data, "assignee");
    if (assignee) {
      return {
        text: `\ud83d\udc64 <b>${identifier} assigned to ${escapeHtml(assignee.name)}</b>\n${title}\nBy: ${actor}${priority > 0 ? ` \u00b7 Priority: ${PRIORITY_EMOJI[priority] ?? ""} ${escapeHtml(priorityLabel || (PRIORITY_LABEL[priority] ?? ""))}`.trim() : ""}`,
        url: payload.url,
        projectId: project?.id,
      };
    } else {
      return {
        text: `\ud83d\udc64 <b>${identifier} unassigned</b> by ${actor}\n${title}`,
        url: payload.url,
        projectId: project?.id,
      };
    }
  }

  // Priority change
  if ("priority" in updatedFrom) {
    const oldPriority = updatedFrom.priority as number;
    const oldLabel = PRIORITY_LABEL[oldPriority] ?? "None";
    const newLabel = PRIORITY_LABEL[priority] ?? priorityLabel;
    const direction = priority < oldPriority ? "escalated" : "lowered";
    const emoji = PRIORITY_EMOJI[priority] ?? "";
    const oldEmoji = PRIORITY_EMOJI[oldPriority] ?? "";
    return {
      text: `${emoji || "\ud83d\udd04"} <b>Priority ${direction}</b> on ${identifier}\n${title}\nWas: ${oldEmoji} ${escapeHtml(oldLabel)} \u2192 Now: ${emoji} ${escapeHtml(newLabel)}`.replace(/  +/g, " "),
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Generic update
  const changedFields = Object.keys(updatedFrom);
  return {
    text: `\ud83d\udd04 <b>Issue updated</b> by ${actor}\n<b>${identifier}: ${title}</b>\nChanged: ${changedFields.map(escapeHtml).join(", ")}`,
    url: payload.url,
    projectId: project?.id,
  };
}

function formatCommentEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(actorName(payload));
  const issue = getDataField<{ identifier: string; title: string }>(
    data,
    "issue"
  );
  const body = truncate(escapeHtml((data.body as string) || ""), 200);
  const issueRef = issue ? `${issue.identifier}` : "";

  if (payload.action === "create") {
    return {
      text: `\ud83d\udcac <b>Comment</b> by ${actor} on <b>${issueRef}</b>\n\u201c${body}\u201d`,
      url: payload.url,
    };
  }

  return {
    text: `\ud83d\udcac <b>Comment ${payload.action}d</b> by ${actor} on <b>${issueRef}</b>`,
    url: payload.url,
  };
}

function formatProjectEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const name = escapeHtml((data.name as string) || "Untitled");
  const actor = escapeHtml(actorName(payload));

  return {
    text: `\ud83d\udcc1 <b>Project ${payload.action}d</b> by ${actor}\n${name}`,
    url: payload.url,
    projectId: data.id as string,
  };
}

function formatProjectUpdateEvent(
  payload: LinearWebhookPayload
): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(actorName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const body = truncate(escapeHtml((data.body as string) || ""), 200);

  return {
    text: `\ud83d\udce2 <b>Project update</b> on ${escapeHtml(project?.name ?? "Unknown")} by ${actor}\n\u201c${body}\u201d`,
    url: payload.url,
    projectId: project?.id,
  };
}

function formatSLAEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const issue = getDataField<{ identifier: string; title: string }>(
    data,
    "issue"
  ) ?? {
    identifier: (data.identifier as string) ?? "",
    title: (data.title as string) ?? "",
  };

  const actionLabels: Record<string, string> = {
    set: "\u23f1 SLA set",
    highRisk: "\u26a0\ufe0f SLA at risk",
    breached: "\ud83d\udea8 SLA breached",
  };

  return {
    text: `${actionLabels[payload.action] ?? "\u23f1 SLA event"} on <b>${escapeHtml(issue.identifier)}</b>\n${escapeHtml(issue.title)}`,
    url: payload.url,
  };
}

function formatGenericEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(actorName(payload));
  const name =
    (data.name as string) ||
    (data.title as string) ||
    (data.identifier as string) ||
    "";

  return {
    text: `\ud83d\udd14 <b>${payload.type} ${payload.action}d</b> by ${actor}${name ? `\n${escapeHtml(name)}` : ""}`,
    url: payload.url,
  };
}
