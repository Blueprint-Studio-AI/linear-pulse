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

const PROJECT_DIRECTORY_KEY = "project_directory";

interface ProjectEntry {
  id: string;
  name: string;
}

async function getProjectDirectory(kv: KVNamespace): Promise<ProjectEntry[]> {
  const raw = await kv.get(PROJECT_DIRECTORY_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as ProjectEntry[];
}

async function saveProjectDirectory(kv: KVNamespace, projects: ProjectEntry[]): Promise<void> {
  await kv.put(PROJECT_DIRECTORY_KEY, JSON.stringify(projects));
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

  const reply = async (text: string) => {
    await telegram.sendMessage({ chatId, text, topicId });
  };

  switch (command) {
    case "/help":
      await reply(
        "<b>Blue — Commands</b>\n\n" +
        "<b>Filtering</b>\n" +
        "/status — current config\n" +
        "/mute &lt;type&gt; — mute a resource type\n" +
        "/unmute &lt;type&gt; — unmute a resource type\n" +
        "/types — list resource types\n" +
        "/reset — reset all filters\n\n" +
        "<b>Projects</b>\n" +
        "/projects — list tracked projects\n" +
        "/track &lt;name&gt; — only notify for this project\n" +
        "/untrack &lt;name&gt; — stop filtering to this project\n" +
        "/trackall — notify for all projects"
      );
      break;

    case "/status": {
      const config = await loadFilterConfig(kv);
      const muted = Object.entries(config.events)
        .filter(([, actions]) => actions.length === 0)
        .map(([type]) => type);
      const directory = await getProjectDirectory(kv);

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
        "<b>Blue — Config</b>\n\n" +
        `<b>Muted:</b> ${muted.length ? muted.join(", ") : "none"}\n` +
        `<b>Projects:</b> ${projectStatus}`
      );
      break;
    }

    case "/projects": {
      const config = await loadFilterConfig(kv);
      const directory = await getProjectDirectory(kv);

      if (directory.length === 0) {
        await reply(
          "No projects registered yet.\n" +
          "Projects are auto-discovered when events come in, or use /track &lt;name&gt; to add one."
        );
        break;
      }

      const lines = directory.map((p) => {
        const tracked = config.scope.projects.length === 0 ||
          config.scope.projects.includes(p.id);
        return `${tracked ? "\u2705" : "\u274c"} ${p.name}`;
      });

      const mode = config.scope.projects.length === 0
        ? "(showing all)"
        : `(filtering to ${config.scope.projects.length})`;

      await reply(
        `<b>Projects</b> ${mode}\n\n${lines.join("\n")}`
      );
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
          (available ? `Available: ${available}` : "No projects registered yet — events auto-discover projects.")
        );
        break;
      }
      const config = await loadFilterConfig(kv);
      if (!config.scope.projects.includes(match.id)) {
        config.scope.projects.push(match.id);
      }
      await saveFilterConfig(kv, config);
      await reply(`Now tracking <b>${match.name}</b>. Only tracked projects will notify.`);
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
      const config = await loadFilterConfig(kv);
      config.scope.projects = config.scope.projects.filter((id) => id !== match.id);
      await saveFilterConfig(kv, config);

      if (config.scope.projects.length === 0) {
        await reply(`Untracked <b>${match.name}</b>. No project filter active — showing all.`);
      } else {
        await reply(`Untracked <b>${match.name}</b>.`);
      }
      break;
    }

    case "/trackall": {
      const config = await loadFilterConfig(kv);
      config.scope.projects = [];
      await saveFilterConfig(kv, config);
      await reply("Tracking all projects. No project filter active.");
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
      const config = await loadFilterConfig(kv);
      config.events[matched] = [];
      await saveFilterConfig(kv, config);
      await reply(`Muted <b>${matched}</b>.`);
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
      const config = await loadFilterConfig(kv);
      delete config.events[matched];
      await saveFilterConfig(kv, config);
      await reply(`Unmuted <b>${matched}</b>.`);
      break;
    }

    case "/types":
      await reply(
        "<b>Resource Types</b>\n\n" +
        RESOURCE_TYPES.map((t) => `\u2022 ${t}`).join("\n")
      );
      break;

    case "/reset": {
      await saveFilterConfig(kv, DEFAULT_FILTER_CONFIG);
      await reply("Filters reset to defaults. All events, all projects.");
      break;
    }

    default:
      break;
  }
}

// Auto-register projects from incoming webhook events
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
