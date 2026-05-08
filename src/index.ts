import { Hono } from "hono";
import { verifyLinearSignature, isTimestampValid } from "./webhook/verify";
import { handleTelegramUpdate, registerProject } from "./webhook/telegram";
import { shouldForwardEvent } from "./filters/engine";
import { formatLinearEvent } from "./telegram/formatter";
import { TelegramClient } from "./telegram/client";
import {
  loadChannels,
  loadFilterConfig,
  saveFilterConfig,
  validateFilterConfig,
} from "./config/loader";
import type { LinearWebhookPayload } from "./types/linear";
import type { Channel } from "./types/config";

type Bindings = {
  CONFIG: KVNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ADMIN_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Request logger
app.use("*", async (c, next) => {
  console.log(`[linear-pulse] ${c.req.method} ${c.req.path} from ${c.req.header("user-agent") ?? "unknown"}`);
  await next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "linear-pulse" }));

// Send a formatted message to a specific chat
async function sendToChat(
  telegram: TelegramClient,
  chatId: string,
  text: string,
  url: string
): Promise<void> {
  const result = await telegram.sendMessage({
    chatId,
    text,
    replyMarkup: {
      inline_keyboard: [[{ text: "View in Linear", url }]],
    },
  });

  if (!result.ok) {
    console.error(`[send] Failed to ${chatId}: ${result.description}`);
  } else {
    console.log(`[send] OK to ${chatId}`);
  }
}

// Linear webhook handler
async function handleLinearWebhook(c: {
  req: { text: () => Promise<string>; header: (name: string) => string | undefined };
  env: Bindings;
  json: (data: unknown, status?: number) => Response;
}): Promise<Response> {
  const rawBody = await c.req.text();

  // 1. Verify signature
  const signature = c.req.header("Linear-Signature") ?? "";
  if (!signature) {
    return c.json({ error: "missing signature" }, 401);
  }

  const isValid = await verifyLinearSignature(
    rawBody,
    signature,
    c.env.LINEAR_WEBHOOK_SECRET
  );
  if (!isValid) {
    console.log("[webhook] Signature verification FAILED");
    return c.json({ error: "invalid signature" }, 401);
  }

  // 2. Parse and validate
  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return c.json({ error: "invalid payload" }, 400);
  }

  console.log(`[webhook] ${payload.type}.${payload.action} by ${payload.actor?.name ?? "unknown"}`);
  if (payload.updatedFrom) {
    console.log(`[webhook] updatedFrom: ${Object.keys(payload.updatedFrom).join(", ")}`);
  }
  // Debug: log scope-relevant fields
  const debugData = payload.data as Record<string, unknown>;
  const debugProject = debugData.project as { id: string } | undefined;
  const debugIssue = debugData.issue as Record<string, unknown> | undefined;
  const debugIssueProject = debugIssue?.project as { id: string } | undefined;
  console.log(`[webhook] project: ${debugProject?.id ?? "none"}, issue.project: ${debugIssueProject?.id ?? "none"}, issue keys: ${debugIssue ? Object.keys(debugIssue).join(",") : "n/a"}`);

  if (!isTimestampValid(payload.webhookTimestamp)) {
    return c.json({ error: "timestamp drift" }, 401);
  }

  // 3. Format the message (same for all channels)
  const message = formatLinearEvent(payload);
  if (!message) {
    console.log("[webhook] No notification for this event");
    return c.json({ status: "skipped" }, 200);
  }

  // 4. Auto-register project
  const data = payload.data as Record<string, unknown>;
  const project = data.project as { id: string; name: string } | undefined;
  if (project?.id && project?.name) {
    await registerProject(c.env.CONFIG, project.id, project.name);
  }

  // 5. Load channels and route
  const channels = await loadChannels(c.env.CONFIG);
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);

  if (channels.length === 0) {
    // No channels configured — fall back to TELEGRAM_CHAT_ID with global config
    const config = await loadFilterConfig(c.env.CONFIG);
    if (!shouldForwardEvent(payload, config)) {
      console.log("[webhook] Filtered by global config");
      return c.json({ status: "filtered" }, 200);
    }
    await sendToChat(telegram, c.env.TELEGRAM_CHAT_ID, message.text, message.url);
    return c.json({ status: "sent" }, 200);
  }

  // Route to each channel that passes its filters
  let sentCount = 0;
  for (const channel of channels) {
    if (!shouldForwardEvent(payload, channel.filters)) {
      console.log(`[webhook] Filtered for ${channel.name}`);
      continue;
    }
    await sendToChat(telegram, channel.chatId, message.text, message.url);
    sentCount++;
  }

  console.log(`[webhook] Sent to ${sentCount}/${channels.length} channels`);
  return c.json({ status: "sent", channels: sentCount }, 200);
}

// Accept webhooks at both paths
app.post("/webhook/linear", (c) => handleLinearWebhook(c));
app.post("/", (c) => {
  if (c.req.header("Linear-Signature") || c.req.header("Linear-Event")) {
    return handleLinearWebhook(c);
  }
  return c.json({ error: "not found" }, 404);
});

// Telegram bot commands
app.post("/webhook/telegram", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const update = await c.req.json();
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  await handleTelegramUpdate(update, telegram, c.env.CONFIG);
  return c.json({ ok: true });
});

// Admin: get channels
app.get("/channels", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const channels = await loadChannels(c.env.CONFIG);
  return c.json(channels);
});

// Admin: get global config (fallback when no channels)
app.get("/config", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const config = await loadFilterConfig(c.env.CONFIG);
  return c.json(config);
});

// Admin: update global config
app.put("/config", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json();
  if (!validateFilterConfig(body)) {
    return c.json({ error: "invalid config" }, 400);
  }

  const current = await loadFilterConfig(c.env.CONFIG);
  const merged = {
    events: body.events !== undefined ? body.events : current.events,
    scope: {
      projects: body.scope?.projects ?? current.scope.projects,
      teams: body.scope?.teams ?? current.scope.teams,
      labels: body.scope?.labels ?? current.scope.labels,
    },
    updates: {
      ignoreFields: body.updates?.ignoreFields ?? current.updates.ignoreFields,
    },
  };
  await saveFilterConfig(c.env.CONFIG, merged);
  return c.json({ status: "updated", config: merged });
});

export default app;
