import { z } from "zod/v4";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient } from "../client/allstats-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { ICacheProvider } from "../services/cache.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import type { CodeModeHostFn } from "./executor.js";
import type { BpsCsaTableDetail, BpsDynamicDataResponse } from "../client/types.js";
import { findDataService, findVariableService } from "../services/smart-service.js";
import {
  compareDataService,
  getRankingService,
  getTrendService,
} from "../services/analysis-service.js";
import { allstatsSearchService, searchService } from "../services/search-service.js";
import { getTradeDataService } from "../services/trade-service.js";
import { listGlossaryService } from "../services/glossary-service.js";
import { getDynamicDataService } from "../services/dynamic-data-service.js";
import { buildStructuredPayload } from "../services/data-formatter.js";
import { htmlTableToMarkdown, parseHtmlTable, stripHtml } from "../utils/html.js";

export interface BpsCodeApiDeps {
  client: BpsClient;
  allStatsClient: AllStatsClient;
  resolver: DomainResolver;
  config: Config;
  cache: ICacheProvider | null;
  store: IPersistentStore | null;
}

export interface MethodHelpDoc {
  method: string;
  standardTool: string;
  signature: string;
  description: string;
  example: string;
}

export const BPS_API_HELP: Record<string, MethodHelpDoc> = {
  // A. Smart & Analysis (5)
  findData: {
    method: "findData",
    standardTool: "find_data",
    signature: "findData({ query, region?, year?, bypassRedirect? })",
    description: "Cari dan ambil data BPS satu wilayah otomatis (returns structured rows).",
    example: 'await bps.findData({ query: "kemiskinan", region: "Jawa Timur", year: "2024" })',
  },
  findVariable: {
    method: "findVariable",
    standardTool: "find_variable",
    signature: "findVariable({ keyword, domain?, subject? })",
    description: "Cari variabel tabel dinamis BPS berdasarkan kata kunci.",
    example: 'await bps.findVariable({ keyword: "pengangguran", domain: "3500" })',
  },
  compareData: {
    method: "compareData",
    standardTool: "compare_data",
    signature: "compareData({ query, regions, year?, years?, start_year?, end_year? })",
    description: "Bandingkan indikator antar 2+ wilayah (single-year atau multi-tahun).",
    example: 'await bps.compareData({ query: "kemiskinan", regions: ["Jawa Timur", "Jawa Barat"], years: "2021-2025" })',
  },
  getTrend: {
    method: "getTrend",
    standardTool: "get_trend",
    signature: "getTrend({ query, region?, start_year?, end_year?, years? })",
    description: "Ambil data tren time-series multi-tahun untuk satu wilayah.",
    example: 'await bps.getTrend({ query: "IPM", region: "Indonesia", years: "2020-2024" })',
  },
  getRanking: {
    method: "getRanking",
    standardTool: "get_ranking",
    signature: "getRanking({ query, level, top_n?, order?, year?, period_mode?, provinces? })",
    description: 'Ranking wilayah level "provinsi" atau "kabkota" (tahun diseragamkan).',
    example: 'await bps.getRanking({ query: "pengangguran", level: "kabkota", top_n: 10, order: "highest" })',
  },
  // B. Domain (2)
  listDomains: {
    method: "listDomains",
    standardTool: "list_domains",
    signature: "listDomains({ type?, prov? })",
    description: "Daftar domain/wilayah BPS (all, prov, kab, kabbyprov).",
    example: 'await bps.listDomains({ type: "prov" })',
  },
  resolveDomain: {
    method: "resolveDomain",
    standardTool: "resolve_domain",
    signature: "resolveDomain({ query })",
    description: "Konversi nama/singkatan wilayah ke kode domain BPS 4 digit.",
    example: 'await bps.resolveDomain({ query: "Jatim" })',
  },
  // C. Dynamic Data & Metadata (9)
  listSubjects: {
    method: "listSubjects",
    standardTool: "list_subjects",
    signature: "listSubjects({ domain?, subcat? })",
    description: "Daftar seluruh subjek statistik untuk suatu domain.",
    example: 'await bps.listSubjects({ domain: "0000" })',
  },
  listSubjectCategories: {
    method: "listSubjectCategories",
    standardTool: "list_subject_categories",
    signature: "listSubjectCategories({ domain? })",
    description: "Daftar kategori subjek statistik BPS.",
    example: 'await bps.listSubjectCategories({ domain: "0000" })',
  },
  listVariables: {
    method: "listVariables",
    standardTool: "list_variables",
    signature: "listVariables({ domain?, subject?, year?, page? })",
    description: "Daftar variabel tabel dinamis BPS.",
    example: 'await bps.listVariables({ domain: "0000", subject: 23, page: 1 })',
  },
  listVerticalVariables: {
    method: "listVerticalVariables",
    standardTool: "list_vertical_variables",
    signature: "listVerticalVariables({ domain?, var? })",
    description: "Daftar variabel vertikal (vervar / kategori disaggregasi).",
    example: 'await bps.listVerticalVariables({ domain: "0000", var: 185 })',
  },
  listDerivedVariables: {
    method: "listDerivedVariables",
    standardTool: "list_derived_variables",
    signature: "listDerivedVariables({ domain?, var? })",
    description: "Daftar turunan variabel (turvar).",
    example: 'await bps.listDerivedVariables({ domain: "0000", var: 185 })',
  },
  listPeriods: {
    method: "listPeriods",
    standardTool: "list_periods",
    signature: "listPeriods({ domain?, var?, page? })",
    description: "Daftar periode yang tersedia untuk variabel.",
    example: 'await bps.listPeriods({ domain: "0000", var: 543 })',
  },
  listDerivedPeriods: {
    method: "listDerivedPeriods",
    standardTool: "list_derived_periods",
    signature: "listDerivedPeriods({ domain?, var? })",
    description: "Daftar turunan periode (turth, mis. bulan/semester).",
    example: 'await bps.listDerivedPeriods({ domain: "0000", var: 543 })',
  },
  listUnits: {
    method: "listUnits",
    standardTool: "list_units",
    signature: "listUnits({ domain?, page? })",
    description: "Daftar satuan data di domain tertentu.",
    example: 'await bps.listUnits({ domain: "0000" })',
  },
  getDynamicData: {
    method: "getDynamicData",
    standardTool: "get_dynamic_data",
    signature: "getDynamicData({ domain?, var, th?, turvar?, vervar?, turth?, raw? })",
    description: "Ambil data tabel dinamis BPS; `th` menerima tahun ('2021-2025'). Return JSON terstruktur kecuali raw=true.",
    example: 'await bps.getDynamicData({ domain: "0000", var: 543, th: "2023-2024" })',
  },
  // D. Search & AllStats (3)
  search: {
    method: "search",
    standardTool: "search",
    signature: "search({ keyword, domain?, type?, page? })",
    description: "Pencarian lintas tipe (tabel statis, publikasi, BRS, indikator) + fallback AllStats.",
    example: 'await bps.search({ keyword: "inflasi", type: "all" })',
  },
  allstatsSearch: {
    method: "allstatsSearch",
    standardTool: "allstats_search",
    signature: "allstatsSearch({ query, content?, domain?, page?, title_only?, year_from?, year_to?, sort? })",
    description: "Pencarian AllStats Search Engine (otomatis retry akar kata).",
    example: 'await bps.allstatsSearch({ query: "kemiskinan", content: "publication" })',
  },
  allstatsDeepSearch: {
    method: "allstatsDeepSearch",
    standardTool: "allstats_deep_search",
    signature: "allstatsDeepSearch({ query, publication_id, domain?, page? })",
    description: "Full-text search di dalam isi PDF publikasi BPS.",
    example: 'await bps.allstatsDeepSearch({ query: "stunting", publication_id: "0123456789abcdef01234567" })',
  },
  // E. Static Tables, Publications, Press Releases, Reference, Trade & Glossary (9)
  listStaticTables: {
    method: "listStaticTables",
    standardTool: "list_static_tables",
    signature: "listStaticTables({ domain?, keyword?, year?, month?, page? })",
    description: "Daftar tabel statis BPS.",
    example: 'await bps.listStaticTables({ domain: "0000", keyword: "agama" })',
  },
  getStaticTable: {
    method: "getStaticTable",
    standardTool: "get_static_table",
    signature: "getStaticTable({ domain, id })",
    description: "Ambil isi satu tabel statis BPS (markdownTable + headers/rows).",
    example: 'await bps.getStaticTable({ domain: "0000", id: 1494 })',
  },
  listPublications: {
    method: "listPublications",
    standardTool: "list_publications",
    signature: "listPublications({ domain?, keyword?, year?, month?, page? })",
    description: "Daftar publikasi BPS.",
    example: 'await bps.listPublications({ domain: "0000", keyword: "Statistik Indonesia", year: 2024 })',
  },
  getPublication: {
    method: "getPublication",
    standardTool: "get_publication",
    signature: "getPublication({ domain, id })",
    description: "Detail satu publikasi BPS (abstrak sudah dibersihkan dari HTML).",
    example: 'await bps.getPublication({ domain: "0000", id: "abc123" })',
  },
  listPressReleases: {
    method: "listPressReleases",
    standardTool: "list_press_releases",
    signature: "listPressReleases({ domain?, keyword?, year?, month?, page? })",
    description: "Daftar Berita Resmi Statistik (BRS).",
    example: 'await bps.listPressReleases({ domain: "0000", keyword: "inflasi" })',
  },
  getPressRelease: {
    method: "getPressRelease",
    standardTool: "get_press_release",
    signature: "getPressRelease({ domain, id })",
    description: "Detail satu Berita Resmi Statistik (BRS).",
    example: 'await bps.getPressRelease({ domain: "0000", id: 2345 })',
  },
  listStrategicIndicators: {
    method: "listStrategicIndicators",
    standardTool: "list_strategic_indicators",
    signature: "listStrategicIndicators({ domain?, var?, page? })",
    description: "Daftar indikator strategis (angka headline terbaru).",
    example: 'await bps.listStrategicIndicators({ domain: "0000" })',
  },
  getTradeData: {
    method: "getTradeData",
    standardTool: "get_trade_data",
    signature: "getTradeData({ source?, hs_code?, commodity?, hs_type?, year?, period? })",
    description: "Data perdagangan ekspor/impor menurut kode HS atau nama komoditas.",
    example: 'await bps.getTradeData({ commodity: "kopi", source: "ekspor", year: "2024" })',
  },
  listGlossary: {
    method: "listGlossary",
    standardTool: "list_glossary",
    signature: "listGlossary({ domain?, keyword?, page? })",
    description: "Cari definisi istilah statistik BPS (dengan fallback definisi variabel).",
    example: 'await bps.listGlossary({ keyword: "kemiskinan" })',
  },
  // F. Infographics, News, Census, CSA & Utility (11)
  listInfographics: {
    method: "listInfographics",
    standardTool: "list_infographics",
    signature: "listInfographics({ domain?, keyword?, page? })",
    description: "Daftar infografis BPS.",
    example: 'await bps.listInfographics({ domain: "0000", keyword: "inflasi" })',
  },
  getInfographic: {
    method: "getInfographic",
    standardTool: "get_infographic",
    signature: "getInfographic({ domain, id })",
    description: "Detail satu infografis BPS.",
    example: 'await bps.getInfographic({ domain: "0000", id: 100 })',
  },
  listNews: {
    method: "listNews",
    standardTool: "list_news",
    signature: "listNews({ domain?, keyword?, page? })",
    description: "Daftar berita umum website BPS.",
    example: 'await bps.listNews({ domain: "0000", keyword: "sensus" })',
  },
  getNews: {
    method: "getNews",
    standardTool: "get_news",
    signature: "getNews({ domain, id })",
    description: "Detail satu berita website BPS.",
    example: 'await bps.getNews({ domain: "0000", id: 100 })',
  },
  listCensusEvents: {
    method: "listCensusEvents",
    standardTool: "list_census_events",
    signature: "listCensusEvents()",
    description: "Daftar kegiatan sensus BPS.",
    example: "await bps.listCensusEvents()",
  },
  listCensusTopics: {
    method: "listCensusTopics",
    standardTool: "list_census_topics",
    signature: "listCensusTopics({ kegiatan })",
    description: "Daftar topik data untuk suatu kegiatan sensus.",
    example: 'await bps.listCensusTopics({ kegiatan: "sp2020" })',
  },
  listCsaCategories: {
    method: "listCsaCategories",
    standardTool: "list_csa_categories",
    signature: "listCsaCategories({ domain? })",
    description: "Daftar kategori CSA (Classification of Statistical Activities).",
    example: 'await bps.listCsaCategories({ domain: "0000" })',
  },
  listCsaSubjects: {
    method: "listCsaSubjects",
    standardTool: "list_csa_subjects",
    signature: "listCsaSubjects({ domain?, subcat?, page? })",
    description: "Daftar subjek CSA.",
    example: 'await bps.listCsaSubjects({ domain: "0000" })',
  },
  listCsaTables: {
    method: "listCsaTables",
    standardTool: "list_csa_tables",
    signature: "listCsaTables({ domain?, subject?, page? })",
    description: "Daftar tabel CSA.",
    example: 'await bps.listCsaTables({ domain: "0000", subject: 1 })',
  },
  getCsaTable: {
    method: "getCsaTable",
    standardTool: "get_csa_table",
    signature: "getCsaTable({ domain, id })",
    description: "Ambil detail satu tabel CSA (markdown + structured rows).",
    example: 'await bps.getCsaTable({ domain: "0000", id: "123" })',
  },
  clearCache: {
    method: "clearCache",
    standardTool: "cache_clear",
    signature: "clearCache()",
    description: "Bersihkan cache in-memory/KV untuk memaksa pengambilan data baru.",
    example: "await bps.clearCache()",
  },
};

