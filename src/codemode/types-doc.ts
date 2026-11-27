/**
 * Code Mode instructions and compact TypeScript declarations for `execute_bps_code`.
 * Cuts schema overhead by ~80-85% compared to exposing all 39 individual MCP tools.
 */

export const CODE_MODE_SERVER_INSTRUCTIONS = `Server ini menyediakan data BPS (WebAPI + AllStats) melalui **Code Mode** (\`execute_bps_code\`).
Tulis skrip JavaScript asinkron terhadap objek global \`bps\` alih-alih memanggil tool satu per satu.

ATURAN ROUTING (penting, hemat panggilan):
1. Peringkat/top-N wilayah ("10 kabupaten/kota ... tertinggi", "5 provinsi termiskin")
   -> \`await bps.getRanking({ query, level: "kabkota" | "provinsi", top_n, order })\`.
   JANGAN menyapu 38 provinsi manual dengan \`listVariables\`/\`getDynamicData\` per provinsi.
2. Angka satu wilayah -> \`await bps.findData({ query, region, year })\`; tren satu wilayah -> \`await bps.getTrend({ query, region, years })\`.
3. Bandingkan 2+ wilayah (termasuk multi-tahun "2021-2025") -> \`await bps.compareData({ query, regions, years })\`.
4. Sudah tahu \`var_id\` -> \`await bps.getDynamicData({ domain, var, th })\` (\`th\` menerima tahun langsung, mis. "2021-2025").
5. Pencarian lintas tipe -> \`await bps.search({ keyword, type: "all" })\`; PDF full-text -> \`await bps.allstatsDeepSearch(...)\`.
6. Ekspor/impor -> \`await bps.getTradeData({ commodity: "kopi", source: "ekspor", year: "2024" })\`.
7. Definisi istilah/indikator -> \`await bps.listGlossary({ keyword })\`.
8. Manfaatkan \`Promise.all([...])\` untuk query independen dan olah/filter hasilnya di dalam skrip; kembalikan hanya ringkasan akhir.

CATATAN DATA: periode antar provinsi tidak seragam (2024-2026). Selalu sebutkan tahun data saat menyajikan angka, dan jangan menyebut data lama sebagai "terkini".`;

