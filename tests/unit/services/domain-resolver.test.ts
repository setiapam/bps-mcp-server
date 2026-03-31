import { describe, it, expect, beforeEach, vi } from "vitest";
import { DomainResolver } from "../../../src/services/domain-resolver.js";
import type { BpsClient } from "../../../src/client/bps-client.js";
import type { BpsDomain } from "../../../src/client/types.js";
import domainsFixture from "../../fixtures/domains.json";

function createMockClient(): BpsClient {
  return {
    listDomains: vi.fn().mockResolvedValue({ data: domainsFixture as BpsDomain[] }),
  } as unknown as BpsClient;
}

describe("DomainResolver", () => {
  let resolver: DomainResolver;
  let mockClient: BpsClient;

  beforeEach(() => {
    mockClient = createMockClient();
    resolver = new DomainResolver(mockClient);
  });

  describe("resolve by code", () => {
    it("should resolve exact domain code", async () => {
      const result = await resolver.resolve("3100");
      expect(result).toEqual({ domainId: "3100", domainName: "DKI Jakarta" });
    });

    it("should resolve national code 0000", async () => {
      const result = await resolver.resolve("0000");
      expect(result).toEqual({ domainId: "0000", domainName: "Indonesia" });
    });
  });

  describe("resolve by alias", () => {
    it("should resolve common alias 'jatim'", async () => {
      const result = await resolver.resolve("jatim");
      expect(result).toEqual({ domainId: "3500", domainName: "Jawa Timur" });
    });

    it("should resolve alias 'jabar'", async () => {
      const result = await resolver.resolve("jabar");
      expect(result).toEqual({ domainId: "3200", domainName: "Jawa Barat" });
    });

    it("should resolve alias 'dki'", async () => {
      const result = await resolver.resolve("dki");
      expect(result).toEqual({ domainId: "3100", domainName: "DKI Jakarta" });
    });

    it("should resolve alias 'nasional'", async () => {
      const result = await resolver.resolve("nasional");
      expect(result).toEqual({ domainId: "0000", domainName: "Indonesia" });
    });

    it("should be case-insensitive", async () => {
      const result = await resolver.resolve("JATIM");
      expect(result).toEqual({ domainId: "3500", domainName: "Jawa Timur" });
    });
  });

  describe("resolve by exact name", () => {
    it("should resolve full province name", async () => {
      const result = await resolver.resolve("Jawa Timur");
      expect(result).toEqual({ domainId: "3500", domainName: "Jawa Timur" });
    });

    it("should resolve case-insensitively", async () => {
      const result = await resolver.resolve("jawa timur");
      expect(result).toEqual({ domainId: "3500", domainName: "Jawa Timur" });
    });
  });

  describe("resolve by partial match", () => {
    it("should match partial name 'yogya'", async () => {
      const result = await resolver.resolve("yogya");
      expect(result).not.toBeNull();
      expect(result!.domainId).toBe("3400");
    });

    it("should match partial name 'bali'", async () => {
      const result = await resolver.resolve("bali");
      expect(result).not.toBeNull();
      expect(result!.domainId).toBe("5100");
    });
  });

  describe("resolve unknown", () => {
    it("should return null for completely unknown query", async () => {
      const result = await resolver.resolve("xyznonexistent");
      expect(result).toBeNull();
    });
  });

  describe("ensureLoaded", () => {
    it("should load domains on first resolve", async () => {
      await resolver.resolve("0000");
      expect(mockClient.listDomains).toHaveBeenCalledTimes(1);
    });

    it("should not reload domains on subsequent resolves", async () => {
      await resolver.resolve("0000");
      await resolver.resolve("3100");
      await resolver.resolve("3200");
      expect(mockClient.listDomains).toHaveBeenCalledTimes(1);
    });
  });

  describe("getDomains", () => {
    it("should return loaded domains after resolve", async () => {
      await resolver.resolve("0000");
      const domains = resolver.getDomains();
      expect(domains).toHaveLength(10);
      expect(domains[0].domain_id).toBe("0000");
    });

    it("should return empty array before loading", () => {
      const domains = resolver.getDomains();
      expect(domains).toHaveLength(0);
    });
  });

  describe("trim and whitespace handling", () => {
    it("should trim whitespace from query", async () => {
      const result = await resolver.resolve("  jatim  ");
      expect(result).toEqual({ domainId: "3500", domainName: "Jawa Timur" });
    });
  });
});
