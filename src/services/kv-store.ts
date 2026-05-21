import type { IPersistentStore } from "./persistent-store.js";

const PREFIX = "learn:";

/**
 * KV-based persistent store for Cloudflare Workers.
 * Uses a prefix to separate learning data from API cache.
 */
export class KVStore implements IPersistentStore {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(PREFIX + key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.kv.put(PREFIX + key, value);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(PREFIX + key);
  }

  async getAll(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    let cursor: string | undefined;
    do {
      const list = await this.kv.list({ prefix: PREFIX, cursor });
      for (const key of list.keys) {
        const val = await this.kv.get(key.name);
        if (val) result[key.name.slice(PREFIX.length)] = val;
      }
      cursor = list.list_complete ? undefined : (list.cursor as string);
    } while (cursor);
    return result;
  }

  async merge(entries: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      const existing = await this.kv.get(PREFIX + key);
      if (!existing) {
        await this.kv.put(PREFIX + key, value);
      }
    }
  }
}
