import type { FilterConfig } from "../types/config";
import type { LinearWebhookPayload } from "../types/linear";

export interface ScopeContext {
  resolvedProjectId?: string;
}

export function shouldForwardEvent(
  payload: LinearWebhookPayload,
  config: FilterConfig,
  scope?: ScopeContext
): boolean {
  if (!passesEventFilter(payload, config)) return false;
  if (!passesScopeFilter(payload, config, scope)) return false;
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

function extractScope(data: Record<string, unknown>): {
  projectId?: string;
  teamId?: string;
} {
  const project = data.project as { id: string } | undefined;
  const team = data.team as { id: string } | undefined;
  const issue = data.issue as Record<string, unknown> | undefined;

  return {
    projectId:
      project?.id ??
      (issue?.project as { id: string } | undefined)?.id,
    teamId:
      team?.id ??
      (issue?.team as { id: string } | undefined)?.id,
  };
}

function passesScopeFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig,
  scope?: ScopeContext
): boolean {
  const data = payload.data as Record<string, unknown>;
  const extracted = extractScope(data);
  // Use cached project ID if the payload doesn't have one
  const projectId = extracted.projectId ?? scope?.resolvedProjectId;
  const teamId = extracted.teamId;

  if (config.scope.projects.length > 0) {
    if (!projectId || !config.scope.projects.includes(projectId)) return false;
  }

  if (config.scope.teams.length > 0) {
    if (!teamId || !config.scope.teams.includes(teamId)) return false;
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
