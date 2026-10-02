import { TelegramClient } from "../telegram/client";
import { escapeHtml } from "../telegram/html";
import {
  loadChannels,
  saveChannels,
  getChannelByChat,
} from "../config/loader";
import { defaultFilterConfig, DEFAULT_DISPLAY_CONFIG } from "../types/config";
import type { Channel, DisplayConfig } from "../types/config";
import type { LinearResourceType } from "../types/linear";

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type?: string; title?: string; first_name?: string };
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

const ADMIN_COMMANDS = ["/mute", "/unmute", "/reset", "/track", "/untrack", "/trackall", "/show", "/hide"];

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

// Get or create the channel for a chat, keeping its name in step with the
// chat's title. Callers save the channel list.
function ensureChannel(channels: Channel[], chatId: string, chatTitle?: string): Channel {
  let channel = getChannelByChat(channels, chatId);
  if (!channel) {
    channel = { chatId, name: chatTitle ?? `Chat ${chatId}`, filters: defaultFilterConfig() };
    channels.push(channel);
  } else if (chatTitle && channel.name !== chatTitle) {
    channel.name = chatTitle;
  }
  return channel;
}

// Blue only answers in chats it already posts to (registered channels and the
// default chat). Anywhere else it stays silent, except for /whoami and for a
// bot admin running an admin command, which registers the chat.
export async function handleTelegramUpdate(
  update: TelegramUpdate,
  telegram: TelegramClient,
  kv: KVNamespace,
  defaultChatId: string
): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  if (!msg.text.startsWith("/")) return;

  const parts = msg.text.split(/\s+/);
  const command = parts[0]!.split("@")[0]!.toLowerCase();
  const args = parts.slice(1);
  const chatId = String(msg.chat.id);
  const chatTitle = msg.chat.title ?? msg.chat.first_name;
  const topicId = msg.message_thread_id;
  const userId = msg.from?.id;

  const reply = async (text: string) => {
    const result = await telegram.sendMessage({ chatId, text, topicId });
    if (!result.ok) {
      console.error(`[telegram] Reply to ${chatId} failed: ${result.description}`);
    }
  };

  if (command === "/whoami") {
    await reply(
      `<b>Your Telegram user ID:</b> <code>${userId ?? "unknown"}</code>\n` +
      `<b>This chat ID:</b> <code>${chatId}</code>`
    );
    return;
  }

  const channels = await loadChannels(kv);
  const isKnownChat = chatId === defaultChatId || getChannelByChat(channels, chatId) !== undefined;
  const isAdminCommand = ADMIN_COMMANDS.includes(command);

  let isAdmin = false;
  let adminCount = 0;
  if (isAdminCommand) {
    const admins = await getAdminList(kv);
    adminCount = admins.length;
    isAdmin = userId !== undefined && admins.includes(userId);
  }

  if (!isKnownChat && !(isAdminCommand && isAdmin)) {
    console.log(`[telegram] Ignored ${command} in unregistered chat ${chatId}`);
    return;
  }

  if (isAdminCommand && !isAdmin) {
    await reply(
      adminCount === 0
        ? "No admins are set up yet, so config can't be changed. Add your user ID (see /whoami) to the admin_users list."
        : "Only admins can change config."
    );
    return;
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
        "Fields: project, identifier, actor, transition, assignments, unassignments\n\n" +
        "/whoami — your user ID and this chat's ID"
      );
      break;

    case "/status": {
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
        projectStatus = config.scope.projects
          .map((id) => escapeHtml(directory.find((p) => p.id === id)?.name ?? id))
          .join(", ");
      }

      await reply(
        `<b>Blue — ${escapeHtml(channel.name)}</b>\n\n` +
        `<b>Muted:</b> ${muted.length ? muted.join(", ") : "none"}\n` +
        `<b>Projects:</b> ${projectStatus}`
      );
      break;
    }

    case "/projects": {
      const channel = getChannelByChat(channels, chatId);
      const directory = await getProjectDirectory(kv);

      if (directory.length === 0) {
        await reply("No projects registered yet. Projects are auto-discovered from events.");
        break;
      }

      const scopedProjects = channel?.filters.scope.projects ?? [];
      const lines = directory.map((p) => {
        const tracked = scopedProjects.length === 0 || scopedProjects.includes(p.id);
        return `${tracked ? "\u2705" : "\u274c"} ${escapeHtml(p.name)}`;
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
        const available = directory.map((p) => escapeHtml(p.name)).join(", ");
        await reply(
          `Project "${escapeHtml(name)}" not found.\n` +
          (available ? `Available: ${available}` : "No projects registered yet.")
        );
        break;
      }
      const channel = ensureChannel(channels, chatId, chatTitle);
      if (!channel.filters.scope.projects.includes(match.id)) {
        channel.filters.scope.projects.push(match.id);
      }
      await saveChannels(kv, channels);
      await reply(`Now tracking <b>${escapeHtml(match.name)}</b>. Only tracked projects will notify in this chat.`);
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
        await reply(`Project "${escapeHtml(name)}" not found.`);
        break;
      }
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
        await reply(`Untracked <b>${escapeHtml(match.name)}</b>. No project filter — showing all.`);
      } else {
        await reply(`Untracked <b>${escapeHtml(match.name)}</b>.`);
      }
      break;
    }

    case "/trackall": {
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
        await reply(`Unknown type: ${escapeHtml(type)}\nSee /types for options.`);
        break;
      }
      const channel = ensureChannel(channels, chatId, chatTitle);
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
        await reply(`Unknown type: ${escapeHtml(type)}\nSee /types for options.`);
        break;
      }
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
      const channel = getChannelByChat(channels, chatId);
      if (channel) {
        channel.filters = defaultFilterConfig();
        await saveChannels(kv, channels);
      }
      await reply("Filters reset for this chat. All events, all projects.");
      break;
    }

    case "/display": {
      const channel = getChannelByChat(channels, chatId);
      const d = { ...DEFAULT_DISPLAY_CONFIG, ...channel?.display };
      const fields = [
        ["project", d.showProject],
        ["identifier", d.showIdentifier],
        ["actor", d.showActor],
        ["transition", d.showTransition],
        ["assignments", d.showAssignments],
        ["unassignments", d.showUnassignments],
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
        assignments: "showAssignments",
        assignment: "showAssignments",
        unassignments: "showUnassignments",
        unassignment: "showUnassignments",
      };
      if (!field || !fieldMap[field]) {
        await reply("Usage: /show &lt;field&gt; or /hide &lt;field&gt;\nFields: project, identifier, actor, transition, assignments, unassignments");
        break;
      }
      const key = fieldMap[field]!;
      const value = command === "/show";
      const channel = ensureChannel(channels, chatId, chatTitle);
      channel.display = { ...DEFAULT_DISPLAY_CONFIG, ...channel.display };
      channel.display[key] = value;
      await saveChannels(kv, channels);
      await reply(`${value ? "Showing" : "Hiding"} <b>${field}</b> in messages.`);
      break;
    }

    default:
      break;
  }
}

// Auto-register projects from webhook events, and pick up renames
export async function registerProject(
  kv: KVNamespace,
  projectId: string,
  projectName: string
): Promise<void> {
  const directory = await getProjectDirectory(kv);
  const existing = directory.find((p) => p.id === projectId);
  if (existing) {
    if (existing.name === projectName) return;
    existing.name = projectName;
  } else {
    directory.push({ id: projectId, name: projectName });
  }
  await saveProjectDirectory(kv, directory);
}
