import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalysisTools } from "../../src/tools/analysis.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { DomainResolver } from "../../src/services/domain-resolver.js";
import type { Config } from "../../src/config/index.js";

const PERIODS = [
  { th_id: 126, th_name: "2026" },
  { th_id: 125, th_name: "2025" },
  { th_id: 124, th_name: "2024" },
  { th_id: 123, th_name: "2023" },
  { th_id: 122, th_name: "2022" },
  { th_id: 121, th_name: "2021" },
];

const VALUES: Record<string, Record<string, number>> = {
  "3500": { "121": 4572.73, "122": 4181.29, "123": 4188.81, "124": 3982.69, "125": 3875.88, "126": 3712.23 },
  "3200": { "121": 4200, "122": 4070, "123": 3890, "124": 3850, "125": 3650, "126": 3440 },
};

function createClient(): BpsClient {
  const variables: Record<string, { var_id: number; title: string; sub_name: string; unit: string }> = {
    "3500": {
      var_id: 421,
      title: "Jumlah Penduduk Miskin menurut Kabupaten/Kota di Jawa Timur",
      sub_name: "Kemiskinan dan Ketimpangan",
      unit: "Ribu Jiwa",
    },
    "3200": {
      var_id: 939,
      title: "Jumlah Penduduk Miskin Provinsi Jawa Barat",
      sub_name: "Kemiskinan",
      unit: "Ribu Jiwa",
    },
  };

  return {
    listSubjects: vi.fn().mockResolvedValue({ data: [{ sub_id: 23, title: "Kemiskinan dan Ketimpangan" }] }),
    listVariables: vi.fn().mockImplementation(async (domain: string) => {
      const variable = variables[domain];
      return { data: variable ? [variable] : [], page: { pages: 1 } };
    }),
    listPeriods: vi.fn().mockResolvedValue(PERIODS),
    listStrategicIndicators: vi.fn().mockResolvedValue({ data: [] }),
    getDynamicData: vi.fn().mockImplementation(async (domain: string, varId: string, th?: string) => {
      const ids = (th ?? "").split(";").filter(Boolean);
      const datacontent: Record<string, number> = {};
      for (const id of ids) datacontent[`${domain}${varId}${id}63`] = VALUES[domain][id];
      return {
        status: "OK",
        "data-availability": "available",
        data: null,
        var: [{ var_id: Number(varId), title: variables[domain].title }],
        vervar: [{ kode_vervar: Number(domain), label_vervar: domain === "3500" ? "Jawa Timur" : "Jawa Barat" }],
        tahun: ids.map((id) => ({ th_id: Number(id), th_name: String(PERIODS.find((p) => String(p.th_id) === id)?.th_name) })),
        turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
        datacontent,
      };
    }),
  } as unknown as BpsClient;
}

function createResolver(): DomainResolver {
  return {
    resolve: vi.fn().mockImplementation(async (name: string) => {
      if (name.toLowerCase().includes("timur")) return { domainId: "3500", domainName: "Jawa Timur" };
      return { domainId: "3200", domainName: "Jawa Barat" };
    }),
  } as unknown as DomainResolver;
}

function createConfig(): Config {
  return {
    authType: "api-key",
    apiKey: "test-key",
    apiBaseUrl: "https://webapi.bps.go.id/v1",
    defaultLang: "ind",
    defaultDomain: "0000",
    cacheEnabled: false,
    cacheMaxEntries: 10,
    logLevel: "error",
  } as Config;
}

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
};

describe("compare_data multi-year in one call", () => {
  let tool: RegisteredTool;

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "1.0" });
    registerAnalysisTools(server, createClient(), createResolver(), createConfig(), null);
    tool = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools.compare_data;
  });

  it("returns a region x year table with totals and trend", async () => {
    const result = await tool.handler({
      query: "jumlah penduduk miskin",
      regions: "Jawa Timur, Jawa Barat",
      years: "2021-2023",
    });
    const text = result.content[0].text;

    expect(text).toContain("| Tahun | Jawa Timur | Jawa Barat | Selisih |");
    expect(text).toContain("| 2021 | 4.572,73 Ribu Jiwa | 4.200 Ribu Jiwa | 372,73 |");
    expect(text).toContain("| 2023 | 4.188,81 Ribu Jiwa | 3.890 Ribu Jiwa | 298,81 |");
    expect(text).toContain("**Jawa Timur:** turun");
    expect(text).toContain("**Jawa Barat:** turun");
    expect(text).not.toContain("N/A");
  });

  it("accepts start_year/end_year as well", async () => {
    const result = await tool.handler({
      query: "jumlah penduduk miskin",
      regions: "Jawa Timur, Jawa Barat",
      start_year: "2025",
      end_year: "2026",
    });
    const text = result.content[0].text;
    expect(text).toContain("| 2025 |");
    expect(text).toContain("| 2026 |");
    expect(text).toContain("3.712,23");
  });
});
