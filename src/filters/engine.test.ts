import { describe, it, expect } from "vitest";
import { shouldForwardEvent } from "./engine";
import { DEFAULT_FILTER_CONFIG } from "../types/config";
import type { LinearWebhookPayload } from "../types/linear";
import type { FilterConfig } from "../types/config";

function makePayload(
  overrides: Partial<LinearWebhookPayload> = {}
): LinearWebhookPayload {
  return {
    action: "create",
    type: "Issue",
    data: {
      id: "issue-1",
      identifier: "ENG-1",
      title: "Test issue",
      team: { id: "team-1", name: "Engineering", key: "ENG" },
      project: { id: "proj-1", name: "Test Project" },
      labels: [],
    },
    url: "https://linear.app/test/issue/ENG-1",
    createdAt: new Date().toISOString(),
    webhookTimestamp: Date.now(),
    webhookId: "wh-1",
    organizationId: "org-1",
    ...overrides,
  };
}

describe("shouldForwardEvent", () => {
  it("forwards all events with default config", () => {
    expect(shouldForwardEvent(makePayload(), DEFAULT_FILTER_CONFIG)).toBe(true);
  });

  it("blocks a disabled resource type", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      events: { Issue: [] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(false);
  });

  it("blocks a disabled action", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      events: { Issue: ["create"] },
    };
    expect(shouldForwardEvent(makePayload({ action: "update" }), config)).toBe(
      false
    );
  });

  it("allows a permitted action", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      events: { Issue: ["create", "update"] },
    };
    expect(
      shouldForwardEvent(makePayload({ action: "create" }), config)
    ).toBe(true);
  });

  it("filters by project scope", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      scope: { ...DEFAULT_FILTER_CONFIG.scope, projects: ["proj-other"] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(false);
  });

  it("allows matching project scope", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      scope: { ...DEFAULT_FILTER_CONFIG.scope, projects: ["proj-1"] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(true);
  });

  it("filters by team scope", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      scope: { ...DEFAULT_FILTER_CONFIG.scope, teams: ["team-other"] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(false);
  });

  it("ignores noisy field-only updates", () => {
    const payload = makePayload({
      action: "update",
      updatedFrom: { sortOrder: 1.5 },
    });
    expect(shouldForwardEvent(payload, DEFAULT_FILTER_CONFIG)).toBe(false);
  });

  it("allows updates with meaningful field changes", () => {
    const payload = makePayload({
      action: "update",
      updatedFrom: { sortOrder: 1.5, state: { name: "Todo" } },
    });
    expect(shouldForwardEvent(payload, DEFAULT_FILTER_CONFIG)).toBe(true);
  });
});
