export class PulseAPI {
  constructor(
    private workerUrl: string,
    private adminToken: string
  ) {}

  async getConfig(): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/config`, {
      headers: { Authorization: `Bearer ${this.adminToken}` },
    });
    return res.json();
  }

  async updateConfig(config: unknown): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/config`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    });
    return res.json();
  }

  async getHealth(): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/health`);
    return res.json();
  }

  async getTopics(): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/topics`, {
      headers: { Authorization: `Bearer ${this.adminToken}` },
    });
    return res.json();
  }
}

export class TelegramAPI {
  private baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getMe(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/getMe`);
    return res.json();
  }

  async setDescription(description: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/setMyDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    return res.json();
  }

  async setShortDescription(shortDescription: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/setMyShortDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: shortDescription }),
    });
    return res.json();
  }

  async setCommands(
    commands: Array<{ command: string; description: string }>
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    return res.json();
  }
}
