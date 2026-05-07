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

// Request logger — runs on every request
app.use("*", async (c, next) => {
  console.log(`[linear-pulse] ${c.req.method} ${c.req.path} from ${c.req.header("user-agent") ?? "unknown"}`);
  await next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "linear-pulse" }));

// Linear webhook handler (shared logic)
async function handleLinearWebhook(c: {
  req: { text: () => Promise<string>; header: (name: string) => string | undefined };
  env: Bindings;
  json: (data: unknown, status?: number) => Response;
}): Promise<Response> {
  const rawBody = await c.req.text();
  console.log(`[webhook] Body length: ${rawBody.length}, Linear-Event: ${c.req.header("Linear-Event") ?? "none"}`);

  // 1. Verify signature
  const signature = c.req.header("Linear-Signature") ?? "";
  if (!signature) {
    console.log("[webhook] No Linear-Signature header — not a Linear webhook");
    return c.json({ error: "missing signature" }, 401);
  }

  const isValid = await verifyLinearSignature(
    rawBody,
    signature,
    c.env.LINEAR_WEBHOOK_SECRET
  );
  if (!isValid) {
    console.log("[webhook] HMAC signature verification FAILED");
    return c.json({ error: "invalid signature" }, 401);
  }
  console.log("[webhook] Signature verified OK");

  // 2. Parse and validate timestamp
  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    console.log("[webhook] Failed to parse JSON body");
    return c.json({ error: "invalid payload" }, 400);
  }

  console.log(`[webhook] Event: ${payload.type}.${payload.action} by ${payload.actor?.name ?? "unknown"}`);

  if (!isTimestampValid(payload.webhookTimestamp)) {
    console.log(`[webhook] Timestamp drift too large: ${Date.now() - payload.webhookTimestamp}ms`);
    return c.json({ error: "timestamp drift" }, 401);
  }

  // 3. Filter
  const config = await loadFilterConfig(c.env.CONFIG);
  if (!shouldForwardEvent(payload, config)) {
    console.log("[webhook] Event filtered out by config");
    return c.json({ status: "filtered" }, 200);
  }

  // 4. Format
  const message = formatLinearEvent(payload);
  if (!message) {
    console.log("[webhook] No formatter for this event type");
    return c.json({ status: "unformatted" }, 200);
  }
  console.log(`[webhook] Formatted message, sending to Telegram chat ${c.env.TELEGRAM_CHAT_ID}`);

  // 5. Resolve topic
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  const topicRouter = new TopicRouter(
    c.env.CONFIG,
    telegram,
    c.env.TELEGRAM_CHAT_ID
  );

  const data = payload.data as Record<string, unknown>;
  const project = data.project as { id: string; name: string } | undefined;
  let topicId: number | undefined;
  try {
    topicId = await topicRouter.resolveOrCreateTopicId(
      message.projectId ?? project?.id,
      project?.name
    );
    console.log(`[webhook] Topic resolved: ${topicId ?? "none (main chat)"}`);
  } catch (e) {
    console.log(`[webhook] Topic resolution failed: ${(e as Error).message}, sending to main chat`);
  }

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
    console.error(`[webhook] Telegram send FAILED: ${result.description}`);
    // If topic-related error, retry without topic
    if (topicId && result.description?.includes("thread")) {
      console.log("[webhook] Retrying without topic ID");
      const retry = await telegram.sendMessage({
        chatId: c.env.TELEGRAM_CHAT_ID,
        text: message.text,
        replyMarkup: {
          inline_keyboard: [[{ text: "View in Linear", url: message.url }]],
        },
      });
      if (!retry.ok) {
        console.error(`[webhook] Telegram retry also FAILED: ${retry.description}`);
      } else {
        console.log("[webhook] Telegram retry succeeded (without topic)");
      }
    }
  } else {
    console.log("[webhook] Telegram send OK");
  }

  return c.json({ status: "sent" }, 200);
}

// Accept webhooks at both paths (Linear might hit root or /webhook/linear)
app.post("/webhook/linear", (c) => handleLinearWebhook(c));
app.post("/", (c) => {
  // Only handle as webhook if it has Linear headers
  if (c.req.header("Linear-Signature") || c.req.header("Linear-Event")) {
    return handleLinearWebhook(c);
  }
  return c.json({ error: "not found" }, 404);
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
