import type { ICacheProvider } from "./cache.js";

/**
 * KV-based cache implementation for Cloudflare Workers.
 * Implements ICacheProvider using Cloudflare KV Namespace.
 */
export class KVCache implements ICacheProvider {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.kv.put(key, value, { expirationTtl: ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async clear(): Promise<void> {
    // KV doesn't support bulk delete — this is a no-op for Workers.
    // Individual keys expire via TTL set during put().
  }
}
