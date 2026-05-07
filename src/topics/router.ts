import type { TopicConfig } from "../types/config";
import { TelegramClient } from "../telegram/client";

const TOPIC_CONFIG_KEY = "topic_mappings";

export class TopicRouter {
  constructor(
    private kv: KVNamespace,
    private telegram: TelegramClient,
    private chatId: string
  ) {}

  async resolveTopicId(projectId?: string): Promise<number | undefined> {
    const config = await this.getTopicConfig();
    const key = projectId ?? "_general";

    const existing = config.topics[key];
    if (existing) return existing.topicId;

    return undefined;
  }

  async createTopicForProject(
    projectId: string,
    projectName: string
  ): Promise<number | null> {
    const result = await this.telegram.createForumTopic(
      this.chatId,
      projectName
    );
    if (!result) return null;

    const config = await this.getTopicConfig();
    config.topics[projectId] = {
      topicId: result.topicId,
      name: projectName,
    };
    await this.saveTopicConfig(config);

    return result.topicId;
  }

  async resolveOrCreateTopicId(
    projectId?: string,
    projectName?: string
  ): Promise<number | undefined> {
    const existing = await this.resolveTopicId(projectId);
    if (existing) return existing;

    if (projectId && projectName) {
      const topicId = await this.createTopicForProject(projectId, projectName);
      return topicId ?? undefined;
    }

    return undefined;
  }

  async getTopicConfig(): Promise<TopicConfig> {
    const raw = await this.kv.get(TOPIC_CONFIG_KEY);
    if (!raw) return { topics: {} };
    return JSON.parse(raw) as TopicConfig;
  }

  private async saveTopicConfig(config: TopicConfig): Promise<void> {
    await this.kv.put(TOPIC_CONFIG_KEY, JSON.stringify(config));
  }
}
