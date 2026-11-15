import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "../../src/tools/search.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { AllStatsClient } from "../../src/client/allstats-client.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ text: string }>;
    isError?: boolean;
  }>;
};

function pageInfo(total: number) {
  return { page: 1, pages: 1, total, per_page: 10, count: total };
}

function createClient(overrides: Record<string, unknown[]> = {}): BpsClient {
  const models: Record<string, unknown[]> = {
    statictable: [{ table_id: 1494, title: "Tabel Kemiskinan" }],
    publication: [{ pub_id: "abc123", title: "Publikasi Kemiskinan", rl_date: "2024-01-01" }],
    pressrelease: [{ brs_id: 7, title: "BRS Kemiskinan", rl_date: "2024-01-02" }],
    indicators: [{ indicator_id: 1, title: "Indikator Kemiskinan", value: 9.36, periode: "2024" }],
    ...overrides,
  };
  return {
    search: vi.fn().mockImplementation(async (_domain: string, _keyword: string, model?: string) => ({
      data: models[model ?? ""] ?? [],
      page: pageInfo(models[model ?? ""]?.length ?? 0),
    })),
  } as unknown as BpsClient;
}

function createAllStats(handler: (query: string) => unknown[]): AllStatsClient {
  return {
    search: vi.fn().mockImplementation(async (params: { query: string }) => {
      const results = handler(params.query);
      return {
        query: params.query,
        totalResults: results.length,
        currentPage: 1,
        totalPages: 1,
        results,
      };
    }),
    deepSearch: vi.fn(),
  } as unknown as AllStatsClient;
}

function registered(client: BpsClient, allStats?: AllStatsClient): RegisteredTool {
  const server = new McpServer({ name: "test", version: "1.0" });
  registerSearchTools(server, client, allStats);
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools.search;
}

describe("search tool", () => {
  let client: BpsClient;

  beforeEach(() => {
    client = createClient();
  });

  it("fans out over tables, publications and BRS in one call", async () => {
    const tool = registered(client);
    const result = await tool.handler({ keyword: "kemiskinan", domain: "0000" });
    const text = result.content[0].text;

    expect(client.search).toHaveBeenCalledTimes(3);
    expect(client.search).toHaveBeenCalledWith("0000", "kemiskinan", "statictable", 1);
    expect(client.search).toHaveBeenCalledWith("0000", "kemiskinan", "publication", 1);
    expect(client.search).toHaveBeenCalledWith("0000", "kemiskinan", "pressrelease", 1);
    expect(text).toContain("### Tabel Statis");
    expect(text).toContain("### Publikasi");
    expect(text).toContain("### Berita Resmi Statistik (BRS)");
    expect(text).toContain("get_publication");
  });

  it("maps type=strategicindicator to the API model 'indicators'", async () => {
    const tool = registered(client);
    const result = await tool.handler({
      keyword: "kemiskinan",
      domain: "0000",
      type: "strategicindicator",
    });

    expect(client.search).toHaveBeenCalledTimes(1);
    expect(client.search).toHaveBeenCalledWith("0000", "kemiskinan", "indicators", 1);
    expect(result.content[0].text).toContain("Indikator Strategis");
  });

  it("filters strategic indicators that do not match the keyword", async () => {
    const tool = registered(createClient({
      indicators: [
        { indicator_id: 1, title: "Inflasi Year on Year", value: 3.2, periode: "2026" },
        { indicator_id: 2, title: "Persentase Penduduk Miskin", value: 8.07, periode: "2026" },
      ],
    }));
    const result = await tool.handler({
      keyword: "kemiskinan",
      domain: "0000",
      type: "strategicindicator",
    });
    const text = result.content[0].text;

    expect(text).toContain("Persentase Penduduk Miskin");
    expect(text).not.toContain("Inflasi Year on Year");
  });

  it("falls back to AllStats with a root word when WebAPI is empty", async () => {
    const emptyClient = createClient({ statictable: [], publication: [], pressrelease: [] });
    const allStats = createAllStats((query) =>
      query === "miskin"
        ? [{
            url: "https://www.bps.go.id/id/publication/1/abc/analisis-kemiskinan.html",
            title: "Analisis Kemiskinan",
            description: "Publikasi",
            contentType: "",
            domain: "0000",
            deepSearchId: "abcabcabcabcabcabcabcabc",
          }]
        : []
    );
    const tool = registered(emptyClient, allStats);
    const result = await tool.handler({ keyword: "kemiskinan", domain: "0000" });
    const text = result.content[0].text;

    expect(allStats.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "kemiskinan" })
    );
    expect(allStats.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "miskin" })
    );
    expect(text).toContain('dengan kata kunci "miskin"');
    expect(text).toContain("Analisis Kemiskinan");
    expect(text).toContain("- Tipe: Publikasi");
  });
});
