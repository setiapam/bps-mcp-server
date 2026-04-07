import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { BpsClient } from "../../../src/client/bps-client.js";
import { InMemoryCache } from "../../../src/services/cache.js";
import { BpsApiError } from "../../../src/utils/error.js";
import type { IAuthProvider } from "../../../src/auth/types.js";
import type { Config } from "../../../src/config/index.js";

function createMockAuth(): IAuthProvider {
  return {
    authenticate: vi.fn().mockResolvedValue({ authenticated: true, type: "api-key" }),
    getHeaders: vi.fn().mockResolvedValue({}),
    getQueryParams: vi.fn().mockResolvedValue({ key: "test-key" }),
    isExpired: vi.fn().mockReturnValue(false),
    refresh: vi.fn().mockResolvedValue(undefined),
    getType: vi.fn().mockReturnValue("api-key"),
  } as unknown as IAuthProvider;
}

function createConfig(overrides?: Partial<Config>): Config {
  return {
    authType: "api-key",
    apiKey: "test-key",
    apiBaseUrl: "https://webapi.bps.go.id/v1",
    defaultLang: "ind",
    defaultDomain: "0000",
    cacheEnabled: true,
    cacheMaxEntries: 500,
    logLevel: "error",
    ...overrides,
  } as Config;
}

describe("BpsClient", () => {
  let auth: IAuthProvider;
  let cache: InMemoryCache;

  beforeEach(() => {
    auth = createMockAuth();
    cache = new InMemoryCache(100);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request deduplication", () => {
    it("should deduplicate concurrent identical requests", async () => {
      const responseData = { status: "OK", data: [{ page: 1 }, []] };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, cache, createConfig());

      // Make 3 concurrent requests for the same data
      const [r1, r2, r3] = await Promise.all([
        client.listSubjects("0000"),
        client.listSubjects("0000"),
        client.listSubjects("0000"),
      ]);

      // All should return the same result
      expect(r1).toEqual(r2);
      expect(r2).toEqual(r3);

      // But fetch should only be called once (deduplication)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should not deduplicate requests with different parameters", async () => {
      const responseData = { status: "OK", data: [{ page: 1 }, []] };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, cache, createConfig());

      await Promise.all([
        client.listSubjects("0000"),
        client.listSubjects("3100"),
      ]);

      // Different params → different requests
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("request timeout", () => {
    it("should throw BpsApiError when fetch is aborted", async () => {
      // Simulate an immediate AbortError (as would happen on timeout)
      const fetchMock = vi.fn().mockImplementation(() => {
        const err = new DOMException("The operation was aborted.", "AbortError");
        return Promise.reject(err);
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, null, createConfig());

      await expect(client.listSubjects("0000")).rejects.toThrow(BpsApiError);
      await expect(client.listSubjects("0000")).rejects.toThrow(/timeout/i);
    });

    it("should pass AbortSignal to fetch", async () => {
      const responseData = { status: "OK", data: [{ page: 1 }, []] };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, null, createConfig());
      await client.listSubjects("0000");

      // Verify that an AbortSignal was passed in the fetch options
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetchOptions = fetchMock.mock.calls[0][1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("retry on server errors", () => {
    it("should retry on 500 errors and succeed on subsequent attempt", async () => {
      const responseData = { status: "OK", data: [{ page: 1 }, []] };
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(responseData),
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, null, createConfig());
      const result = await client.listSubjects("0000");

      expect(result).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("should not retry on 4xx errors", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, null, createConfig());

      await expect(client.listSubjects("0000")).rejects.toThrow(BpsApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should throw after max retries exhausted", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, null, createConfig());

      await expect(client.listSubjects("0000")).rejects.toThrow(BpsApiError);
      // 3 total attempts (1 initial + 2 retries)
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("caching", () => {
    it("should cache responses and return cached on second call", async () => {
      const responseData = { status: "OK", data: [{ page: 1 }, [{ sub_id: 1 }]] };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseData),
      });
      vi.stubGlobal("fetch", fetchMock);

      const client = new BpsClient(auth, cache, createConfig());

      // First call - fetches from network
      await client.listSubjects("0000");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await client.listSubjects("0000");
      expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1 - no new fetch
    });
  });
});
