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

export interface TopicMapping {
  topicId: number;
  name: string;
}

export interface TopicConfig {
  topics: Record<string, TopicMapping>;
}

export interface DisplayConfig {
  showProject: boolean;
  showIdentifier: boolean;
  showActor: boolean;
  showTransition: boolean; // "Old → New" on status changes
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  showProject: true,
  showIdentifier: true,
  showActor: true,
  showTransition: true,
};

export interface Channel {
  chatId: string;
  name: string;
  filters: FilterConfig;
  display?: DisplayConfig;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
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
