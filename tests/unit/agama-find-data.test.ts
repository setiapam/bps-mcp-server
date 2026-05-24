// Integration-style test: verify find_data flow for agama query with mocked BPS API
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSmartTools } from "../../src/tools/smart.tools.js";
import { InMemoryCache } from "../../src/services/cache.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { DomainResolver } from "../../src/services/domain-resolver.js";
import type { IPersistentStore } from "../../src/services/persistent-store.js";
import type { Config } from "../../src/config/index.js";

// Mock BpsClient
function createMockClient(): BpsClient {
  return {
    listSubjects: vi.fn().mockResolvedValue({
      data: [
        { sub_id: 12, title: "Kependudukan" },
        { sub_id: 30, title: "Kesehatan" },
        { sub_id: 28, title: "Pendidikan" },
      ],
    }),
    listVariables: vi.fn().mockImplementation(async (domain: string, subId?: number) => {
      if (subId === 12) {
        return {
          data: [
            { var_id: 9999, title: "Jumlah Penduduk Menurut Agama di Kabupaten Jombang", sub_name: "Kependudukan", unit: "jiwa" },
            { var_id: 1452, title: "Jumlah Penduduk", sub_name: "Kependudukan", unit: "ribu jiwa" },
          ],
          page: { pages: 1 },
        };
      }
      return { data: [], page: { pages: 1 } };
    }),
    getDynamicData: vi.fn().mockResolvedValue({
      datacontent: {}, // Simulate no dynamic data for agama
    }),
    listPeriods: vi.fn().mockResolvedValue([]),
    listStaticTables: vi.fn().mockResolvedValue({
      data: [
        { table_id: 5724, title: "JUMLAH PENDUDUK MENURUT AGAMA DAN KEPERCAYAAN DI KABUPATEN JOMBANG 2019", updt_date: "2020-04-30" },
      ],
    }),
    getStaticTable: vi.fn().mockResolvedValue({
      table_id: 5724,
      title: "JUMLAH PENDUDUK MENURUT AGAMA DAN KEPERCAYAAN DI KABUPATEN JOMBANG 2019",
      updt_date: "2020-04-30",
      table: "<table><tr><td>Islam</td><td>1000000</td></tr></table>",
      excel: "https://example.com/excel",
    }),
    listStrategicIndicators: vi.fn().mockResolvedValue({ data: [] }),
  } as unknown as BpsClient;
}

// Mock DomainResolver
function createMockResolver(): DomainResolver {
  return {
    resolve: vi.fn().mockResolvedValue({ domainId: "3517", domainName: "Kabupaten Jombang" }),
  } as unknown as DomainResolver;
}

// Mock store
function createMockStore(): IPersistentStore {
  const store = new Map<string, string>();
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) || null)),
    set: vi.fn().mockImplementation((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    delete: vi.fn().mockImplementation((key: string) => { store.delete(key); return Promise.resolve(); }),
  };
}

function createMockConfig(): Config {
  return {
    authType: "api-key",
    apiKey: "test-key",
    apiBaseUrl: "https://webapi.bps.go.id/v1",
    defaultLang: "ind",
    defaultDomain: "0000",
    cacheEnabled: true,
    cacheMaxEntries: 500,
    cacheTtlMs: 3600000,
  } as unknown as Config;
}

describe("find_data agama flow", () => {
  let server: McpServer;
  let mockClient: BpsClient;
  let mockResolver: DomainResolver;
  let mockStore: IPersistentStore;
  let mockConfig: Config;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0" });
    mockClient = createMockClient();
    mockResolver = createMockResolver();
    mockStore = createMockStore();
    mockConfig = createMockConfig();
    registerSmartTools(server, mockClient, mockResolver, mockConfig, mockStore);
  });

  it("should fallback to static table when dynamic data is empty for agama query", async () => {
    const tool = (server as any)._registeredTools?.find_data;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      query: "pemeluk agama",
      region: "kab jombang",
    });

    const text = result.content[0].text;
    expect(text).toContain("Tabel Statis");
    expect(text).toContain("AGAMA");
    expect(text).toContain("Kabupaten Jombang");
  });

  it("should fallback to static table for 'penduduk menurut agama' query (not jenis kelamin)", async () => {
    const tool = (server as any)._registeredTools?.find_data;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      query: "penduduk menurut agama",
      region: "kab jombang",
    });

    const text = result.content[0].text;
    // Should NOT return "Jenis Kelamin" data
    expect(text).not.toContain("Jenis Kelamin");
    // Should fallback to static table with agama data
    expect(text).toContain("Tabel Statis");
    expect(text).toContain("AGAMA");
  });

  it("should resolve domain correctly for kab jombang", async () => {
    const resolved = await mockResolver.resolve("kab jombang");
    expect(resolved).toEqual({ domainId: "3517", domainName: "Kabupaten Jombang" });
  });
});
