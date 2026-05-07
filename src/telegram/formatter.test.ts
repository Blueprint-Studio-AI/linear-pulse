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
  it("formats issue creation with project in header", () => {
    const result = formatLinearEvent(makeIssuePayload("create", {}));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("New issue");
    expect(result!.text).toContain("in Linear Pulse");
    expect(result!.text).toContain("by Tyler");
    expect(result!.text).toContain("API rate limiting");
    expect(result!.text).toContain("(ENG-142)");
    expect(result!.url).toBe("https://linear.app/test/issue/ENG-142");
  });

  it("shows urgent tag on creation", () => {
    const result = formatLinearEvent(makeIssuePayload("create", { priority: 1 }));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("\ud83d\udd34");
  });

  it("does not show priority tag for non-urgent", () => {
    const result = formatLinearEvent(makeIssuePayload("create", { priority: 3 }));
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("Priority");
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
    expect(result!.text).toContain("(ENG-142)");
  });

  it("formats assignee change with title", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { assignee: { id: "u2", name: "Jordan" } },
        { assignee: null }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Assigned to Jordan");
    expect(result!.text).toContain("by Tyler");
    expect(result!.text).toContain("API rate limiting");
    expect(result!.text).toContain("(ENG-142)");
  });

  it("shows escalation to urgent", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { priority: 1, priorityLabel: "Urgent" },
        { priority: 3, priorityLabel: "Medium" }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Escalated to Urgent");
    expect(result!.text).toContain("\ud83d\udd34");
  });

  it("shows non-urgent escalation briefly", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { priority: 2, priorityLabel: "High" },
        { priority: 3, priorityLabel: "Medium" }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Priority raised to High");
  });

  it("returns null for priority lowering", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { priority: 4, priorityLabel: "Low" },
        { priority: 2, priorityLabel: "High" }
      )
    );
    expect(result).toBeNull();
  });

  it("formats comment with issue title", () => {
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
    expect(result!.text).toContain("API rate limiting");
    expect(result!.text).toContain("(ENG-142)");
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
