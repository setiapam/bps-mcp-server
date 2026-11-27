import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BPS_API_METHOD_NAMES,
  createBpsCodeApi,
} from "../../../src/codemode/bps-api.js";
import { QuickJSExecutor } from "../../../src/codemode/quickjs-executor.js";
import { createCodeModeServer } from "../../../src/codemode/server.js";
import { InMemoryCache } from "../../../src/services/cache.js";
import type { BpsClient } from "../../../src/client/bps-client.js";
import type { AllStatsClient } from "../../../src/client/allstats-client.js";
import type { DomainResolver } from "../../../src/services/domain-resolver.js";
import type { Config } from "../../../src/config/index.js";
import type { IAuthProvider } from "../../../src/auth/types.js";

function createMocks() {
  const client = {
    listDomains: vi.fn().mockResolvedValue({
      data: [
        { domain_id: "3500", domain_name: "Jawa Timur", domain_url: "https://jatim.bps.go.id" },
        { domain_id: "3200", domain_name: "Jawa Barat", domain_url: "https://jabar.bps.go.id" },
      ],
    }),
    listAllSubjects: vi.fn().mockResolvedValue([{ sub_id: 23, title: "Kemiskinan" }]),
    listSubjects: vi.fn().mockResolvedValue({ data: [{ sub_id: 23, title: "Kemiskinan" }] }),
    listSubjectCategories: vi.fn().mockResolvedValue([{ subcat_id: 1, title: "Sosial" }]),
    listVariables: vi.fn().mockResolvedValue({
      page: { page: 1, pages: 1, total: 1, per_page: 10, count: 1 },
      data: [
        {
          var_id: 192,
          title: "Persentase Penduduk Miskin (P0) Menurut Provinsi",
          sub_id: 23,
          sub_name: "Kemiskinan",
          unit: "Persen",
          def: "Persentase penduduk yang berada di bawah garis kemiskinan.",
        },
      ],
    }),
    listAllVerticalVariables: vi.fn().mockResolvedValue([{ kode_ver_id: 3500, vervar: "Jawa Timur" }]),
    listAllDerivedVariables: vi.fn().mockResolvedValue([{ kode_tur_id: 0, turvar: "Tidak ada" }]),
    listPeriods: vi.fn().mockResolvedValue([{ th_id: 124, th_name: "2024" }]),
    listAllPeriods: vi.fn().mockResolvedValue([
      { th_id: 124, th_name: "2024" },
      { th_id: 123, th_name: "2023" },
    ]),
    listDerivedPeriods: vi.fn().mockResolvedValue([{ turth_id: 63, turth_name: "Tahunan" }]),
    listUnits: vi.fn().mockResolvedValue([{ unit_id: 1, unit: "Persen" }]),
    getDynamicData: vi.fn().mockResolvedValue({
      status: "OK",
      "data-availability": "available",
      data: null,
      var: [{ var_id: 192, title: "Persentase Penduduk Miskin (P0) Menurut Provinsi", sub_id: 23, sub_name: "Kemiskinan", unit: "Persen" }],
      vervar: [
        { kode_vervar: 3500, label_vervar: "Jawa Timur" },
        { kode_vervar: 3200, label_vervar: "Jawa Barat" },
        { kode_vervar: 9999, label_vervar: "INDONESIA" },
      ],
      turvar: [{ kode_turvar: 0, label_turvar: "Tidak ada" }],
      tahun: [
        { th_id: 123, th_name: "2023" },
        { th_id: 124, th_name: "2024" },
      ],
      turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
      datacontent: {
        "3500192012363": 10.35,
        "3500192012463": 9.79,
        "3200192012363": 7.62,
        "3200192012463": 7.46,
        "9999192012363": 9.36,
        "9999192012463": 9.03,
      },
    }),
    listStaticTables: vi.fn().mockResolvedValue({
      page: { page: 1, pages: 1, total: 1, per_page: 10, count: 1 },
      data: [{ table_id: 10, title: "Tabel Agama", subj_id: 1, updt_date: "2024-01-01", size: "10 KB" }],
    }),
    getStaticTable: vi.fn().mockResolvedValue({
      table_id: 10,
      title: "Tabel Agama",
      subj_id: 1,
      subj: "Sosial",
      updt_date: "2024-01-01",
      size: "10 KB",
      table: "<table><tr><th>Agama</th><th>Jumlah</th></tr><tr><td>Islam</td><td>100</td></tr></table>",
    }),
    listPublications: vi.fn().mockResolvedValue({
      page: { page: 1, pages: 1, total: 1, per_page: 10, count: 1 },
      data: [{ pub_id: "pub1", title: "Statistik Indonesia", sch_date: "2024-02-28", rl_date: "2024-02-28" }],
    }),
    getPublication: vi.fn().mockResolvedValue({
      pub_id: "pub1",
      title: "Statistik Indonesia",
      sch_date: "2024-02-28",
      rl_date: "2024-02-28",
      abstract: "<p>Ringkasan <b>penting</b></p>",
    }),
    listPressReleases: vi.fn().mockResolvedValue({
      page: { page: 1, pages: 1, total: 1, per_page: 10, count: 1 },
      data: [{ brs_id: 5, title: "BRS Inflasi", subj_id: 3, rl_date: "2024-05-02" }],
    }),
    getPressRelease: vi.fn().mockResolvedValue({
      brs_id: 5,
      title: "BRS Inflasi",
      subj_id: 3,
      rl_date: "2024-05-02",
      abstract: "<p>Inflasi <i>Mei</i></p>",
    }),
    listStrategicIndicators: vi.fn().mockResolvedValue({
      page: { page: 1, pages: 1, total: 1, per_page: 10, count: 1 },
      data: [{ indicator_id: 1, title: "Inflasi Year on Year", value: 2.84, unit: "%", periode: "Mei 2024" }],
    }),
    getTradeData: vi.fn().mockResolvedValue({
      data: [
        { ctr: "Jepang", value: 1500, netweight: 500, kodehs: "[09] Kopi, teh, dan rempah-rempah" },
        { ctr: "Amerika Serikat", value: 2500, netweight: 800, kodehs: "[09] Kopi, teh, dan rempah-rempah" },
      ],
    }),
    listGlossary: vi.fn().mockResolvedValue({
      data: [
        {
          _id: "1",
          _source: {
            judulIndikator: "Kemiskinan",
            definisi: "Ketidakmampuan dari sisi ekonomi.",
            satuan: "Persen",
            sumberData: "Susenas",
          },
        },
      ],
    }),
    listInfographics: vi.fn().mockResolvedValue({
      data: [{ inf_id: 1, title: "Infografis Inflasi(1)2024-05-02", img: "", date: "2024-05-02", desc: "<p>desc</p>", category: 1, dl: "" }],
    }),
    getInfographic: vi.fn().mockResolvedValue({
      inf_id: 1,
      title: "Infografis Inflasi(1)2024-05-02",
      img: "https://example.com/1.png",
      date: "2024-05-02",
      desc: "<p>Halo <b>BPS</b></p>",
      category: 1,
      dl: "https://example.com/1.png",
    }),
    listNews: vi.fn().mockResolvedValue({
      data: [{ news_id: 7, newscat_id: "1", newscat_name: "Umum", title: "Berita BPS", news: "", rl_date: "2024-05-01", picture: "" }],
    }),
    getNews: vi.fn().mockResolvedValue({
      news_id: 7,
      news_type: "1",
      newscat_name: "Umum",
      title: "Berita BPS",
      news: "<p>Isi berita</p>",
      rl_date: "2024-05-01",
      picture: "",
    }),
    listCensusEvents: vi.fn().mockResolvedValue([{ id: "sp2020", kegiatan: "Sensus Penduduk", tahun_kegiatan: 2020 }]),
    listCensusTopics: vi.fn().mockResolvedValue([{ id: 1, topik: "Penduduk", topic: "Population", id_kegiatan: "sp2020", kegiatan: "Sensus Penduduk" }]),
    listCsaSubjectCategories: vi.fn().mockResolvedValue([{ subcat_id: 1, title: "Demografi" }]),
    listCsaSubjects: vi.fn().mockResolvedValue({ data: [{ sub_id: 1, title: "Penduduk", subcat_id: 1, subcat: "Demografi", ntabel: 5, desc: "", icon: "" }] }),
    listCsaTables: vi.fn().mockResolvedValue({ data: [{ id: "t1", title: "Tabel CSA", oldest_period: "2020", latest_period: "2024", id_subject: 1, subject: "Penduduk", id_subcat: 1, tablesource: "1", last_update: "2024-01-01" }] }),
    getCsaTable: vi.fn().mockResolvedValue({
      table_id: 1,
      sub_id: 1,
      subcsa_id: 1,
      subcsa: "Demografi",
      title: "Tabel CSA",
      table: "<table><tr><th>Kolom</th><th>Nilai</th></tr><tr><td>A</td><td>10</td></tr></table>",
      cr_date: "2024-01-01",
      updt_date: "2024-01-01",
      size: "1 KB",
    }),
    search: vi.fn().mockResolvedValue({
      page: { page: 1, pages: 1, total: 1, per_page: 10, count: 1 },
      data: [{ table_id: 10, title: "Tabel Kemiskinan" }],
    }),
  } as unknown as BpsClient;

  const allStatsClient = {
    search: vi.fn().mockResolvedValue({
      query: "kemiskinan",
      totalResults: 1,
      currentPage: 1,
      totalPages: 1,
      results: [{ url: "https://bps.go.id/pub", title: "Pub Kemiskinan", description: "desc", contentType: "publication", domain: "0000" }],
    }),
    deepSearch: vi.fn().mockResolvedValue({
      query: "stunting",
      publication: { title: "Statistik", publisher: "BPS", coverUrl: "", publicationUrl: "", pdfDownloadBase: "" },
      totalMatches: 1,
      currentPage: 1,
      totalPages: 1,
      matches: [{ pageNumber: 12, excerpt: "stunting turun", highlights: ["stunting"], pdfViewerUrl: "" }],
    }),
  } as unknown as AllStatsClient;

  const resolver = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getDomains: vi.fn().mockReturnValue([
      { domain_id: "3500", domain_name: "Jawa Timur", domain_url: "" },
      { domain_id: "3200", domain_name: "Jawa Barat", domain_url: "" },
    ]),
    resolve: vi.fn().mockImplementation(async (q: string) => {
      if (q.toLowerCase().includes("timur") || q.toLowerCase().includes("jatim")) {
        return { domainId: "3500", domainName: "Jawa Timur" };
      }
      if (q.toLowerCase().includes("barat") || q.toLowerCase().includes("jabar")) {
        return { domainId: "3200", domainName: "Jawa Barat" };
      }
      return null;
    }),
  } as unknown as DomainResolver;

  const config: Config = {
    authType: "api-key",
    apiKey: "test-key",
    apiBaseUrl: "https://webapi.bps.go.id/v1",
    defaultLang: "ind",
    defaultDomain: "0000",
    cacheEnabled: true,
    cacheMaxEntries: 100,
    logLevel: "error",
  };

  const cache = new InMemoryCache(100);
  return { client, allStatsClient, resolver, config, cache };
}

