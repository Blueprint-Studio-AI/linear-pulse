import { TelegramClient } from "../telegram/client";
import {
  loadFilterConfig,
  saveFilterConfig,
} from "../config/loader";
import { DEFAULT_FILTER_CONFIG } from "../types/config";
import type { FilterConfig } from "../types/config";
import type { LinearResourceType } from "../types/linear";

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; first_name: string };
    message_thread_id?: number;
  };
}

const RESOURCE_TYPES: LinearResourceType[] = [
  "Issue", "Comment", "Project", "ProjectUpdate", "Cycle",
  "Document", "Initiative", "InitiativeUpdate", "IssueLabel",
  "Reaction", "IssueSLA", "Customer", "CustomerRequest", "User",
];

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  telegram: TelegramClient,
  kv: KVNamespace
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  // Only handle bot commands (start with /)
  if (!msg.text.startsWith("/")) return;

  const parts = msg.text.split(/\s+/);
  const command = parts[0]!.split("@")[0]!.toLowerCase(); // strip @botname
  const args = parts.slice(1);
  const chatId = String(msg.chat.id);
  const topicId = msg.message_thread_id;

  const reply = async (text: string) => {
    await telegram.sendMessage({ chatId, text, topicId });
  };

  switch (command) {
    case "/help":
      await reply(
        "<b>Blue — Config Commands</b>\n\n" +
        "/status — current filter config\n" +
        "/mute &lt;type&gt; — stop forwarding a resource type\n" +
        "/unmute &lt;type&gt; — re-enable a resource type\n" +
        "/types — list all resource types\n" +
        "/reset — reset filters to defaults"
      );
      break;

    case "/status": {
      const config = await loadFilterConfig(kv);
      const muted = Object.entries(config.events)
        .filter(([, actions]) => actions.length === 0)
        .map(([type]) => type);
      const teams = config.scope.teams.length || "all";
      const projects = config.scope.projects.length || "all";
      const ignored = config.updates.ignoreFields.join(", ");

      await reply(
        "<b>Blue — Current Config</b>\n\n" +
        `<b>Muted types:</b> ${muted.length ? muted.join(", ") : "none"}\n` +
        `<b>Team scope:</b> ${teams} team(s)\n` +
        `<b>Project scope:</b> ${projects} project(s)\n` +
        `<b>Ignored fields:</b> ${ignored}`
      );
      break;
    }

    case "/mute": {
      const type = args[0];
      if (!type) {
        await reply("Usage: /mute &lt;ResourceType&gt;\nSee /types for options.");
        break;
      }
      const matched = RESOURCE_TYPES.find(
        (t) => t.toLowerCase() === type.toLowerCase()
      );
      if (!matched) {
        await reply(`Unknown type: ${type}\nSee /types for options.`);
        break;
      }
      const config = await loadFilterConfig(kv);
      config.events[matched] = [];
      await saveFilterConfig(kv, config);
      await reply(`Muted <b>${matched}</b> events.`);
      break;
    }

    case "/unmute": {
      const type = args[0];
      if (!type) {
        await reply("Usage: /unmute &lt;ResourceType&gt;\nSee /types for options.");
        break;
      }
      const matched = RESOURCE_TYPES.find(
        (t) => t.toLowerCase() === type.toLowerCase()
      );
      if (!matched) {
        await reply(`Unknown type: ${type}\nSee /types for options.`);
        break;
      }
      const config = await loadFilterConfig(kv);
      delete config.events[matched];
      await saveFilterConfig(kv, config);
      await reply(`Unmuted <b>${matched}</b> — all actions enabled.`);
      break;
    }

    case "/types":
      await reply(
        "<b>Resource Types</b>\n\n" +
        RESOURCE_TYPES.map((t) => `• ${t}`).join("\n")
      );
      break;

    case "/reset": {
      await saveFilterConfig(kv, DEFAULT_FILTER_CONFIG);
      await reply("Filters reset to defaults. All events enabled.");
      break;
    }

    default:
      // Ignore unknown commands silently
      break;
  }
}
