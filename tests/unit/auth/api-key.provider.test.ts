import { describe, it, expect } from "vitest";
import { ApiKeyProvider } from "../../../src/auth/api-key.provider.js";

describe("ApiKeyProvider", () => {
  describe("constructor", () => {
    it("should create instance with valid API key", () => {
      const provider = new ApiKeyProvider("test-api-key-123");
      expect(provider.getType()).toBe("api-key");
    });

    it("should throw when API key is empty string", () => {
      expect(() => new ApiKeyProvider("")).toThrow("BPS_API_KEY is required");
    });
  });

  describe("authenticate", () => {
    it("should return authenticated result", async () => {
      const provider = new ApiKeyProvider("test-key");
      const result = await provider.authenticate();
      expect(result).toEqual({ authenticated: true, type: "api-key" });
    });
  });

  describe("getHeaders", () => {
    it("should return empty headers", async () => {
      const provider = new ApiKeyProvider("test-key");
      const headers = await provider.getHeaders();
      expect(headers).toEqual({});
    });
  });

  describe("getQueryParams", () => {
    it("should return key in query params", async () => {
      const provider = new ApiKeyProvider("my-secret-key");
      const params = await provider.getQueryParams();
      expect(params).toEqual({ key: "my-secret-key" });
    });

    it("should return the exact key provided to constructor", async () => {
      const provider = new ApiKeyProvider("abc-123-xyz");
      const params = await provider.getQueryParams();
      expect(params.key).toBe("abc-123-xyz");
    });
  });

  describe("isExpired", () => {
    it("should always return false", () => {
      const provider = new ApiKeyProvider("test-key");
      expect(provider.isExpired()).toBe(false);
    });
  });

  describe("refresh", () => {
    it("should resolve without error", async () => {
      const provider = new ApiKeyProvider("test-key");
      await expect(provider.refresh()).resolves.toBeUndefined();
    });
  });

  describe("getType", () => {
    it("should return 'api-key'", () => {
      const provider = new ApiKeyProvider("test-key");
      expect(provider.getType()).toBe("api-key");
    });
  });
});
