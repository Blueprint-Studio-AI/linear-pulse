import { Hono } from "hono";
import type { Context } from "hono";
import { verifyLinearSignature, isTimestampValid, secretMatches } from "./webhook/verify";
import { handleTelegramUpdate, registerProject } from "./webhook/telegram";
import { shouldForwardEvent } from "./filters/engine";
import type { ScopeContext } from "./filters/engine";
import { formatLinearEvent } from "./telegram/formatter";
import type { FormatContext } from "./telegram/formatter";
import { TelegramClient } from "./telegram/client";
import { cacheIssueProject, lookupIssueProject } from "./config/project-cache";
import { cacheStateName, lookupStateName } from "./config/state-cache";
import {
  loadChannels,
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
  TELEGRAM_WEBHOOK_SECRET: string;
};

type AppContext = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

// Request logger
app.use("*", async (c, next) => {
  console.log(`[linear-pulse] ${c.req.method} ${c.req.path} from ${c.req.header("user-agent") ?? "unknown"}`);
  await next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "linear-pulse" }));

function isAdminRequest(c: AppContext): boolean {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  return secretMatches(token, c.env.ADMIN_TOKEN);
}

// Send a formatted message to a specific chat. Never throws, so one failing
// chat can't stop delivery to the others.
async function sendToChat(
  telegram: TelegramClient,
  chatId: string,
  text: string,
  url: string
): Promise<boolean> {
  try {
    const result = await telegram.sendMessage({
      chatId,
      text,
      replyMarkup: {
        inline_keyboard: [[{ text: "View in Linear", url }]],
      },
    });
    if (!result.ok) {
      console.error(`[send] Failed to ${chatId}: ${result.description}`);
      return false;
    }
    console.log(`[send] OK to ${chatId}`);
    return true;
  } catch (e) {
    console.error(`[send] Failed to ${chatId}: ${(e as Error).message}`);
    return false;
  }
}

// Linear webhook handler
async function handleLinearWebhook(c: AppContext): Promise<Response> {
  const handlerStart = Date.now();
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

  if (!isTimestampValid(payload.webhookTimestamp)) {
    return c.json({ error: "timestamp drift" }, 401);
  }

  const linearDelay = handlerStart - payload.webhookTimestamp;
  const changed = payload.updatedFrom ? ` | changed: ${Object.keys(payload.updatedFrom).join(", ")}` : "";
  console.log(`[webhook] ${payload.type}.${payload.action} by ${payload.actor?.name ?? "unknown"} | Linear→Worker: ${linearDelay}ms${changed}`);

  // 3. Keep the project directory and issue→project cache current. This runs
  // for every event, including ones that don't notify, so comments on quiet
  // issues can still be routed to the right project.
  const data = payload.data as Record<string, unknown>;
  const project = data.project as { id: string; name: string } | undefined;
  if (project?.id && project?.name) {
    await registerProject(c.env.CONFIG, project.id, project.name);
  }

  const formatContext: FormatContext = {};
  if (payload.type === "Issue") {
    const issueId = data.id as string | undefined;
    const projectId = project?.id ?? (data.projectId as string | undefined);
    if (issueId && projectId) {
      await cacheIssueProject(c.env.CONFIG, issueId, projectId);
    }

    // Status changes only carry the old stateId, so remember state names
    // as they go by and look the old one up.
    const state = data.state as { id?: string; name?: string } | undefined;
    if (state?.id && state.name) {
      await cacheStateName(c.env.CONFIG, state.id, state.name);
    }
    const oldStateId = payload.updatedFrom?.stateId as string | undefined;
    if (oldStateId) {
      formatContext.previousStateName =
        (await lookupStateName(c.env.CONFIG, oldStateId)) ?? undefined;
    }
  }

  // 4. Quick check: does this event type produce a notification at all?
  const testMessage = formatLinearEvent(payload, undefined, formatContext);
  if (!testMessage) {
    return c.json({ status: "skipped" }, 200);
  }

  // 5. Resolve project for events that don't carry it (comments)
  let scopeContext: ScopeContext = {};
  if (!project?.id && payload.type === "Comment") {
    const issueId =
      (data.issue as { id?: string } | undefined)?.id ??
      (data.issueId as string | undefined);
    if (issueId) {
      const cachedProjectId = await lookupIssueProject(c.env.CONFIG, issueId);
      if (cachedProjectId) {
        scopeContext = { resolvedProjectId: cachedProjectId };
      } else {
        console.log(`[webhook] No cached project for issue ${issueId}`);
      }
    }
  }

  // 6. Work out which chats get it, formatting per-channel
  const channels = await loadChannels(c.env.CONFIG);
  const deliveries: Array<{ chatId: string; text: string; url: string }> = [];

  if (channels.length === 0) {
    const config = await loadFilterConfig(c.env.CONFIG);
    if (!shouldForwardEvent(payload, config, scopeContext)) {
      return c.json({ status: "filtered" }, 200);
    }
    deliveries.push({ chatId: c.env.TELEGRAM_CHAT_ID, text: testMessage.text, url: testMessage.url });
  } else {
    for (const channel of channels) {
      if (!shouldForwardEvent(payload, channel.filters, scopeContext)) continue;
      const msg = formatLinearEvent(payload, channel.display, formatContext);
      if (msg) deliveries.push({ chatId: channel.chatId, text: msg.text, url: msg.url });
    }
  }

  // 7. Send in parallel after responding: Linear treats anything slower than
  // 5s as a failure and retries, which would post duplicates.
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  c.executionCtx.waitUntil(
    Promise.all(deliveries.map((d) => sendToChat(telegram, d.chatId, d.text, d.url))).then(
      (results) => {
        const sent = results.filter(Boolean).length;
        console.log(`[webhook] Sent ${sent}/${deliveries.length} | Worker total: ${Date.now() - handlerStart}ms`);
      }
    )
  );

  return c.json({ status: deliveries.length ? "sent" : "filtered", channels: deliveries.length }, 200);
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
  if (!secretMatches(secret, c.env.TELEGRAM_WEBHOOK_SECRET)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const update = await c.req.json();
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  await handleTelegramUpdate(update, telegram, c.env.CONFIG, c.env.TELEGRAM_CHAT_ID);
  return c.json({ ok: true });
});

// Admin: get channels
app.get("/channels", async (c) => {
  if (!isAdminRequest(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const channels = await loadChannels(c.env.CONFIG);
  return c.json(channels);
});

// Admin: get global config (fallback when no channels)
app.get("/config", async (c) => {
  if (!isAdminRequest(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const config = await loadFilterConfig(c.env.CONFIG);
  return c.json(config);
});

// Admin: update global config
app.put("/config", async (c) => {
  if (!isAdminRequest(c)) {
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
