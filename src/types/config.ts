import type { LinearResourceType, LinearAction, LinearSLAAction } from "./linear";

export type EventActions = Array<LinearAction | LinearSLAAction>;

export interface FilterConfig {
  events: Partial<Record<LinearResourceType, EventActions>>;
  scope: {
    projects: string[];
    teams: string[];
    labels: string[];
  };
  updates: {
    ignoreFields: string[];
  };
}

export interface DisplayConfig {
  showProject: boolean;
  showIdentifier: boolean;
  showActor: boolean;
  showTransition: boolean; // "Old → New" on status changes
  showAssignments: boolean;
  showUnassignments: boolean;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  showProject: true,
  showIdentifier: true,
  showActor: true,
  showTransition: true,
  showAssignments: true,
  showUnassignments: true,
};

export interface Channel {
  chatId: string;
  name: string;
  filters: FilterConfig;
  display?: DisplayConfig;
}

// Returns a fresh object each call. Channels mutate their filters in place,
// so a shared default would leak one chat's settings into the next.
export function defaultFilterConfig(): FilterConfig {
  return {
    events: {},
    scope: {
      projects: [],
      teams: [],
      labels: [],
    },
    updates: {
      ignoreFields: ["sortOrder", "boardOrder", "subscriberIds", "trashed"],
    },
  };
}
