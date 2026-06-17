import type { ICacheProvider } from "./cache.js";
import { logger } from "../utils/logger.js";

/**
 * KV-based cache implementation for Cloudflare Workers.
 * Implements ICacheProvider using Cloudflare KV Namespace.
 */
export class KVCache implements ICacheProvider {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.kv.get(key);
    } catch (error) {
      logger.warn(`KV cache get failed: ${error}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.kv.put(key, value, { expirationTtl: ttlSeconds });
    } catch (error) {
      logger.warn(`KV cache set failed (could be due to limit exceeded): ${error}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (error) {
      logger.warn(`KV cache delete failed: ${error}`);
    }
  }

  async clear(): Promise<void> {
    // KV doesn't support bulk delete — this is a no-op for Workers.
    // Individual keys expire via TTL set during put().
  }
}
