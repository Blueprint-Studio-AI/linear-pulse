import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import app from "./index";
import { fakeKV } from "./testing/fakes";

const SECRET = "whs_test_secret";

async function sign(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeEnv(kv: KVNamespace, overrides: Record<string, string | undefined> = {}) {
  return {
    CONFIG: kv,
    LINEAR_WEBHOOK_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_CHAT_ID: "-100999",
    ADMIN_TOKEN: "admin-token",
    TELEGRAM_WEBHOOK_SECRET: "tg-secret",
    ...overrides,
  };
}

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, flush: () => Promise.all(pending) };
}

let telegramCalls: Array<{ chat_id: string; text: string }>;

beforeEach(() => {
  telegramCalls = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    telegramCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postLinear(
  kv: KVNamespace,
  payload: Record<string, unknown>
): Promise<Response> {
  const body = JSON.stringify({
    url: "https://linear.app/bp/issue/BP-1",
    createdAt: new Date().toISOString(),
    webhookTimestamp: Date.now(),
    webhookId: "wh",
    organizationId: "org",
    actor: { id: "u1", type: "user", name: "Tyler Stupart" },
    ...payload,
  });
  const { ctx, flush } = makeCtx();
  const res = await app.request(
    "/webhook/linear",
    { method: "POST", body, headers: { "Linear-Signature": await sign(body) } },
    makeEnv(kv),
    ctx
  );
  await flush();
  return res;
}

describe("auth", () => {
  it("rejects admin requests when ADMIN_TOKEN is not set", async () => {
    const { kv } = fakeKV();
    const res = await app.request("/config", {}, makeEnv(kv, { ADMIN_TOKEN: undefined }));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong admin token and accepts the right one", async () => {
    const { kv } = fakeKV();
    const env = makeEnv(kv);
    const wrong = await app.request("/config", { headers: { Authorization: "Bearer nope" } }, env);
    expect(wrong.status).toBe(401);
    const right = await app.request("/config", { headers: { Authorization: "Bearer admin-token" } }, env);
    expect(right.status).toBe(200);
  });

  it("rejects Telegram updates when TELEGRAM_WEBHOOK_SECRET is not set", async () => {
    const { kv } = fakeKV();
    const res = await app.request(
      "/webhook/telegram",
      { method: "POST", body: JSON.stringify({ message: { message_id: 1, chat: { id: -100999 }, text: "/help" } }) },
      makeEnv(kv, { TELEGRAM_WEBHOOK_SECRET: undefined })
    );
    expect(res.status).toBe(401);
    expect(telegramCalls).toHaveLength(0);
  });

  it("rejects an unsigned Linear webhook", async () => {
    const { kv } = fakeKV();
    const res = await app.request(
      "/webhook/linear",
      { method: "POST", body: "{}", headers: { "Linear-Signature": "00" } },
      makeEnv(kv)
    );
    expect(res.status).toBe(401);
  });
});

describe("Linear webhook routing", () => {
  const issue = {
    id: "issue-1",
    identifier: "BP-1",
    title: "Fix the thing",
    priority: 3,
    state: { id: "s1", name: "Todo", type: "unstarted" },
    project: { id: "p-honeyb", name: "HoneyB" },
    projectId: "p-honeyb",
    labels: [],
  };

  it("caches issue→project even for updates that don't notify", async () => {
    const { kv, store } = fakeKV();
    const res = await postLinear(kv, {
      type: "Issue",
      action: "update",
      data: issue,
      updatedFrom: { description: "old" },
    });
    expect(await res.json()).toMatchObject({ status: "skipped" });
    expect(store.get("ip:issue-1")).toBe("p-honeyb");
    expect(JSON.parse(store.get("project_directory")!)).toEqual([{ id: "p-honeyb", name: "HoneyB" }]);
  });

  it("routes a comment that only carries issueId to the right chats", async () => {
    const scoped = (chatId: string, projects: string[]) => ({
      chatId,
      name: chatId,
      filters: {
        events: {},
        scope: { projects, teams: [], labels: [] },
        updates: { ignoreFields: [] },
      },
    });
    const { kv } = fakeKV({
      "ip:issue-1": "p-honeyb",
      channels: [scoped("-100honeyb", ["p-honeyb"]), scoped("-100arch", ["p-arch"]), scoped("-100all", [])],
    });
    const res = await postLinear(kv, {
      type: "Comment",
      action: "create",
      data: { id: "c1", body: "Shipped & verified", issueId: "issue-1", userId: "u1" },
    });
    expect(await res.json()).toMatchObject({ status: "sent", channels: 2 });
    expect(telegramCalls.map((c) => c.chat_id).sort()).toEqual(["-100all", "-100honeyb"]);
    expect(telegramCalls[0]!.text).toContain("Shipped &amp; verified");
  });

  it("keeps delivering to other chats when one send throws", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.chat_id === "-100a") throw new Error("network down");
      telegramCalls.push(body);
      return new Response(JSON.stringify({ ok: true }));
    });
    const open = (chatId: string) => ({
      chatId,
      name: chatId,
      filters: { events: {}, scope: { projects: [], teams: [], labels: [] }, updates: { ignoreFields: [] } },
    });
    const { kv } = fakeKV({ channels: [open("-100a"), open("-100b")] });
    const res = await postLinear(kv, { type: "Issue", action: "create", data: issue });
    expect(res.status).toBe(200);
    expect(telegramCalls.map((c) => c.chat_id)).toEqual(["-100b"]);
  });

  it("shows Old → New using the state name seen on an earlier event", async () => {
    const { kv } = fakeKV();
    // Shapes match what Linear sent in the 2026-10-02 live check
    await postLinear(kv, {
      type: "Issue",
      action: "create",
      data: { ...issue, state: { id: "s-todo", name: "Todo", type: "unstarted" } },
    });
    telegramCalls = [];
    await postLinear(kv, {
      type: "Issue",
      action: "update",
      data: { ...issue, state: { id: "s-prog", name: "In Progress", type: "started" } },
      updatedFrom: { updatedAt: "x", sortOrder: 1, startedAt: null, assigneeId: null, stateId: "s-todo" },
    });
    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0]!.text).toContain("Todo \u2192 In Progress");
  });

  it("falls back to TELEGRAM_CHAT_ID when no channels exist", async () => {
    const { kv } = fakeKV();
    await postLinear(kv, { type: "Issue", action: "create", data: issue });
    expect(telegramCalls.map((c) => c.chat_id)).toEqual(["-100999"]);
  });
});
