import { TelegramClient, TelegramInlineKeyboard } from "./client";

const BATCH_PREFIX = "batch:";
const BATCH_WINDOW_SECONDS = 30; // KV minimum TTL is 60s, so window must be >= 30
const BATCH_TTL_SECONDS = 60; // KV minimum

interface BatchEntry {
  messageId: number;
  chatId: string;
  count: number;
  firstTitle: string;
  action: string;
  actor: string;
  url: string;
}

function batchKey(chatId: string, actor: string, action: string): string {
  // Time window: floor to nearest BATCH_WINDOW_SECONDS
  const window = Math.floor(Date.now() / (BATCH_WINDOW_SECONDS * 1000));
  return `${BATCH_PREFIX}${chatId}:${actor}:${action}:${window}`;
}

/**
 * Send or batch a message. If a similar message was sent to this chat
 * in the same time window, edit the original to show a count instead.
 *
 * Returns true if the message was sent/batched successfully.
 */
export async function sendOrBatch(
  kv: KVNamespace,
  telegram: TelegramClient,
  opts: {
    chatId: string;
    text: string;
    url: string;
    actor: string;
    action: string; // e.g. "Issue.create", "status_change"
    title: string;
    replyMarkup?: TelegramInlineKeyboard;
  }
): Promise<boolean> {
  const key = batchKey(opts.chatId, opts.actor, opts.action);

  // Check for existing batch
  const raw = await kv.get(key);
  if (raw) {
    try {
      const batch = JSON.parse(raw) as BatchEntry;
      batch.count++;

      // Edit the original message to show batch summary
      const summary = `${opts.text.split("\n")[0]}\n<b>${batch.count} items</b> (${batch.actor})`;
      await telegram.editMessage(
        batch.chatId,
        batch.messageId,
        summary,
        opts.replyMarkup
      );

      // Update the count in KV
      await kv.put(key, JSON.stringify(batch), {
        expirationTtl: BATCH_TTL_SECONDS,
      });
      return true;
    } catch {
      // If edit fails, fall through to send normally
    }
  }

  // No batch — send normally
  const result = await telegram.sendMessage({
    chatId: opts.chatId,
    text: opts.text,
    replyMarkup: opts.replyMarkup,
  });

  if (!result.ok) {
    console.error(`[batch] Send failed to ${opts.chatId}: ${result.description}`);
    return false;
  }

  // Store for potential batching
  const msgResult = result.result as { message_id: number } | undefined;
  if (msgResult?.message_id) {
    const entry: BatchEntry = {
      messageId: msgResult.message_id,
      chatId: opts.chatId,
      count: 1,
      firstTitle: opts.title,
      action: opts.action,
      actor: opts.actor,
      url: opts.url,
    };
    await kv.put(key, JSON.stringify(entry), {
      expirationTtl: BATCH_TTL_SECONDS,
    });
  }

  return true;
}
