import { PulseAPI } from "../api";

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
      const [resource, action] = target.split(".");
      if (resource && action && events[resource]) {
        events[resource] = events[resource]!.filter((a) => a !== action);
      }
    } else {
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
      const [resource, action] = target.split(".");
      if (resource && action) {
        if (!events[resource]) events[resource] = [];
        if (!events[resource]!.includes(action)) events[resource]!.push(action);
      }
    } else {
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
