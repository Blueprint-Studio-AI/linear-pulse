import { Hono } from "hono";
import { verifyLinearSignature, isTimestampValid } from "./webhook/verify";
import { shouldForwardEvent } from "./filters/engine";
import { formatLinearEvent } from "./telegram/formatter";
import { TelegramClient } from "./telegram/client";
import { TopicRouter } from "./topics/router";
import {
  loadFilterConfig,
  saveFilterConfig,
  validateFilterConfig,
} from "./config/loader";
import type { LinearWebhookPayload } from "./types/linear";

type Bindings = {
  CONFIG: KVNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "linear-pulse" }));

// Linear webhook receiver
app.post("/webhook/linear", async (c) => {
  const rawBody = await c.req.text();

  // 1. Verify signature
  const signature = c.req.header("Linear-Signature") ?? "";
  const isValid = await verifyLinearSignature(
    rawBody,
    signature,
    c.env.LINEAR_WEBHOOK_SECRET
  );
  if (!isValid) {
    return c.json({ error: "invalid signature" }, 401);
  }

  // 2. Parse and validate timestamp
  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return c.json({ error: "invalid payload" }, 400);
  }

  if (!isTimestampValid(payload.webhookTimestamp)) {
    return c.json({ error: "timestamp drift" }, 401);
  }

  // 3. Filter
  const config = await loadFilterConfig(c.env.CONFIG);
  if (!shouldForwardEvent(payload, config)) {
    return c.json({ status: "filtered" }, 200);
  }

  // 4. Format
  const message = formatLinearEvent(payload);
  if (!message) {
    return c.json({ status: "unformatted" }, 200);
  }

  // 5. Resolve topic
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  const topicRouter = new TopicRouter(
    c.env.CONFIG,
    telegram,
    c.env.TELEGRAM_CHAT_ID
  );

  const data = payload.data as Record<string, unknown>;
  const project = data.project as { id: string; name: string } | undefined;
  const topicId = await topicRouter.resolveOrCreateTopicId(
    message.projectId ?? project?.id,
    project?.name
  );

  // 6. Send
  const result = await telegram.sendMessage({
    chatId: c.env.TELEGRAM_CHAT_ID,
    text: message.text,
    topicId,
    replyMarkup: {
      inline_keyboard: [[{ text: "View in Linear", url: message.url }]],
    },
  });

  if (!result.ok) {
    console.error("Telegram send failed:", result.description);
  }

  return c.json({ status: "sent" }, 200);
});

// Admin: get config
app.get("/config", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const config = await loadFilterConfig(c.env.CONFIG);
  return c.json(config);
});

// Admin: update config
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
  const merged = { ...current, ...body };
  await saveFilterConfig(c.env.CONFIG, merged);

  return c.json({ status: "updated", config: merged });
});

// Admin: get topic mappings
app.get("/topics", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const topicRouter = new TopicRouter(
    c.env.CONFIG,
    new TelegramClient(c.env.TELEGRAM_BOT_TOKEN),
    c.env.TELEGRAM_CHAT_ID
  );
  const config = await topicRouter.getTopicConfig();
  return c.json(config);
});

export default app;
