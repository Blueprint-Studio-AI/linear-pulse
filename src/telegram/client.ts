export interface TelegramSendOptions {
  chatId: string;
  text: string;
  topicId?: number;
  replyMarkup?: TelegramInlineKeyboard;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<
    Array<{
      text: string;
      url?: string;
      callback_data?: string;
    }>
  >;
}

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

export class TelegramClient {
  private baseUrl: string;

  constructor(private token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(options: TelegramSendOptions): Promise<TelegramResponse> {
    const body: Record<string, unknown> = {
      chat_id: options.chatId,
      text: options.text,
      parse_mode: "HTML",
    };

    if (options.topicId !== undefined) {
      body.message_thread_id = options.topicId;
    }

    if (options.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }

    const res = await fetch(`${this.baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return res.json() as Promise<TelegramResponse>;
  }

  async createForumTopic(
    chatId: string,
    name: string
  ): Promise<{ topicId: number } | null> {
    const res = await fetch(`${this.baseUrl}/createForumTopic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, name }),
    });

    const data = (await res.json()) as TelegramResponse;
    if (data.ok && data.result) {
      const result = data.result as { message_thread_id: number };
      return { topicId: result.message_thread_id };
    }
    return null;
  }

  async setMyDescription(description: string): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/setMyDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    return res.json() as Promise<TelegramResponse>;
  }

  async setMyShortDescription(
    shortDescription: string
  ): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/setMyShortDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: shortDescription }),
    });
    return res.json() as Promise<TelegramResponse>;
  }

  async setMyCommands(
    commands: Array<{ command: string; description: string }>
  ): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    return res.json() as Promise<TelegramResponse>;
  }

  async getMe(): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/getMe`);
    return res.json() as Promise<TelegramResponse>;
  }
}
