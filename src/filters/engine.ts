import type { FilterConfig } from "../types/config";
import type { LinearWebhookPayload } from "../types/linear";

export function shouldForwardEvent(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  if (!passesEventFilter(payload, config)) return false;
  if (!passesScopeFilter(payload, config)) return false;
  if (!passesFieldFilter(payload, config)) return false;
  return true;
}

function passesEventFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  const allowedActions = config.events[payload.type];
  if (allowedActions === undefined) return true;
  if (allowedActions.length === 0) return false;
  return allowedActions.includes(payload.action as (typeof allowedActions)[number]);
}

function passesScopeFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  const data = payload.data as Record<string, unknown>;

  if (config.scope.projects.length > 0) {
    const project = data.project as { id: string } | undefined;
    // If payload has no project field (comments, etc.), let it through
    if (project && !config.scope.projects.includes(project.id)) return false;
  }

  if (config.scope.teams.length > 0) {
    const team = data.team as { id: string } | undefined;
    // If payload has no team field (comments, project updates, etc.), let it through
    if (team && !config.scope.teams.includes(team.id)) return false;
  }

  if (config.scope.labels.length > 0) {
    const labels = (data.labels as Array<{ name: string }>) || [];
    const labelNames = labels.map((l) => l.name);
    if (!config.scope.labels.some((l) => labelNames.includes(l))) return false;
  }

  return true;
}

function passesFieldFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  if (payload.action !== "update") return true;
  if (!payload.updatedFrom) return true;

  const changedFields = Object.keys(payload.updatedFrom);
  const meaningfulFields = changedFields.filter(
    (field) => !config.updates.ignoreFields.includes(field)
  );

  return meaningfulFields.length > 0;
}
