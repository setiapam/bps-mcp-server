import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalysisTools } from "../../src/tools/analysis.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { DomainResolver } from "../../src/services/domain-resolver.js";
import type { IPersistentStore } from "../../src/services/persistent-store.js";
import type { Config } from "../../src/config/index.js";

function createMockClient(): BpsClient {
  const variables: Record<string, { var_id: number; title: string; sub_name: string; unit?: string }> = {
    "3500": {
      var_id: 100,
      title: "Persentase Penduduk Miskin Provinsi Jawa Timur",
      sub_name: "Kemiskinan",
      unit: "Persen",
    },
    "3200": {
      var_id: 936,
      title: "Persentase Penduduk Miskin Provinsi Jawa Barat",
      sub_name: "Kemiskinan",
      unit: "Persen",
    },
  };

  return {
    listSubjects: vi.fn().mockResolvedValue({ data: [{ sub_id: 23, title: "Kemiskinan dan Ketimpangan" }] }),
    listVariables: vi.fn().mockImplementation(async (domain: string) => {
      const variable = variables[domain];
      return { data: variable ? [variable] : [], page: { pages: 1 } };
    }),
    listPeriods: vi.fn().mockResolvedValue([{ th_id: 123, th_name: "2023" }]),
    getDynamicData: vi.fn().mockImplementation(async (domain: string, varId: string) => {
      const varNumber = Number(varId);
      const base = domain === "3500" ? 3500 : 3200;
      return {
        status: "OK",
        "data-availability": "available",
        data: null,
        var: [{ var_id: varNumber, title: variables[domain]?.title, sub_id: 23, sub_name: "Kemiskinan" }],
        vervar: [{ kode_vervar: base, label_vervar: domain === "3500" ? "Provinsi Jawa Timur" : "Provinsi Jawa Barat" }],
        turvar: [
          { kode_turvar: 1, label_turvar: "Perkotaan" },
          { kode_turvar: 2, label_turvar: "Perdesaan" },
          { kode_turvar: 3, label_turvar: "Perkotaan + Perdesaan" },
        ],
        tahun: [{ th_id: 123, th_name: "2023" }],
        turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
        datacontent: {
          [`${base}${varNumber}112363`]: 8.0,
          [`${base}${varNumber}212363`]: 12.0,
          [`${base}${varNumber}312363`]: domain === "3500" ? 10.35 : 7.62,
        },
      };
    }),
    listStrategicIndicators: vi.fn().mockResolvedValue({ data: [] }),
    listStaticTables: vi.fn().mockResolvedValue({ data: [] }),
    getStaticTable: vi.fn(),
  } as unknown as BpsClient;
}

function createMockResolver(): DomainResolver {
  return {
    resolve: vi.fn().mockImplementation(async (name: string) => {
      if (name.toLowerCase().includes("timur")) return { domainId: "3500", domainName: "Jawa Timur" };
      return { domainId: "3200", domainName: "Jawa Barat" };
    }),
  } as unknown as DomainResolver;
}

function createMockStore(): IPersistentStore {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
    getAll: async () => Object.fromEntries(data),
    merge: async (entries) => { for (const [key, value] of Object.entries(entries)) data.set(key, value); },
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
    logLevel: "error",
  } as Config;
}

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
};

describe("compare_data aggregate handling", () => {
  let tool: RegisteredTool;

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "1.0" });
    registerAnalysisTools(
      server,
      createMockClient(),
      createMockResolver(),
      createMockConfig(),
      createMockStore()
    );
    tool = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools.compare_data;
  });

  it("uses the combined turvar value and does not parse localized strings", async () => {
    const result = await tool.handler({
      query: "kemiskinan",
      regions: "Jawa Timur, Jawa Barat",
      year: "2023",
    });
    const text = result.content[0].text;
    expect(text).toContain("Jawa Timur | 10,35 Persen");
    expect(text).toContain("Jawa Barat | 7,62 Persen");
    expect(text).toContain("**Tertinggi:** Jawa Timur");
    expect(text).not.toContain("0,27");
  });
});
