import { Hono } from "hono";
import { verifyLinearSignature, isTimestampValid } from "./webhook/verify";
import { handleTelegramUpdate, registerProject } from "./webhook/telegram";
import { shouldForwardEvent } from "./filters/engine";
import type { ScopeContext } from "./filters/engine";
import { formatLinearEvent } from "./telegram/formatter";
import { TelegramClient } from "./telegram/client";
import { sendOrBatch } from "./telegram/batcher";
import { cacheIssueProject, lookupIssueProject } from "./config/project-cache";
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

  // 3. Quick check: does this event type produce a notification at all?
  const testMessage = formatLinearEvent(payload);
  if (!testMessage) {
    console.log("[webhook] No notification for this event");
    return c.json({ status: "skipped" }, 200);
  }

  // 4. Auto-register project + cache issue→project mapping
  const data = payload.data as Record<string, unknown>;
  const project = data.project as { id: string; name: string } | undefined;
  if (project?.id && project?.name) {
    await registerProject(c.env.CONFIG, project.id, project.name);
  }

  // Cache issue→project for comment routing
  if (payload.type === "Issue" && project?.id) {
    const issueId = data.id as string;
    if (issueId) {
      await cacheIssueProject(c.env.CONFIG, issueId, project.id);
    }
  }

  // 5. Resolve project for events that don't carry it (comments)
  let scopeContext: ScopeContext = {};
  if (!project?.id && payload.type === "Comment") {
    const issue = data.issue as { id?: string } | undefined;
    if (issue?.id) {
      const cachedProjectId = await lookupIssueProject(c.env.CONFIG, issue.id);
      if (cachedProjectId) {
        scopeContext = { resolvedProjectId: cachedProjectId };
        console.log(`[webhook] Resolved project from cache: ${cachedProjectId}`);
      } else {
        console.log(`[webhook] No cached project for issue ${issue.id}`);
      }
    }
  }

  // 6. Load channels and route
  const channels = await loadChannels(c.env.CONFIG);
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  const actorName = payload.actor?.name?.split(" ")[0] ?? "unknown";
  const batchAction = `${payload.type}.${payload.action}`;
  const eventTitle = (data.title as string) || (data.name as string) || "";
  const replyMarkup = {
    inline_keyboard: [[{ text: "View in Linear", url: testMessage.url }]],
  };

  if (channels.length === 0) {
    const config = await loadFilterConfig(c.env.CONFIG);
    if (!shouldForwardEvent(payload, config, scopeContext)) {
      console.log("[webhook] Filtered by global config");
      return c.json({ status: "filtered" }, 200);
    }
    await sendOrBatch(c.env.CONFIG, telegram, {
      chatId: c.env.TELEGRAM_CHAT_ID,
      text: testMessage.text,
      url: testMessage.url,
      actor: actorName,
      action: batchAction,
      title: eventTitle,
      replyMarkup,
    });
    return c.json({ status: "sent" }, 200);
  }

  // Route to each channel that passes its filters, formatting per-channel
  let sentCount = 0;
  for (const channel of channels) {
    if (!shouldForwardEvent(payload, channel.filters, scopeContext)) {
      console.log(`[webhook] Filtered for ${channel.name}`);
      continue;
    }
    const msg = formatLinearEvent(payload, channel.display);
    if (!msg) continue;
    await sendOrBatch(c.env.CONFIG, telegram, {
      chatId: channel.chatId,
      text: msg.text,
      url: msg.url,
      actor: actorName,
      action: batchAction,
      title: eventTitle,
      replyMarkup: {
        inline_keyboard: [[{ text: "View in Linear", url: msg.url }]],
      },
    });
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