export const BPS_TYPE_DECLARATIONS = `declare const bps: {
  // Smart & Analysis (5)
  findData(args: { query: string; region?: string; year?: string; bypassRedirect?: boolean }): Promise<{ source: string; domain: string; domainName: string; varId?: number; varTitle?: string; unit?: string; periods?: string[]; matchedYears?: string[]; missingYears?: string[]; rows: Array<{ indicator: string; category?: string; series?: string; period: string; subperiod?: string; value: number | string; unit?: string }>; indicator?: unknown; staticTable?: { table_id: number; title: string; domain: string; markdownTable: string; headers?: string[]; rows?: string[][] }; alternatives?: Array<{ var_id: number; title: string; unit?: string }>; hints?: string[] }>;
  findVariable(args: { keyword: string; domain?: string; subject?: number }): Promise<{ domain: string; keyword: string; count: number; variables: Array<{ var_id: number; title: string; sub_name: string; unit?: string; def?: string }> }>;
  compareData(args: { query: string; regions: string | string[]; year?: string; years?: string; start_year?: string; end_year?: string }): Promise<{ varTitle: string; displayTitle: string; unit?: string; multiYear: boolean; usedNationalTable: boolean; hasData: boolean; series: Array<{ region: string; domain: string; domainName: string; varId: number | null; varTitle: string; unit?: string; points: Array<{ year: string; label: string; value: number }>; missingYears: string[]; notes: string[] }>; summary?: unknown; notes: string[] }>;
  getTrend(args: { query: string; region?: string; start_year?: string; end_year?: string; years?: string }): Promise<{ varId: number | null; varTitle: string; unit?: string; domain: string; domainName: string; seriesLabel?: string; missingYears: string[]; points: Array<{ year: string; label: string; value: number; changePct: number | null }>; totalChangePct?: number | null; direction?: "naik" | "turun" | "stabil"; headlineFallback?: unknown }>;
  getRanking(args: { query: string; level: "provinsi" | "kabkota"; top_n?: number; order?: "highest" | "lowest"; year?: string; period_mode?: "common" | "latest"; provinces?: string | string[] }): Promise<{ level: "provinsi" | "kabkota"; indicator: string; unit?: string; order: "highest" | "lowest"; targetYear?: string; periods: string[]; totalRegions: number; provincesCovered?: number; missingProvinces?: Array<{ province: string; reason: string }>; rows: Array<Record<string, unknown>> }>;

  // Domain (2)
  listDomains(args?: { type?: "all" | "prov" | "kab" | "kabbyprov"; prov?: string }): Promise<{ count: number; domains: Array<{ domain_id: string; domain_name: string; domain_url: string }> }>;
  resolveDomain(args: { query: string }): Promise<{ found: boolean; domainId?: string; domainName?: string }>;

  // Dynamic Data & Metadata (9)
  listSubjects(args?: { domain?: string; subcat?: number }): Promise<Array<{ sub_id: number; title: string; ntabel?: number | null; nvar?: number | null }>>;
  listSubjectCategories(args?: { domain?: string }): Promise<Array<{ subcat_id: number; title: string }>>;
  listVariables(args?: { domain?: string; subject?: number; year?: number; page?: number }): Promise<{ page?: unknown; data: Array<{ var_id: number; title: string; sub_id: number; sub_name: string; unit?: string; def?: string }> }>;
  listVerticalVariables(args?: { domain?: string; var?: number }): Promise<Array<Record<string, unknown>>>;
  listDerivedVariables(args?: { domain?: string; var?: number }): Promise<Array<Record<string, unknown>>>;
  listPeriods(args?: { domain?: string; var?: number; page?: number }): Promise<Array<Record<string, unknown>>>;
  listDerivedPeriods(args?: { domain?: string; var?: number }): Promise<Array<Record<string, unknown>>>;
  listUnits(args?: { domain?: string; page?: number }): Promise<Array<{ unit_id: number; unit: string }>>;
  getDynamicData(args: { domain?: string; var: string | number; th?: string; turvar?: string; vervar?: string; turth?: string; raw?: boolean }): Promise<{ indicator?: string; domain: string; varId: string; unit?: string; units: string[]; period: string | null; periods: Array<{ id: string; label: string }>; missingYears?: string[]; rows: Array<{ indicator: string; category?: string; series?: string; period: string; subperiod?: string; value: number | string; unit?: string }>; note?: string }>;

  // Search & AllStats (3)
  search(args: { keyword: string; domain?: string; type?: "all" | "statictable" | "publication" | "pressrelease" | "strategicindicator"; page?: number }): Promise<{ source: string; effectiveQuery: string; type: string; groups?: Record<string, unknown[]>; results?: unknown[]; page?: unknown; total?: number }>;
  allstatsSearch(args: { query: string; content?: "all" | "publication" | "table" | "pressrelease" | "infographic" | "microdata" | "news" | "glosarium" | "kbli2020" | "kbli2017" | "kbli2015" | "kbli2009"; domain?: string; page?: number; title_only?: boolean; year_from?: string; year_to?: string; sort?: "terbaru" | "relevansi" }): Promise<{ query: string; originalQuery: string; effectiveQuery: string; totalResults: number; currentPage: number; totalPages: number; results: Array<{ url: string; title: string; description: string; contentType: string; domain: string; deepSearchId?: string }> }>;
  allstatsDeepSearch(args: { query: string; publication_id: string; domain?: string; page?: number }): Promise<{ query: string; publication: Record<string, string>; totalMatches: number; matches: Array<{ pageNumber: number; excerpt: string; highlights: string[]; pdfViewerUrl: string }>; notice?: string }>;

  // Static Tables, Publications, Press Releases, Indicators, Trade & Glossary (9)
  listStaticTables(args?: { domain?: string; keyword?: string; year?: number; month?: number; page?: number }): Promise<{ page?: unknown; data: Array<{ table_id: number; title: string; subj?: string; updt_date: string | null }> }>;
  getStaticTable(args: { domain: string; id: number }): Promise<{ table_id: number; title: string; subj?: string; updt_date: string | null; excel?: string; markdownTable: string; headers?: string[]; rows?: string[][] }>;
  listPublications(args?: { domain?: string; keyword?: string; year?: number; month?: number; page?: number }): Promise<{ page?: unknown; data: Array<{ pub_id: string; title: string; rl_date: string; issn?: string }> }>;
  getPublication(args: { domain: string; id: string }): Promise<{ pub_id: string; title: string; rl_date: string; issn?: string; abstract?: string; pdf?: string }>;
  listPressReleases(args?: { domain?: string; keyword?: string; year?: number; month?: number; page?: number }): Promise<{ page?: unknown; data: Array<{ brs_id: number; title: string; rl_date: string }> }>;
  getPressRelease(args: { domain: string; id: number }): Promise<{ brs_id: number; title: string; rl_date: string; abstract?: string; pdf?: string }>;
  listStrategicIndicators(args?: { domain?: string; var?: number; page?: number }): Promise<{ page?: unknown; data: Array<{ indicator_id: number; title: string; value: number | string; unit: string | null; periode: string; name?: string }> }>;
  getTradeData(args: { source?: "1" | "2" | "ekspor" | "impor"; hs_code?: string; commodity?: string; hs_type?: "1" | "2"; year?: string; period?: "1" | "2" | "bulanan" | "tahunan" }): Promise<{ source: "ekspor" | "impor"; hsCode: string; requestedCode: string; commodityLabel?: string; note?: string; year: string; period: "1" | "2"; totalValue: number; totalWeight: number; rowCount: number; byCountry: Array<{ country: string; value: number; weight: number; rows: number }> }>;
  listGlossary(args?: { domain?: string; keyword?: string; page?: number }): Promise<{ source: "glossary" | "variables" | "documents" | "unavailable"; items: unknown[] }>;

  // Infographics, News, Census, CSA & Utility (11)
  listInfographics(args?: { domain?: string; keyword?: string; page?: number }): Promise<{ page?: unknown; data: unknown[] }>;
  getInfographic(args: { domain: string; id: number }): Promise<Record<string, unknown>>;
  listNews(args?: { domain?: string; keyword?: string; page?: number }): Promise<{ page?: unknown; data: unknown[] }>;
  getNews(args: { domain: string; id: number }): Promise<Record<string, unknown>>;
  listCensusEvents(): Promise<Array<{ id: string; kegiatan: string; tahun_kegiatan: number }>>;
  listCensusTopics(args: { kegiatan: string }): Promise<Array<{ id: number; topik: string; topic: string }>>;
  listCsaCategories(args?: { domain?: string }): Promise<Array<{ subcat_id: number; title: string }>>;
  listCsaSubjects(args?: { domain?: string; subcat?: number; page?: number }): Promise<{ page?: unknown; data: unknown[] }>;
  listCsaTables(args?: { domain?: string; subject?: number; page?: number }): Promise<{ page?: unknown; data: unknown[] }>;
  getCsaTable(args: { domain: string; id: string }): Promise<Record<string, unknown>>;
  clearCache(): Promise<{ cleared: boolean; message: string }>;

  // Helper
  help(methodName?: string | { method?: string }): Promise<unknown>;
};`;

