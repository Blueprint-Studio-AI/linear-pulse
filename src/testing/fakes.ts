// In-memory stand-ins for Workers KV and the Telegram client, for tests.

export function fakeKV(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
  );
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
  const read = <T>(key: string): T | undefined => {
    const raw = store.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  };
  return { kv, store, read };
}

export function fakeTelegram() {
  const sent: Array<{ chatId: string; text: string; topicId?: number }> = [];
  const client = {
    sendMessage: async (options: { chatId: string; text: string; topicId?: number }) => {
      sent.push(options);
      return { ok: true };
    },
  };
  return { client: client as never, sent };
}
