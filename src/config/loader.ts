import type { FilterConfig } from "../types/config";
import { DEFAULT_FILTER_CONFIG } from "../types/config";

const FILTER_CONFIG_KEY = "filter_config";

export async function loadFilterConfig(
  kv: KVNamespace
): Promise<FilterConfig> {
  const raw = await kv.get(FILTER_CONFIG_KEY);
  if (!raw) return DEFAULT_FILTER_CONFIG;

  const overrides = JSON.parse(raw) as Partial<FilterConfig>;
  return mergeConfig(DEFAULT_FILTER_CONFIG, overrides);
}

export async function saveFilterConfig(
  kv: KVNamespace,
  config: FilterConfig
): Promise<void> {
  await kv.put(FILTER_CONFIG_KEY, JSON.stringify(config));
}

function mergeConfig(
  defaults: FilterConfig,
  overrides: Partial<FilterConfig>
): FilterConfig {
  return {
    events:
      overrides.events !== undefined
        ? { ...defaults.events, ...overrides.events }
        : defaults.events,
    scope: {
      projects: overrides.scope?.projects ?? defaults.scope.projects,
      teams: overrides.scope?.teams ?? defaults.scope.teams,
      labels: overrides.scope?.labels ?? defaults.scope.labels,
    },
    updates: {
      ignoreFields:
        overrides.updates?.ignoreFields ?? defaults.updates.ignoreFields,
    },
  };
}

export function validateFilterConfig(
  input: unknown
): input is Partial<FilterConfig> {
  if (typeof input !== "object" || input === null) return false;

  const obj = input as Record<string, unknown>;

  if (obj.events !== undefined) {
    if (typeof obj.events !== "object" || obj.events === null) return false;
    for (const actions of Object.values(
      obj.events as Record<string, unknown>
    )) {
      if (!Array.isArray(actions)) return false;
      if (!actions.every((a) => typeof a === "string")) return false;
    }
  }

  if (obj.scope !== undefined) {
    if (typeof obj.scope !== "object" || obj.scope === null) return false;
    const scope = obj.scope as Record<string, unknown>;
    for (const key of ["projects", "teams", "labels"]) {
      if (scope[key] !== undefined) {
        if (!Array.isArray(scope[key])) return false;
        if (!(scope[key] as unknown[]).every((v) => typeof v === "string"))
          return false;
      }
    }
  }

  if (obj.updates !== undefined) {
    if (typeof obj.updates !== "object" || obj.updates === null) return false;
    const updates = obj.updates as Record<string, unknown>;
    if (updates.ignoreFields !== undefined) {
      if (!Array.isArray(updates.ignoreFields)) return false;
      if (!updates.ignoreFields.every((v) => typeof v === "string"))
        return false;
    }
  }

  return true;
}