export const BPS_API_METHOD_NAMES = Object.keys(BPS_API_HELP);

function validate<T>(schema: z.ZodType<T>, rawArgs: Record<string, unknown> | undefined, method: string): T {
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid arguments for bps.${method}(): ${details}`);
  }
  return parsed.data;
}

function isDynamicCsaTable(
  value: BpsCsaTableDetail | BpsDynamicDataResponse
): value is BpsDynamicDataResponse {
  return "datacontent" in value || "var" in value;
}

const StringOrArray = z.union([z.string(), z.array(z.string())]);

const Schemas = {
  findData: z.object({
    query: z.string().min(1),
    region: z.string().default("Indonesia"),
    year: z.string().optional(),
    bypassRedirect: z.boolean().default(true),
  }),
  findVariable: z.object({
    keyword: z.string().optional(),
    keywords: z.string().optional(),
    query: z.string().optional(),
    domain: z.string().default("0000"),
    subject: z.number().optional(),
  }),
  compareData: z.object({
    query: z.string().min(1),
    regions: StringOrArray.optional(),
    wilayah: StringOrArray.optional(),
    provinces: StringOrArray.optional(),
    year: z.string().optional(),
    years: z.string().optional(),
    start_year: z.string().optional(),
    end_year: z.string().optional(),
  }),
  getTrend: z.object({
    query: z.string().min(1),
    region: z.string().optional(),
    wilayah: z.string().optional(),
    start_year: z.string().optional(),
    end_year: z.string().optional(),
    years: z.string().optional(),
  }),
  getRanking: z.object({
    query: z.string().min(1),
    level: z.enum(["provinsi", "kabkota"]),
    top_n: z.number().int().min(1).max(200).default(10),
    order: z.enum(["highest", "lowest"]).default("highest"),
    year: z.string().optional(),
    period_mode: z.enum(["common", "latest"]).default("common"),
    provinces: StringOrArray.optional(),
  }),
  listDomains: z.object({
    type: z.enum(["all", "prov", "kab", "kabbyprov"]).default("all"),
    prov: z.string().optional(),
  }),
  resolveDomain: z.object({
    query: z.string().min(1),
  }),
  listSubjects: z.object({
    domain: z.string().default("0000"),
    subcat: z.number().optional(),
  }),
  listSubjectCategories: z.object({
    domain: z.string().default("0000"),
  }),
  listVariables: z.object({
    domain: z.string().default("0000"),
    subject: z.number().optional(),
    year: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  listVerticalVariables: z.object({
    domain: z.string().default("0000"),
    var: z.number().optional(),
  }),
  listDerivedVariables: z.object({
    domain: z.string().default("0000"),
    var: z.number().optional(),
  }),
  listPeriods: z.object({
    domain: z.string().default("0000"),
    var: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  listDerivedPeriods: z.object({
    domain: z.string().default("0000"),
    var: z.number().optional(),
  }),
  listUnits: z.object({
    domain: z.string().default("0000"),
    page: z.number().int().min(1).optional(),
  }),
  getDynamicData: z.object({
    domain: z.string().default("0000"),
    var: z.union([z.string(), z.number()]).optional(),
    var_id: z.union([z.string(), z.number()]).optional(),
    th: z.string().optional(),
    turvar: z.string().optional(),
    vervar: z.string().optional(),
    turth: z.string().optional(),
    raw: z.boolean().default(false),
  }),
  search: z.object({
    keyword: z.string().optional(),
    keywords: z.string().optional(),
    query: z.string().optional(),
    domain: z.string().default("0000"),
    type: z
      .enum(["all", "statictable", "publication", "pressrelease", "strategicindicator"])
      .default("all"),
    page: z.number().int().min(1).default(1),
  }),
  allstatsSearch: z.object({
    query: z.string().min(1),
    content: z
      .enum([
        "all",
        "publication",
        "table",
        "pressrelease",
        "infographic",
        "microdata",
        "news",
        "glosarium",
        "kbli2020",
        "kbli2017",
        "kbli2015",
        "kbli2009",
      ])
      .default("all"),
    domain: z.string().default("0000"),
    page: z.number().int().min(1).default(1),
    title_only: z.boolean().default(false),
    year_from: z.string().default("all"),
    year_to: z.string().default("all"),
    sort: z.enum(["terbaru", "relevansi"]).default("relevansi"),
  }),
  allstatsDeepSearch: z.object({
    query: z.string().min(1),
    publication_id: z.string().regex(/^[a-f0-9]{24}$/, "Harus berupa 24 karakter hex"),
    domain: z.string().default("0000"),
    page: z.number().int().min(1).default(1),
  }),
  listStaticTables: z.object({
    domain: z.string().default("0000"),
    keyword: z.string().optional(),
    year: z.number().optional(),
    month: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getStaticTable: z.object({
    domain: z.string().min(1),
    id: z.number(),
  }),
  listPublications: z.object({
    domain: z.string().default("0000"),
    keyword: z.string().optional(),
    year: z.number().optional(),
    month: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getPublication: z.object({
    domain: z.string().min(1),
    id: z.string().min(1),
  }),
  listPressReleases: z.object({
    domain: z.string().default("0000"),
    keyword: z.string().optional(),
    year: z.number().optional(),
    month: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getPressRelease: z.object({
    domain: z.string().min(1),
    id: z.number(),
  }),
  listStrategicIndicators: z.object({
    domain: z.string().default("0000"),
    var: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getTradeData: z.object({
    source: z.enum(["1", "2", "ekspor", "impor"]).default("1"),
    hs_code: z
      .string()
      .regex(/^\d{2,10}$/, "Kode HS harus berupa 2-10 digit")
      .optional(),
    commodity: z.string().optional(),
    komoditas: z.string().optional(),
    hs_type: z.enum(["1", "2"]).optional(),
    year: z
      .string()
      .regex(/^\d{4}$/, "Tahun harus 4 digit")
      .optional(),
    period: z.enum(["1", "2", "bulanan", "tahunan"]).default("2"),
  }),
  listGlossary: z.object({
    domain: z.string().default("0000"),
    keyword: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  listInfographics: z.object({
    domain: z.string().default("0000"),
    keyword: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getInfographic: z.object({
    domain: z.string().min(1),
    id: z.number(),
  }),
  listNews: z.object({
    domain: z.string().default("0000"),
    keyword: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getNews: z.object({
    domain: z.string().min(1),
    id: z.number(),
  }),
  listCensusTopics: z.object({
    kegiatan: z.string().min(1),
  }),
  listCsaCategories: z.object({
    domain: z.string().default("0000"),
  }),
  listCsaSubjects: z.object({
    domain: z.string().default("0000"),
    subcat: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  listCsaTables: z.object({
    domain: z.string().default("0000"),
    subject: z.number().optional(),
    page: z.number().int().min(1).optional(),
  }),
  getCsaTable: z.object({
    domain: z.string().min(1),
    id: z.string().min(1),
  }),
  help: z.object({
    method: z.string().optional(),
  }),
};

/**
 * Create the complete 39-method `bps.*` host function registry (+ `bps.help`)
 * for Code Mode sandbox execution.
 */
export function createBpsCodeApi(deps: BpsCodeApiDeps): Record<string, CodeModeHostFn> {
  const { client, allStatsClient, resolver, cache, store } = deps;

  return {
    // ===== A. Custom Smart & Analysis Tools (5) =====

    findData: async (rawArgs) => {
      const args = validate(Schemas.findData, rawArgs, "findData");
      const outcome = await findDataService(client, resolver, store, args);
      // Strip raw BPS dynamic response to keep sandbox payload clean and compact
      const { rawResponse: _raw, ...structured } = outcome;
      return structured;
    },

    findVariable: async (rawArgs) => {
      const args = validate(Schemas.findVariable, rawArgs, "findVariable");
      const keyword = (args.keyword ?? args.keywords ?? args.query ?? "").trim();
      if (!keyword) {
        throw new Error("Parameter 'keyword' wajib diisi.");
      }
      return findVariableService(client, {
        keyword,
        domain: args.domain,
        subject: args.subject,
      });
    },

    compareData: async (rawArgs) => {
      const args = validate(Schemas.compareData, rawArgs, "compareData");
      return compareDataService(client, resolver, store, args);
    },

    getTrend: async (rawArgs) => {
      const args = validate(Schemas.getTrend, rawArgs, "getTrend");
      return getTrendService(client, resolver, store, args);
    },

    getRanking: async (rawArgs) => {
      const args = validate(Schemas.getRanking, rawArgs, "getRanking");
      const res = await getRankingService(client, resolver, store, args);
      if (res.level === "kabkota") {
        const { rawKabkotaResult: _raw, ...clean } = res;
        return clean;
      }
      return res;
    },

    // ===== B. Domain & Wilayah (2) =====

    listDomains: async (rawArgs) => {
      const args = validate(Schemas.listDomains, rawArgs, "listDomains");
      if (args.type === "kabbyprov" && !args.prov) {
        throw new Error("Parameter 'prov' wajib diisi jika type adalah 'kabbyprov'.");
      }
      const res = await client.listDomains(args.type, args.prov);
      return { count: res.data.length, domains: res.data };
    },

    resolveDomain: async (rawArgs) => {
      const args = validate(Schemas.resolveDomain, rawArgs, "resolveDomain");
      const resolved = await resolver.resolve(args.query);
      if (!resolved) return { found: false };
      return {
        found: true,
        domainId: resolved.domainId,
        domainName: resolved.domainName,
      };
    },

    // ===== C. Dynamic Data & Metadata (9) =====

    listSubjects: async (rawArgs) => {
      const args = validate(Schemas.listSubjects, rawArgs, "listSubjects");
      return client.listAllSubjects(args.domain, args.subcat);
    },

    listSubjectCategories: async (rawArgs) => {
      const args = validate(Schemas.listSubjectCategories, rawArgs, "listSubjectCategories");
      return client.listSubjectCategories(args.domain);
    },

    listVariables: async (rawArgs) => {
      const args = validate(Schemas.listVariables, rawArgs, "listVariables");
      return client.listVariables(args.domain, args.subject, args.year, args.page);
    },

    listVerticalVariables: async (rawArgs) => {
      const args = validate(Schemas.listVerticalVariables, rawArgs, "listVerticalVariables");
      return client.listAllVerticalVariables(args.domain, args.var);
    },

    listDerivedVariables: async (rawArgs) => {
      const args = validate(Schemas.listDerivedVariables, rawArgs, "listDerivedVariables");
      return client.listAllDerivedVariables(args.domain, args.var);
    },

    listPeriods: async (rawArgs) => {
      const args = validate(Schemas.listPeriods, rawArgs, "listPeriods");
      if (args.page !== undefined) {
        return client.listPeriods(args.domain, args.var, args.page);
      }
      return client.listAllPeriods(args.domain, args.var);
    },

    listDerivedPeriods: async (rawArgs) => {
      const args = validate(Schemas.listDerivedPeriods, rawArgs, "listDerivedPeriods");
      return client.listDerivedPeriods(args.domain, args.var);
    },

    listUnits: async (rawArgs) => {
      const args = validate(Schemas.listUnits, rawArgs, "listUnits");
      return client.listUnits(args.domain, args.page);
    },

    getDynamicData: async (rawArgs) => {
      const args = validate(Schemas.getDynamicData, rawArgs, "getDynamicData");
      const varArg = args.var ?? args.var_id;
      if (varArg === undefined || varArg === null || String(varArg).trim() === "") {
        throw new Error("Parameter 'var' wajib diisi dengan ID variabel.");
      }

      const outcome = await getDynamicDataService(client, {
        domain: args.domain,
        var: varArg,
        th: args.th,
        turvar: args.turvar,
        vervar: args.vervar,
        turth: args.turth,
      });

      if (outcome.status === "period_not_found") {
        throw new Error(
          `Tidak ada data untuk periode ${outcome.requestedText} pada variabel ${outcome.varId} (domain ${outcome.domain}).` +
            (outcome.availableLabels.length > 0
              ? ` Periode tersedia: ${outcome.availableLabels.join(", ")}`
              : "")
        );
      }

      if (outcome.status === "empty") {
        throw new Error(
          `Data kosong untuk var ${outcome.varId} (domain ${outcome.domain}) pada periode yang diminta.` +
            (outcome.availableYears.length > 0
              ? ` Tahun tersedia: ${outcome.availableYears.join(", ")}`
              : "")
        );
      }

      if (args.raw) {
        return outcome.raw;
      }

      return {
        indicator: outcome.indicator,
        domain: outcome.domain,
        varId: outcome.varId,
        unit: outcome.unit,
        units: outcome.units,
        period: outcome.period,
        periods: outcome.periodsUsed,
        missingYears: outcome.missingYears.length > 0 ? outcome.missingYears : undefined,
        rows: outcome.rows,
        note: outcome.note,
        periodNote: outcome.periodNote,
        aggregateNote: outcome.aggregateNote,
      };
    },

    // ===== D. Search & AllStats (3) =====

    search: async (rawArgs) => {
      const args = validate(Schemas.search, rawArgs, "search");
      const keyword = (args.keyword ?? args.keywords ?? args.query ?? "").trim();
      if (!keyword) {
        throw new Error("Parameter 'keyword' wajib diisi.");
      }
      const outcome = await searchService(client, allStatsClient, {
        keyword,
        domain: args.domain,
        type: args.type,
        page: args.page,
      });
      return {
        source: outcome.source,
        keyword: outcome.keyword,
        effectiveQuery: outcome.effectiveQuery,
        domain: outcome.domain,
        type: outcome.type,
        groups: outcome.groups,
        results: outcome.results,
        page: outcome.page,
        total: outcome.total,
      };
    },

    allstatsSearch: async (rawArgs) => {
      const args = validate(Schemas.allstatsSearch, rawArgs, "allstatsSearch");
      return allstatsSearchService(allStatsClient, args);
    },

    allstatsDeepSearch: async (rawArgs) => {
      const args = validate(Schemas.allstatsDeepSearch, rawArgs, "allstatsDeepSearch");
      return allStatsClient.deepSearch({
        query: args.query,
        publicationId: args.publication_id,
        domain: args.domain,
        page: args.page,
      });
    },

    // ===== E. Static Tables, Publications, Press Releases, Reference, Trade & Glossary (9) =====

    listStaticTables: async (rawArgs) => {
      const args = validate(Schemas.listStaticTables, rawArgs, "listStaticTables");
      return client.listStaticTables(args.domain, args.keyword, args.year, args.month, args.page);
    },

    getStaticTable: async (rawArgs) => {
      const args = validate(Schemas.getStaticTable, rawArgs, "getStaticTable");
      const detail = await client.getStaticTable(args.domain, args.id);
      const parsed = parseHtmlTable(detail.table);
      return {
        table_id: detail.table_id,
        title: detail.title,
        subj: detail.subj,
        updt_date: detail.updt_date,
        size: detail.size,
        excel: detail.excel,
        markdownTable: htmlTableToMarkdown(detail.table),
        headers: parsed && !parsed.isFrameset ? parsed.headers : undefined,
        rows: parsed && !parsed.isFrameset ? parsed.rows : undefined,
      };
    },

    listPublications: async (rawArgs) => {
      const args = validate(Schemas.listPublications, rawArgs, "listPublications");
      return client.listPublications(args.domain, args.keyword, args.year, args.month, args.page);
    },

    getPublication: async (rawArgs) => {
      const args = validate(Schemas.getPublication, rawArgs, "getPublication");
      const pub = await client.getPublication(args.domain, args.id);
      return {
        ...pub,
        abstract: pub.abstract ? stripHtml(pub.abstract) : pub.abstract,
      };
    },

    listPressReleases: async (rawArgs) => {
      const args = validate(Schemas.listPressReleases, rawArgs, "listPressReleases");
      return client.listPressReleases(args.domain, args.keyword, args.year, args.month, args.page);
    },

    getPressRelease: async (rawArgs) => {
      const args = validate(Schemas.getPressRelease, rawArgs, "getPressRelease");
      const pr = await client.getPressRelease(args.domain, args.id);
      return {
        ...pr,
        abstract: pr.abstract ? stripHtml(pr.abstract) : pr.abstract,
      };
    },

    listStrategicIndicators: async (rawArgs) => {
      const args = validate(Schemas.listStrategicIndicators, rawArgs, "listStrategicIndicators");
      return client.listStrategicIndicators(args.domain, args.var, args.page);
    },

    getTradeData: async (rawArgs) => {
      const args = validate(Schemas.getTradeData, rawArgs, "getTradeData");
      return getTradeDataService(client, args);
    },

    listGlossary: async (rawArgs) => {
      const args = validate(Schemas.listGlossary, rawArgs, "listGlossary");
      return listGlossaryService(client, allStatsClient, args);
    },

    // ===== F. Infographics, News, Census, CSA & Utility (11) =====

    listInfographics: async (rawArgs) => {
      const args = validate(Schemas.listInfographics, rawArgs, "listInfographics");
      return client.listInfographics(args.domain, args.keyword, args.page);
    },

    getInfographic: async (rawArgs) => {
      const args = validate(Schemas.getInfographic, rawArgs, "getInfographic");
      const inf = await client.getInfographic(args.domain, args.id);
      return {
        ...inf,
        title: inf.title.replace(/\(\d\)\d{4}-\d{2}-\d{2}$/, "").trim(),
        desc: stripHtml(inf.desc),
      };
    },

    listNews: async (rawArgs) => {
      const args = validate(Schemas.listNews, rawArgs, "listNews");
      return client.listNews(args.domain, args.keyword, args.page);
    },

    getNews: async (rawArgs) => {
      const args = validate(Schemas.getNews, rawArgs, "getNews");
      const detail = await client.getNews(args.domain, args.id);
      return {
        ...detail,
        news: stripHtml(detail.news),
      };
    },

    listCensusEvents: async () => {
      return client.listCensusEvents();
    },

    listCensusTopics: async (rawArgs) => {
      const args = validate(Schemas.listCensusTopics, rawArgs, "listCensusTopics");
      return client.listCensusTopics(args.kegiatan);
    },

    listCsaCategories: async (rawArgs) => {
      const args = validate(Schemas.listCsaCategories, rawArgs, "listCsaCategories");
      return client.listCsaSubjectCategories(args.domain);
    },

    listCsaSubjects: async (rawArgs) => {
      const args = validate(Schemas.listCsaSubjects, rawArgs, "listCsaSubjects");
      return client.listCsaSubjects(args.domain, args.subcat, args.page);
    },

    listCsaTables: async (rawArgs) => {
      const args = validate(Schemas.listCsaTables, rawArgs, "listCsaTables");
      return client.listCsaTables(args.domain, args.subject, args.page);
    },

    getCsaTable: async (rawArgs) => {
      const args = validate(Schemas.getCsaTable, rawArgs, "getCsaTable");
      const detail = await client.getCsaTable(args.domain, args.id);
      if (isDynamicCsaTable(detail)) {
        return {
          isDynamic: true,
          ...buildStructuredPayload(detail, args.domain),
        };
      }
      const parsed = parseHtmlTable(detail.table);
      return {
        ...detail,
        markdownTable: htmlTableToMarkdown(detail.table),
        headers: parsed && !parsed.isFrameset ? parsed.headers : undefined,
        rows: parsed && !parsed.isFrameset ? parsed.rows : undefined,
      };
    },

    clearCache: async () => {
      if (cache) {
        await cache.clear();
        return { cleared: true, message: "Cache berhasil dibersihkan." };
      }
      return { cleared: false, message: "Cache tidak aktif." };
    },

    // ===== In-sandbox Helper =====

    help: async (rawArgs) => {
      const args = validate(Schemas.help, rawArgs, "help");
      if (args.method) {
        const doc = BPS_API_HELP[args.method];
        if (!doc) {
          return {
            found: false,
            message: `Unknown method "${args.method}". Available methods: ${BPS_API_METHOD_NAMES.join(", ")}`,
          };
        }
        return { found: true, ...doc };
      }
      return {
        totalMethods: BPS_API_METHOD_NAMES.length,
        methods: Object.values(BPS_API_HELP).map((m) => ({
          method: m.method,
          signature: m.signature,
          description: m.description,
        })),
      };
    },
  };
}
