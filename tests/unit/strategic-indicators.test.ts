import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalysisTools } from "../../src/tools/analysis.tools.js";
import { registerSmartTools } from "../../src/tools/smart.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { DomainResolver } from "../../src/services/domain-resolver.js";
import type { IPersistentStore } from "../../src/services/persistent-store.js";
import type { Config } from "../../src/config/index.js";

function createMockClient(): BpsClient {
  return {
    listSubjects: vi.fn().mockResolvedValue({ data: [] }),
    listVariables: vi.fn().mockResolvedValue({ data: [], page: { pages: 1 } }),
    getDynamicData: vi.fn().mockResolvedValue({ datacontent: {} }),
    listPeriods: vi.fn().mockResolvedValue([]),
    listStaticTables: vi.fn().mockResolvedValue({ data: [] }),
    getStaticTable: vi.fn(),
    listStrategicIndicators: vi.fn().mockResolvedValue({
      data: [
        {
          var: 2263,
          indicator_id: 3,
          title: "Inflasi Year on Year, Mei 2026",
          name: "Pada Mei 2026 terjadi inflasi year-on-year (y-on-y) sebesar 3,08 persen",
          value: 3.08,
          unit: "Persen",
          periode: "Mei 2026",
        }
      ]
    }),
  } as unknown as BpsClient;
}

function createMockResolver(): DomainResolver {
  return {
    resolve: vi.fn().mockResolvedValue({ domainId: "0000", domainName: "Indonesia" }),
  } as unknown as DomainResolver;
}

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

describe("strategic indicators fallback", () => {
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
    registerAnalysisTools(server, mockClient, mockResolver, mockConfig, mockStore);
    registerSmartTools(server, mockClient, mockResolver, mockConfig, mockStore);
  });

  it("should successfully fall back and print strategic indicators in find_data", async () => {
    const tool = (server as any)._registeredTools?.find_data;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      query: "inflasi",
      region: "Indonesia",
    });

    const text = result.content[0].text;
    expect(text).toContain("Inflasi Year on Year");
    expect(text).toContain("3,08");
    expect(text).toContain("Mei 2026");
  });

  it("should successfully fall back and print strategic indicators trend in get_trend", async () => {
    const tool = (server as any)._registeredTools?.get_trend;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      query: "inflasi",
      region: "Indonesia",
      start_year: "2025",
      end_year: "2026",
    });

    const text = result.content[0].text;
    expect(text).toContain("Inflasi Year on Year");
    expect(text).toContain("3,08");
    expect(text).toContain("Mei 2026");
  });
});
