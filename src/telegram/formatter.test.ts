import { describe, it, expect } from "vitest";
import { formatLinearEvent } from "./formatter";
import type { LinearWebhookPayload } from "../types/linear";

function makeIssuePayload(
  action: string,
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>
): LinearWebhookPayload {
  return {
    action: action as LinearWebhookPayload["action"],
    type: "Issue",
    actor: { id: "u1", type: "user", name: "Tyler" },
    data: {
      id: "i1",
      identifier: "ENG-142",
      title: "API rate limiting for external clients",
      priority: 2,
      priorityLabel: "High",
      state: { id: "s1", name: "In Progress", type: "started" },
      team: { id: "t1", name: "Engineering", key: "ENG" },
      project: { id: "p1", name: "Linear Pulse" },
      labels: [],
      ...data,
    },
    updatedFrom,
    url: "https://linear.app/test/issue/ENG-142",
    createdAt: new Date().toISOString(),
    webhookTimestamp: Date.now(),
    webhookId: "wh-1",
    organizationId: "org-1",
  };
}

describe("formatLinearEvent", () => {
  it("formats issue creation", () => {
    const result = formatLinearEvent(makeIssuePayload("create", {}));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("New issue");
    expect(result!.text).toContain("Tyler");
    expect(result!.text).toContain("ENG-142");
    expect(result!.text).toContain("API rate limiting");
    expect(result!.url).toBe("https://linear.app/test/issue/ENG-142");
  });

  it("formats status change", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { state: { id: "s2", name: "Done", type: "completed" } },
        { state: { id: "s1", name: "In Progress", type: "started" } }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Done");
    expect(result!.text).toContain("In Progress");
  });

  it("formats assignee change", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { assignee: { id: "u2", name: "Jordan" } },
        { assignee: null }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("assigned");
    expect(result!.text).toContain("Jordan");
  });

  it("formats comment creation", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      actor: { id: "u1", type: "user", name: "Alex" },
      data: {
        id: "c1",
        body: "Can we scope this to just the public API for v1?",
        issue: { id: "i1", identifier: "ENG-142", title: "API rate limiting" },
        user: { id: "u1", name: "Alex" },
      },
      url: "https://linear.app/test/issue/ENG-142#comment-c1",
      createdAt: new Date().toISOString(),
      webhookTimestamp: Date.now(),
      webhookId: "wh-2",
      organizationId: "org-1",
    };
    const result = formatLinearEvent(payload);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Alex");
    expect(result!.text).toContain("scope this to just the public API");
  });

  it("truncates long comments", () => {
    const longBody = "A".repeat(300);
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      actor: { id: "u1", type: "user", name: "Alex" },
      data: {
        id: "c1",
        body: longBody,
        issue: { id: "i1", identifier: "ENG-142", title: "Test" },
        user: { id: "u1", name: "Alex" },
      },
      url: "https://linear.app/test/issue/ENG-142#comment-c1",
      createdAt: new Date().toISOString(),
      webhookTimestamp: Date.now(),
      webhookId: "wh-2",
      organizationId: "org-1",
    };
    const result = formatLinearEvent(payload);
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThan(longBody.length);
    expect(result!.text).toContain("...");
  });

  it("formats priority change", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { priority: 1, priorityLabel: "Urgent" },
        { priority: 3, priorityLabel: "Medium" }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("escalated");
    expect(result!.text).toContain("Medium");
    expect(result!.text).toContain("Urgent");
  });

  it("formats generic event type", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Cycle",
      actor: { id: "u1", type: "user", name: "Tyler" },
      data: { id: "c1", name: "Sprint 14" },
      url: "https://linear.app/test/cycle/c1",
      createdAt: new Date().toISOString(),
      webhookTimestamp: Date.now(),
      webhookId: "wh-3",
      organizationId: "org-1",
    };
    const result = formatLinearEvent(payload);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Cycle");
    expect(result!.text).toContain("Sprint 14");
  });
});
