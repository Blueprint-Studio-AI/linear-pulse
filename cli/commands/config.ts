import { PulseAPI } from "../api";

const ALL_ACTIONS = ["create", "update", "remove"];
const SLA_ACTIONS = ["set", "highRisk", "breached"];

function allActionsFor(resource: string): string[] {
  return resource === "IssueSLA" ? SLA_ACTIONS : ALL_ACTIONS;
}

export async function configGet(
  workerUrl: string,
  adminToken: string
): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);
  const config = await api.getConfig();
  console.log(JSON.stringify(config, null, 2));
}

export async function configSet(
  workerUrl: string,
  adminToken: string,
  args: string[]
): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);
  const current = (await api.getConfig()) as Record<string, unknown>;

  const disableIdx = args.indexOf("--disable");
  if (disableIdx !== -1 && args[disableIdx + 1]) {
    const target = args[disableIdx + 1]!;
    const events = (current.events ?? {}) as Record<string, string[]>;

    if (target.includes(".")) {
      // Disable specific action: Issue.remove
      const [resource, action] = target.split(".");
      if (resource && action) {
        // If key doesn't exist (all allowed), populate with all actions minus this one
        const currentActions = events[resource] ?? allActionsFor(resource);
        events[resource] = currentActions.filter((a) => a !== action);
      }
    } else {
      // Disable entire resource type
      events[target] = [];
    }

    const result = await api.updateConfig({ events });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const enableIdx = args.indexOf("--enable");
  if (enableIdx !== -1 && args[enableIdx + 1]) {
    const target = args[enableIdx + 1]!;
    const events = (current.events ?? {}) as Record<string, string[]>;

    if (target.includes(".")) {
      // Enable specific action: Issue.remove
      const [resource, action] = target.split(".");
      if (resource && action) {
        // Only matters if the resource has a restricted list
        if (events[resource]) {
          if (!events[resource]!.includes(action)) events[resource]!.push(action);
          // If all actions are now enabled, remove the key entirely
          if (allActionsFor(resource).every((a) => events[resource]!.includes(a))) {
            delete events[resource];
          }
        }
        // If key doesn't exist, all actions already allowed — no-op
      }
    } else {
      // Enable entire resource type (remove override)
      delete events[target];
    }

    const result = await api.updateConfig({ events });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    "Usage: linear-pulse config set --disable <ResourceType[.action]>"
  );
  console.log(
    "       linear-pulse config set --enable <ResourceType[.action]>"
  );
}

export async function configReset(
  workerUrl: string,
  adminToken: string
): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);
  const result = await api.updateConfig({
    events: {},
    scope: { projects: [], teams: [], labels: [] },
    updates: {
      ignoreFields: ["sortOrder", "boardOrder", "subscriberIds", "trashed"],
    },
  });
  console.log("Config reset to defaults.");
  console.log(JSON.stringify(result, null, 2));
}
