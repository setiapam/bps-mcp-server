import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSmartTools } from "../../src/tools/smart.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { DomainResolver } from "../../src/services/domain-resolver.js";
import type { IPersistentStore } from "../../src/services/persistent-store.js";
import type { Config } from "../../src/config/index.js";

function createMockClient(): BpsClient {
  return {
    listSubjects: vi.fn().mockResolvedValue({
      data: [
        { sub_id: 23, title: "Kemiskinan" },
      ],
    }),
    listVariables: vi.fn().mockImplementation(async (domain: string, subId?: number) => {
      if (subId === 23) {
        return {
          data: [
            { var_id: 184, title: "Persentase Penduduk Miskin (P0) Menurut Provinsi", sub_name: "Kemiskinan", unit: "Persen" },
            { var_id: 183, title: "Jumlah Penduduk Miskin Menurut Provinsi", sub_name: "Kemiskinan", unit: "Ribu Jiwa" },
            { var_id: 195, title: "Garis Kemiskinan Menurut Provinsi (Rupiah/Kapita/Bulan)", sub_name: "Kemiskinan", unit: "Rupiah" },
          ],
          page: { pages: 1 },
        };
      }
      return { data: [], page: { pages: 1 } };
    }),
    getDynamicData: vi.fn().mockResolvedValue({
      datacontent: {
        "195_9999_2023": 550000,
        "184_9999_2023": 9.36,
      },
      vervar: [
        { kode_vervar: "9999", label_vervar: "INDONESIA" }
      ],
      tahun: [
        { th_id: "2023", th_name: "2023" }
      ]
    }),
    listPeriods: vi.fn().mockResolvedValue([
      { th_id: "2023", th_name: "2023" }
    ]),
    listStaticTables: vi.fn().mockResolvedValue({ data: [] }),
    getStaticTable: vi.fn(),
    listStrategicIndicators: vi.fn().mockResolvedValue({ data: [] }),
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

describe("find_data Garis Kemiskinan resolution", () => {
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

  it("should resolve to Garis Kemiskinan (ID: 195) when searching for 'garis kemiskinan'", async () => {
    const tool = (server as any)._registeredTools?.find_data;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      query: "garis kemiskinan rupiah per kapita per bulan",
      region: "Indonesia",
    });

    const text = result.content[0].text;
    expect(text).toContain("Garis Kemiskinan");
    expect(text).toContain("ID: 195");
    expect(text).not.toContain("Persentase Penduduk Miskin");
  });
});
