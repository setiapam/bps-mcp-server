import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryCache } from "../../../src/services/cache.js";

describe("InMemoryCache", () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache(5);
  });

  describe("get/set", () => {
    it("should return null for non-existent key", async () => {
      expect(await cache.get("missing")).toBeNull();
    });

    it("should store and retrieve a value", async () => {
      await cache.set("key1", "value1", 60);
      expect(await cache.get("key1")).toBe("value1");
    });

    it("should overwrite existing key", async () => {
      await cache.set("key1", "value1", 60);
      await cache.set("key1", "value2", 60);
      expect(await cache.get("key1")).toBe("value2");
      expect(cache.size).toBe(1);
    });

    it("should handle JSON string values", async () => {
      const data = JSON.stringify({ foo: "bar", nums: [1, 2, 3] });
      await cache.set("json", data, 60);
      expect(JSON.parse((await cache.get("json"))!)).toEqual({ foo: "bar", nums: [1, 2, 3] });
    });
  });

  describe("TTL expiration", () => {
    it("should return null for expired entries", async () => {
      vi.useFakeTimers();
      await cache.set("key1", "value1", 10);

      vi.advanceTimersByTime(11_000);
      expect(await cache.get("key1")).toBeNull();

      vi.useRealTimers();
    });

    it("should return value before TTL expires", async () => {
      vi.useFakeTimers();
      await cache.set("key1", "value1", 10);

      vi.advanceTimersByTime(9_000);
      expect(await cache.get("key1")).toBe("value1");

      vi.useRealTimers();
    });

    it("should remove expired entry from cache on get", async () => {
      vi.useFakeTimers();
      await cache.set("key1", "value1", 1);
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(2_000);
      await cache.get("key1");
      expect(cache.size).toBe(0);

      vi.useRealTimers();
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entry when at capacity", async () => {
      for (let i = 1; i <= 5; i++) {
        await cache.set(`key${i}`, `value${i}`, 300);
      }
      expect(cache.size).toBe(5);

      await cache.set("key6", "value6", 300);
      expect(cache.size).toBe(5);
      expect(await cache.get("key1")).toBeNull();
      expect(await cache.get("key6")).toBe("value6");
    });

    it("should move accessed key to end (MRU position)", async () => {
      for (let i = 1; i <= 5; i++) {
        await cache.set(`key${i}`, `value${i}`, 300);
      }

      await cache.get("key1");

      await cache.set("key6", "value6", 300);
      await cache.set("key7", "value7", 300);

      expect(await cache.get("key1")).toBe("value1");
      expect(await cache.get("key2")).toBeNull();
      expect(await cache.get("key3")).toBeNull();
    });

    it("should not evict when updating existing key", async () => {
      for (let i = 1; i <= 5; i++) {
        await cache.set(`key${i}`, `value${i}`, 300);
      }

      await cache.set("key3", "updated", 300);
      expect(cache.size).toBe(5);
      expect(await cache.get("key1")).toBe("value1");
      expect(await cache.get("key3")).toBe("updated");
    });
  });

  describe("delete", () => {
    it("should delete an existing key", async () => {
      await cache.set("key1", "value1", 60);
      await cache.delete("key1");
      expect(await cache.get("key1")).toBeNull();
      expect(cache.size).toBe(0);
    });

    it("should be a no-op for non-existent key", async () => {
      await cache.delete("nonexistent");
      expect(cache.size).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      await cache.set("a", "1", 60);
      await cache.set("b", "2", 60);
      await cache.set("c", "3", 60);
      expect(cache.size).toBe(3);

      await cache.clear();
      expect(cache.size).toBe(0);
      expect(await cache.get("a")).toBeNull();
    });
  });

  describe("size", () => {
    it("should return 0 for empty cache", () => {
      expect(cache.size).toBe(0);
    });

    it("should track size correctly", async () => {
      await cache.set("a", "1", 60);
      expect(cache.size).toBe(1);
      await cache.set("b", "2", 60);
      expect(cache.size).toBe(2);
      await cache.delete("a");
      expect(cache.size).toBe(1);
    });
  });

  describe("default constructor", () => {
    it("should default to 500 max entries", async () => {
      const defaultCache = new InMemoryCache();
      for (let i = 0; i < 501; i++) {
        await defaultCache.set(`key${i}`, `val${i}`, 300);
      }
      expect(defaultCache.size).toBe(500);
      expect(await defaultCache.get("key0")).toBeNull();
      expect(await defaultCache.get("key500")).toBe("val500");
    });
  });
});