export const EXECUTE_BPS_CODE_DESCRIPTION = `Eksekusi skrip JavaScript asinkron (ES2022+) di dalam sandbox terisolasi terhadap seluruh 39 API data BPS (\`bps.*\`).

## Aturan Penulisan Skrip
- Gunakan \`await bps.<method>({ ... })\` — dapat berupa top-level statements (\`const d = await bps.findData(...); return d;\`) atau \`async () => { ... }\`.
- Manfaatkan \`Promise.all([...])\` untuk memanggil beberapa indikator/wilayah secara paralel.
- Filter, agregasi, dan ringkas data di dalam skrip; \`return\` hanya hasil akhir yang ringkas (maks 50 KB).
- Tidak ada \`fetch\`, \`fs\`, \`process\`, atau \`setTimeout\` di sandbox; gunakan hanya \`bps.*\` dan \`console.log\`.
- Panggil \`await bps.help("namaMethod")\` untuk detail & contoh method tertentu.

## Quick Reference \`var_id\` Nasional (\`domain: "0000"\`)
- \`185\`: Jumlah Penduduk Miskin menurut Provinsi (Ribu Jiwa)
- \`192\`: Persentase Penduduk Miskin (P0) menurut Provinsi (%)
- \`543\`: Tingkat Pengangguran Terbuka (TPT) menurut Provinsi (%)
- \`413\`: [Metode Baru] Indeks Pembangunan Manusia (IPM)
- \`2781\`: Jumlah Penduduk menurut Provinsi dan Jenis Kelamin
- \`98\`: Gini Ratio menurut Provinsi dan Daerah
- \`2263\`: Inflasi Tahunan (Y-on-Y) 38 Provinsi

## Deklarasi API
\`\`\`ts
${BPS_TYPE_DECLARATIONS}
\`\`\``;
