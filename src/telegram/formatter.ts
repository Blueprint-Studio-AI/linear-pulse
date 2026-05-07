import type { LinearWebhookPayload } from "../types/linear";

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

function titleLine(title: string, identifier: string): string {
  if (identifier) return `<b>${title}</b> (${identifier})`;
  return `<b>${title}</b>`;
}

function urgentTag(priority: number): string {
  return priority === 1 ? " \ud83d\udd34" : "";
}

function inProject(project: { name: string } | undefined): string {
  if (!project) return "";
  return ` in ${escapeHtml(project.name)}`;
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
  const actor = escapeHtml(firstName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const priority = (data.priority as number) ?? 0;
  const state = getDataField<{ name: string; type: string }>(data, "state");

  if (payload.action === "create") {
    return {
      text: `\ud83d\udccb New issue${inProject(project)} by ${actor}${urgentTag(priority)}\n${titleLine(title, identifier)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if (payload.action === "remove") {
    return {
      text: `\ud83d\uddd1 Removed by ${actor}\n${titleLine(title, identifier)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  const updatedFrom = payload.updatedFrom ?? {};

  if ("state" in updatedFrom) {
    const oldState = updatedFrom.state as { name: string; type: string };
    const emoji = STATUS_EMOJI[state?.type ?? ""] ?? "\ud83d\udd04";
    return {
      text: `${emoji} ${escapeHtml(oldState.name)} \u2192 ${escapeHtml(state?.name ?? "Unknown")} by ${actor}\n${titleLine(title, identifier)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if ("assignee" in updatedFrom || "assigneeId" in updatedFrom) {
    const assignee = getDataField<{ name: string }>(data, "assignee");
    if (assignee) {
      const assigneeFirst = assignee.name.split(" ")[0]!;
      return {
        text: `\ud83d\udc64 Assigned to ${escapeHtml(assigneeFirst)} by ${actor}\n${titleLine(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    } else {
      return {
        text: `\ud83d\udc64 Unassigned by ${actor}\n${titleLine(title, identifier)}`,
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
        text: `\ud83d\udd34 Escalated to Urgent by ${actor}\n${titleLine(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }

    if (isEscalation) {
      const newLabel = PRIORITY_LABEL[priority] ?? "Unknown";
      return {
        text: `\u26a1 Priority raised to ${escapeHtml(newLabel)} by ${actor}\n${titleLine(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }

    return null;
  }

  const changedFields = Object.keys(updatedFrom);
  return {
    text: `\ud83d\udd04 Updated by ${actor}\n${titleLine(title, identifier)}\nChanged: ${changedFields.map(escapeHtml).join(", ")}`,
    url: payload.url,
    projectId: project?.id,
  };
}

function formatCommentEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(firstName(payload));
  const issue = getDataField<{ identifier: string; title: string }>(
    data,
    "issue"
  );
  const body = truncate(escapeHtml((data.body as string) || ""), 200);

  if (payload.action === "create") {
    return {
      text: `\ud83d\udcac ${actor} commented${issue ? ` on ${titleLine(escapeHtml(issue.title), issue.identifier)}` : ""}\n\u201c${body}\u201d`,
      url: payload.url,
    };
  }

  return {
    text: `\ud83d\udcac Comment ${payload.action}d by ${actor}${issue ? `\n${titleLine(escapeHtml(issue.title), issue.identifier)}` : ""}`,
    url: payload.url,
  };
}

function formatProjectEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const name = escapeHtml((data.name as string) || "Untitled");
  const actor = escapeHtml(firstName(payload));

  return {
    text: `\ud83d\udcc1 Project ${payload.action}d by ${actor}\n<b>${name}</b>`,
    url: payload.url,
    projectId: data.id as string,
  };
}

function formatProjectUpdateEvent(
  payload: LinearWebhookPayload
): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(firstName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const body = truncate(escapeHtml((data.body as string) || ""), 200);

  return {
    text: `\ud83d\udce2 ${actor} posted an update${inProject(project)}\n\u201c${body}\u201d`,
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
    text: `${actionLabels[payload.action] ?? "\u23f1 SLA event"}\n${titleLine(escapeHtml(issue.title), issue.identifier)}`,
    url: payload.url,
  };
}

function formatGenericEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(firstName(payload));
  const name =
    (data.name as string) ||
    (data.title as string) ||
    (data.identifier as string) ||
    "";

  return {
    text: `\ud83d\udd14 ${payload.type} ${payload.action}d by ${actor}${name ? `\n<b>${escapeHtml(name)}</b>` : ""}`,
    url: payload.url,
  };
}
