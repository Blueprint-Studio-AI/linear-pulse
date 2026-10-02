import { describe, it, expect } from "vitest";
import { handleTelegramUpdate, registerProject } from "./telegram";
import { defaultFilterConfig } from "../types/config";
import type { Channel } from "../types/config";
import { fakeKV, fakeTelegram } from "../testing/fakes";

const DEFAULT_CHAT = "-100999";
const ADMIN = 42;
const STRANGER = 7;

function message(chatId: number, userId: number | undefined, text: string, title?: string) {
  return {
    message: {
      message_id: 1,
      chat: { id: chatId, title },
      from: userId === undefined ? undefined : { id: userId, first_name: "Test" },
      text,
    },
  };
}

function setup(extra: Record<string, unknown> = {}) {
  const kv = fakeKV({
    admin_users: [ADMIN],
    project_directory: [
      { id: "p-honeyb", name: "HoneyB" },
      { id: "p-arch", name: "Arch <Prime>" },
    ],
    ...extra,
  });
  const tg = fakeTelegram();
  const send = (chatId: number, userId: number | undefined, text: string, title?: string) =>
    handleTelegramUpdate(message(chatId, userId, text, title), tg.client, kv.kv, DEFAULT_CHAT);
  return { ...kv, ...tg, send };
}

describe("handleTelegramUpdate — who Blue answers", () => {
  it("ignores every command in a chat it doesn't post to", async () => {
    const t = setup();
    await t.send(5555, STRANGER, "/projects");
    await t.send(5555, STRANGER, "/status");
    await t.send(5555, STRANGER, "/help");
    expect(t.sent).toHaveLength(0);
  });

  it("does not let a stranger register their chat", async () => {
    const t = setup();
    await t.send(-100555, STRANGER, "/mute Reaction");
    expect(t.sent).toHaveLength(0);
    expect(t.read("channels")).toBeUndefined();
  });

  it("answers /whoami anywhere, so admins can find their IDs", async () => {
    const t = setup();
    await t.send(-100555, STRANGER, "/whoami");
    expect(t.sent[0]!.text).toContain("<code>7</code>");
    expect(t.sent[0]!.text).toContain("<code>-100555</code>");
  });

  it("answers open commands in the default chat", async () => {
    const t = setup();
    await t.send(Number(DEFAULT_CHAT), STRANGER, "/projects");
    expect(t.sent).toHaveLength(1);
  });

  it("refuses admin commands from non-admins in a known chat", async () => {
    const t = setup();
    await t.send(Number(DEFAULT_CHAT), STRANGER, "/mute Reaction");
    expect(t.sent[0]!.text).toBe("Only admins can change config.");
    expect(t.read("channels")).toBeUndefined();
  });

  it("refuses admin commands when no admins are configured", async () => {
    const t = setup({ admin_users: [] });
    await t.send(Number(DEFAULT_CHAT), STRANGER, "/mute Reaction");
    expect(t.sent[0]!.text).toContain("No admins are set up yet");
    expect(t.read("channels")).toBeUndefined();
  });

  it("refuses admin commands with no sender (anonymous admins)", async () => {
    const t = setup();
    await t.send(Number(DEFAULT_CHAT), undefined, "/mute Reaction");
    expect(t.read("channels")).toBeUndefined();
  });

  it("lets an admin register a new chat, named after the group", async () => {
    const t = setup();
    await t.send(-100555, ADMIN, "/track HoneyB", "HoneyB x Blueprint");
    const channels = t.read<Channel[]>("channels")!;
    expect(channels).toHaveLength(1);
    expect(channels[0]!.chatId).toBe("-100555");
    expect(channels[0]!.name).toBe("HoneyB x Blueprint");
    expect(channels[0]!.filters.scope.projects).toEqual(["p-honeyb"]);
  });
});

describe("handleTelegramUpdate — channel config", () => {
  it("does not leak one new chat's settings into the next", async () => {
    const t = setup();
    await t.send(-100111, ADMIN, "/track HoneyB");
    await t.send(-100222, ADMIN, "/mute Reaction");
    const channels = t.read<Channel[]>("channels")!;
    const second = channels.find((c) => c.chatId === "-100222")!;
    expect(second.filters.scope.projects).toEqual([]);
    expect(defaultFilterConfig().scope.projects).toEqual([]);
    expect(defaultFilterConfig().events).toEqual({});
  });

  it("/reset gives the chat a clean config", async () => {
    const t = setup();
    await t.send(-100111, ADMIN, "/track HoneyB");
    await t.send(-100111, ADMIN, "/mute Comment");
    await t.send(-100111, ADMIN, "/reset");
    const channel = t.read<Channel[]>("channels")![0]!;
    expect(channel.filters).toEqual(defaultFilterConfig());
  });

  it("escapes user text and project names it echoes back", async () => {
    const t = setup();
    await t.send(Number(DEFAULT_CHAT), ADMIN, "/track <script>");
    expect(t.sent[0]!.text).toContain("&lt;script&gt;");
    expect(t.sent[0]!.text).toContain("Arch &lt;Prime&gt;");
    expect(t.sent[0]!.text).not.toContain("<script>");
  });
});

describe("registerProject", () => {
  it("adds new projects and picks up renames", async () => {
    const { kv, read } = fakeKV();
    await registerProject(kv, "p1", "Old name");
    await registerProject(kv, "p1", "New name");
    await registerProject(kv, "p2", "Other");
    expect(read("project_directory")).toEqual([
      { id: "p1", name: "New name" },
      { id: "p2", name: "Other" },
    ]);
  });
});
