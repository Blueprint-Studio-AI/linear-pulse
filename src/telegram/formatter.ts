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

function actorName(payload: LinearWebhookPayload): string {
  return payload.actor?.name ?? "Someone";
}

function getDataField<T>(
  data: Record<string, unknown>,
  field: string
): T | undefined {
  return data[field] as T | undefined;
}

// Format: "Title (BPSTU-123)" or just "Title" if no identifier
function titleWithId(title: string, identifier: string): string {
  if (identifier) return `${title} (${identifier})`;
  return title;
}

// Only show priority if urgent (1) — returns emoji or empty string
function urgentTag(priority: number): string {
  return priority === 1 ? " \ud83d\udd34" : "";
}

// "in {project}" clause or empty
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
  const actor = escapeHtml(actorName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const priority = (data.priority as number) ?? 0;
  const state = getDataField<{ name: string; type: string }>(data, "state");

  if (payload.action === "create") {
    return {
      text: `\ud83d\udccb <b>New issue</b>${inProject(project)} by ${actor}${urgentTag(priority)}\n${titleWithId(title, identifier)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if (payload.action === "remove") {
    return {
      text: `\ud83d\uddd1 <b>Issue removed</b>${inProject(project)} by ${actor}\n${titleWithId(title, identifier)}`,
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
      text: `${emoji} <b>Marked as ${escapeHtml(state?.name ?? "Unknown")}</b> by ${actor}\n${titleWithId(title, identifier)}\n${escapeHtml(oldState.name)} \u2192 ${escapeHtml(state?.name ?? "Unknown")}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Assignee change
  if ("assignee" in updatedFrom || "assigneeId" in updatedFrom) {
    const assignee = getDataField<{ name: string }>(data, "assignee");
    if (assignee) {
      return {
        text: `\ud83d\udc64 <b>Assigned to ${escapeHtml(assignee.name)}</b> by ${actor}\n${titleWithId(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    } else {
      return {
        text: `\ud83d\udc64 <b>Unassigned</b> by ${actor}\n${titleWithId(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }
  }

  // Priority change — only show if escalated to urgent
  if ("priority" in updatedFrom) {
    const oldPriority = updatedFrom.priority as number;
    const isEscalation = priority < oldPriority;

    if (priority === 1) {
      // Escalated to urgent — always show
      return {
        text: `\ud83d\udd34 <b>Escalated to Urgent</b> by ${actor}\n${titleWithId(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }

    if (isEscalation) {
      // Escalated but not to urgent — brief note
      const newLabel = PRIORITY_LABEL[priority] ?? "Unknown";
      return {
        text: `\u26a1 <b>Priority raised to ${escapeHtml(newLabel)}</b> by ${actor}\n${titleWithId(title, identifier)}`,
        url: payload.url,
        projectId: project?.id,
      };
    }

    // Lowered priority — skip (return null to filter it out)
    return null;
  }

  // Generic update
  const changedFields = Object.keys(updatedFrom);
  return {
    text: `\ud83d\udd04 <b>Issue updated</b> by ${actor}\n${titleWithId(title, identifier)}\nChanged: ${changedFields.map(escapeHtml).join(", ")}`,
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
  const issueTitle = issue
    ? titleWithId(escapeHtml(issue.title), issue.identifier)
    : "";

  if (payload.action === "create") {
    return {
      text: `\ud83d\udcac <b>Comment</b> by ${actor}\n${issueTitle}\n\u201c${body}\u201d`,
      url: payload.url,
    };
  }

  return {
    text: `\ud83d\udcac <b>Comment ${payload.action}d</b> by ${actor}\n${issueTitle}`,
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
    text: `\ud83d\udce2 <b>Project update</b>${inProject(project)} by ${actor}\n\u201c${body}\u201d`,
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
    text: `${actionLabels[payload.action] ?? "\u23f1 SLA event"}\n${titleWithId(escapeHtml(issue.title), issue.identifier)}`,
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
