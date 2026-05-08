import { TelegramClient } from "../telegram/client";
import {
  loadChannels,
  saveChannels,
  getChannelByChat,
} from "../config/loader";
import { DEFAULT_FILTER_CONFIG, DEFAULT_DISPLAY_CONFIG } from "../types/config";
import type { FilterConfig, Channel, DisplayConfig } from "../types/config";
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

const PROJECT_DIRECTORY_KEY = "project_directory";
const ADMIN_LIST_KEY = "admin_users";

interface ProjectEntry {
  id: string;
  name: string;
}

async function getAdminList(kv: KVNamespace): Promise<number[]> {
  const raw = await kv.get(ADMIN_LIST_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

async function getProjectDirectory(kv: KVNamespace): Promise<ProjectEntry[]> {
  const raw = await kv.get(PROJECT_DIRECTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ProjectEntry[];
  } catch {
    return [];
  }
}

async function saveProjectDirectory(kv: KVNamespace, projects: ProjectEntry[]): Promise<void> {
  await kv.put(PROJECT_DIRECTORY_KEY, JSON.stringify(projects));
}

// Get or create channel config for a chat
async function ensureChannel(
  kv: KVNamespace,
  chatId: string,
  chatName: string
): Promise<{ channel: Channel; channels: Channel[] }> {
  const channels = await loadChannels(kv);
  let channel = getChannelByChat(channels, chatId);
  if (!channel) {
    channel = {
      chatId,
      name: chatName,
      filters: { ...DEFAULT_FILTER_CONFIG },
    };
    channels.push(channel);
    await saveChannels(kv, channels);
  }
  return { channel, channels };
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  telegram: TelegramClient,
  kv: KVNamespace
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  if (!msg.text.startsWith("/")) return;

  const parts = msg.text.split(/\s+/);
  const command = parts[0]!.split("@")[0]!.toLowerCase();
  const args = parts.slice(1);
  const chatId = String(msg.chat.id);
  const topicId = msg.message_thread_id;
  const userId = msg.from?.id;

  const reply = async (text: string) => {
    await telegram.sendMessage({ chatId, text, topicId });
  };

  // Admin-only commands
  const adminCommands = ["/mute", "/unmute", "/reset", "/track", "/untrack", "/trackall", "/show", "/hide"];
  if (adminCommands.includes(command)) {
    const admins = await getAdminList(kv);
    if (admins.length > 0 && userId && !admins.includes(userId)) {
      await reply("Only admins can change config.");
      return;
    }
  }

  switch (command) {
    case "/help":
      await reply(
        "<b>Blue — Commands</b>\n\n" +
        "<b>Filtering</b>\n" +
        "/status — current config for this chat\n" +
        "/mute &lt;type&gt; — mute a resource type\n" +
        "/unmute &lt;type&gt; — unmute a resource type\n" +
        "/types — list resource types\n" +
        "/reset — reset filters for this chat\n\n" +
        "<b>Projects</b>\n" +
        "/projects — list tracked projects\n" +
        "/track &lt;name&gt; — only notify for this project\n" +
        "/untrack &lt;name&gt; — stop filtering to this project\n" +
        "/trackall — notify for all projects\n\n" +
        "<b>Display</b>\n" +
        "/display — current display settings\n" +
        "/show &lt;field&gt; — show a field in messages\n" +
        "/hide &lt;field&gt; — hide a field from messages\n" +
        "Fields: project, identifier, actor, transition"
      );
      break;

    case "/status": {
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      const directory = await getProjectDirectory(kv);

      if (!channel) {
        await reply("This chat has no channel config yet. Use /track or /mute to set one up.");
        break;
      }

      const config = channel.filters;
      const muted = Object.entries(config.events)
        .filter(([, actions]) => actions.length === 0)
        .map(([type]) => type);

      let projectStatus: string;
      if (config.scope.projects.length === 0) {
        projectStatus = "all projects";
      } else {
        const names = config.scope.projects
          .map((id) => directory.find((p) => p.id === id)?.name ?? id)
          .join(", ");
        projectStatus = names;
      }

      await reply(
        `<b>Blue — ${channel.name}</b>\n\n` +
        `<b>Muted:</b> ${muted.length ? muted.join(", ") : "none"}\n` +
        `<b>Projects:</b> ${projectStatus}`
      );
      break;
    }

    case "/projects": {
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      const directory = await getProjectDirectory(kv);

      if (directory.length === 0) {
        await reply("No projects registered yet. Projects are auto-discovered from events.");
        break;
      }

      const scopedProjects = channel?.filters.scope.projects ?? [];
      const lines = directory.map((p) => {
        const tracked = scopedProjects.length === 0 || scopedProjects.includes(p.id);
        return `${tracked ? "\u2705" : "\u274c"} ${p.name}`;
      });

      const mode = scopedProjects.length === 0
        ? "(showing all)"
        : `(filtering to ${scopedProjects.length})`;

      await reply(`<b>Projects</b> ${mode}\n\n${lines.join("\n")}`);
      break;
    }

    case "/track": {
      const name = args.join(" ");
      if (!name) {
        await reply("Usage: /track &lt;project name&gt;\nSee /projects for options.");
        break;
      }
      const directory = await getProjectDirectory(kv);
      const match = directory.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (!match) {
        const available = directory.map((p) => p.name).join(", ");
        await reply(
          `Project "${name}" not found.\n` +
          (available ? `Available: ${available}` : "No projects registered yet.")
        );
        break;
      }
      const { channel, channels } = await ensureChannel(kv, chatId, `Chat ${chatId}`);
      if (!channel.filters.scope.projects.includes(match.id)) {
        channel.filters.scope.projects.push(match.id);
      }
      await saveChannels(kv, channels);
      await reply(`Now tracking <b>${match.name}</b>. Only tracked projects will notify in this chat.`);
      break;
    }

    case "/untrack": {
      const name = args.join(" ");
      if (!name) {
        await reply("Usage: /untrack &lt;project name&gt;");
        break;
      }
      const directory = await getProjectDirectory(kv);
      const match = directory.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (!match) {
        await reply(`Project "${name}" not found.`);
        break;
      }
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      if (!channel) {
        await reply("No config for this chat yet.");
        break;
      }
      channel.filters.scope.projects = channel.filters.scope.projects.filter(
        (id) => id !== match.id
      );
      await saveChannels(kv, channels);

      if (channel.filters.scope.projects.length === 0) {
        await reply(`Untracked <b>${match.name}</b>. No project filter — showing all.`);
      } else {
        await reply(`Untracked <b>${match.name}</b>.`);
      }
      break;
    }

    case "/trackall": {
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      if (channel) {
        channel.filters.scope.projects = [];
        await saveChannels(kv, channels);
      }
      await reply("Tracking all projects in this chat.");
      break;
    }

    case "/mute": {
      const type = args[0];
      if (!type) {
        await reply("Usage: /mute &lt;type&gt;\nSee /types for options.");
        break;
      }
      const matched = RESOURCE_TYPES.find(
        (t) => t.toLowerCase() === type.toLowerCase()
      );
      if (!matched) {
        await reply(`Unknown type: ${type}\nSee /types for options.`);
        break;
      }
      const { channel, channels } = await ensureChannel(kv, chatId, `Chat ${chatId}`);
      channel.filters.events[matched] = [];
      await saveChannels(kv, channels);
      await reply(`Muted <b>${matched}</b> in this chat.`);
      break;
    }

    case "/unmute": {
      const type = args[0];
      if (!type) {
        await reply("Usage: /unmute &lt;type&gt;\nSee /types for options.");
        break;
      }
      const matched = RESOURCE_TYPES.find(
        (t) => t.toLowerCase() === type.toLowerCase()
      );
      if (!matched) {
        await reply(`Unknown type: ${type}\nSee /types for options.`);
        break;
      }
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      if (channel) {
        delete channel.filters.events[matched];
        await saveChannels(kv, channels);
      }
      await reply(`Unmuted <b>${matched}</b> in this chat.`);
      break;
    }

    case "/types":
      await reply(
        "<b>Resource Types</b>\n\n" +
        RESOURCE_TYPES.map((t) => `\u2022 ${t}`).join("\n")
      );
      break;

    case "/reset": {
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      if (channel) {
        channel.filters = { ...DEFAULT_FILTER_CONFIG, scope: { projects: [], teams: [], labels: [] } };
        await saveChannels(kv, channels);
      }
      await reply("Filters reset for this chat. All events, all projects.");
      break;
    }

    case "/display": {
      const channels = await loadChannels(kv);
      const channel = getChannelByChat(channels, chatId);
      const d = channel?.display ?? DEFAULT_DISPLAY_CONFIG;
      const fields = [
        ["project", d.showProject],
        ["identifier", d.showIdentifier],
        ["actor", d.showActor],
        ["transition", d.showTransition],
      ] as const;
      const lines = fields.map(
        ([name, on]) => `${on ? "\u2705" : "\u274c"} ${name}`
      );
      await reply(`<b>Display Settings</b>\n\n${lines.join("\n")}`);
      break;
    }

    case "/show":
    case "/hide": {
      const field = args[0]?.toLowerCase();
      const fieldMap: Record<string, keyof DisplayConfig> = {
        project: "showProject",
        identifier: "showIdentifier",
        id: "showIdentifier",
        actor: "showActor",
        transition: "showTransition",
      };
      if (!field || !fieldMap[field]) {
        await reply("Usage: /show &lt;field&gt; or /hide &lt;field&gt;\nFields: project, identifier, actor, transition");
        break;
      }
      const key = fieldMap[field]!;
      const value = command === "/show";
      const { channel, channels } = await ensureChannel(kv, chatId, `Chat ${chatId}`);
      if (!channel.display) {
        channel.display = { ...DEFAULT_DISPLAY_CONFIG };
      }
      channel.display[key] = value;
      await saveChannels(kv, channels);
      await reply(`${value ? "Showing" : "Hiding"} <b>${field}</b> in messages.`);
      break;
    }

    default:
      break;
  }
}

// Auto-register projects from webhook events
export async function registerProject(
  kv: KVNamespace,
  projectId: string,
  projectName: string
): Promise<void> {
  const directory = await getProjectDirectory(kv);
  if (directory.some((p) => p.id === projectId)) return;
  directory.push({ id: projectId, name: projectName });
  await saveProjectDirectory(kv, directory);
}