describe("bps-api Code Mode catalog (39 methods + help)", () => {
  let mocks: ReturnType<typeof createMocks>;
  let api: ReturnType<typeof createBpsCodeApi>;

  beforeEach(() => {
    mocks = createMocks();
    api = createBpsCodeApi({
      ...mocks,
      store: null,
    });
  });

  it("registers all 39 BPS tool methods plus help", () => {
    expect(BPS_API_METHOD_NAMES).toHaveLength(39);
    for (const method of BPS_API_METHOD_NAMES) {
      expect(typeof api[method]).toBe("function");
    }
    expect(typeof api.help).toBe("function");
  });

  it("validates arguments with Zod and rejects invalid inputs", async () => {
    await expect(api.getDynamicData({})).rejects.toThrow(/var/i);
    await expect(api.getRanking({ query: "kemiskinan" })).rejects.toThrow(/Invalid arguments/i);
    await expect(
      api.allstatsDeepSearch({ query: "x", publication_id: "invalid" })
    ).rejects.toThrow(/24 karakter hex/);
    await expect(api.listDomains({ type: "kabbyprov" })).rejects.toThrow(/prov/i);
  });

  it("returns structured JSON for custom Smart, Analysis, Trade, Search & Glossary tools", async () => {
    const findVar = (await api.findVariable({ keyword: "kemiskinan" })) as { count: number; variables: unknown[] };
    expect(findVar.count).toBeGreaterThan(0);

    const findData = (await api.findData({ query: "kemiskinan", region: "Jawa Timur", year: "2024" })) as {
      source: string;
      rows: unknown[];
      rawResponse?: unknown;
    };
    expect(findData.source).toBe("dynamic_data");
    expect(findData.rows.length).toBeGreaterThan(0);
    expect(findData.rawResponse).toBeUndefined();

    const compare = (await api.compareData({
      query: "kemiskinan",
      regions: ["Jawa Timur", "Jawa Barat"],
      years: "2023-2024",
    })) as { multiYear: boolean; usedNationalTable: boolean; series: unknown[] };
    expect(compare.multiYear).toBe(true);
    expect(compare.usedNationalTable).toBe(true);
    expect(compare.series).toHaveLength(2);

    const trend = (await api.getTrend({ query: "kemiskinan", region: "Indonesia", years: "2023-2024" })) as {
      points: Array<{ year: string; value: number }>;
      direction?: string;
    };
    expect(trend.points.length).toBe(2);
    expect(trend.direction).toBe("turun");

    const ranking = (await api.getRanking({ query: "kemiskinan", level: "provinsi", top_n: 2 })) as {
      level: string;
      rows: Array<{ province: string; value: number }>;
    };
    expect(ranking.level).toBe("provinsi");
    expect(ranking.rows).toHaveLength(2);
    expect(ranking.rows[0].province).toBe("Jawa Timur");

    const trade = (await api.getTradeData({ commodity: "kopi", year: "2024" })) as {
      hsCode: string;
      totalValue: number;
      byCountry: Array<{ country: string }>;
    };
    expect(trade.hsCode).toBe("09");
    expect(trade.totalValue).toBe(4000);
    expect(trade.byCountry[0].country).toBe("Amerika Serikat");

    const searchRes = (await api.search({ keyword: "kemiskinan" })) as { source: string; groups: Record<string, unknown[]> };
    expect(searchRes.source).toBe("webapi");
    expect(searchRes.groups.statictable).toHaveLength(1);

    const glossary = (await api.listGlossary({ keyword: "kemiskinan" })) as { source: string; items: unknown[] };
    expect(glossary.source).toBe("glossary");
    expect(glossary.items).toHaveLength(1);
  });

  it("cleans HTML in publication, press release, infographic, news, and static/CSA tables", async () => {
    const pub = (await api.getPublication({ domain: "0000", id: "pub1" })) as { abstract: string };
    expect(pub.abstract).toBe("Ringkasan penting");

    const pr = (await api.getPressRelease({ domain: "0000", id: 5 })) as { abstract: string };
    expect(pr.abstract).toBe("Inflasi Mei");

    const table = (await api.getStaticTable({ domain: "0000", id: 10 })) as {
      markdownTable: string;
      headers: string[];
      rows: string[][];
    };
    expect(table.headers).toEqual(["Agama", "Jumlah"]);
    expect(table.rows).toEqual([["Islam", "100"]]);
    expect(table.markdownTable).toContain("| Agama | Jumlah |");

    const inf = (await api.getInfographic({ domain: "0000", id: 1 })) as { title: string; desc: string };
    expect(inf.title).toBe("Infografis Inflasi");
    expect(inf.desc).toBe("Halo BPS");

    const news = (await api.getNews({ domain: "0000", id: 7 })) as { news: string };
    expect(news.news).toBe("Isi berita");

    const csa = (await api.getCsaTable({ domain: "0000", id: "t1" })) as { headers: string[] };
    expect(csa.headers).toEqual(["Kolom", "Nilai"]);
  });

  it("supports multi-tool composition via Promise.all inside QuickJSExecutor", async () => {
    const executor = new QuickJSExecutor();
    const execResult = await executor.execute(
      `
      const [dom, trade, helpDoc] = await Promise.all([
        bps.resolveDomain({ query: "Jatim" }),
        bps.getTradeData({ commodity: "kopi", year: "2024" }),
        bps.help("findData"),
      ]);
      return {
        domainId: dom.domainId,
        topExporter: trade.byCountry[0].country,
        helpTool: helpDoc.standardTool,
      };
      `,
      api
    );

    expect(execResult.error).toBeUndefined();
    expect(execResult.callsUsed).toBe(3);
    expect(execResult.result).toEqual({
      domainId: "3500",
      topExporter: "Amerika Serikat",
      helpTool: "find_data",
    });
  });

  it("createCodeModeServer registers only the single execute_bps_code tool", async () => {
    const auth: IAuthProvider = {
      getHeaders: async () => ({}),
      getQueryParams: async () => ({ key: "test-key" }),
    };
    const { server } = createCodeModeServer(mocks.config, auth, mocks.cache, null, "0.19.0", {
      executor: new QuickJSExecutor(),
    });
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(tools)).toEqual(["execute_bps_code"]);
  });
});
