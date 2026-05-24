/**
 * Intent detection for BPS queries.
 * Detects user intent from natural language and suggests the best tool + params.
 */

export type BpsIntent =
  | "single_value"
  | "comparison"
  | "trend"
  | "ranking"
  | "table"
  | "publication"
  | "unknown";

export interface IntentResult {
  intent: BpsIntent;
  confidence: number;
  suggestedTool: string;
  extractedParams: Record<string, string>;
  hints: string[];
}

// --- Intent patterns ---

const COMPARISON_PATTERNS = [
  /\b(bandingkan|banding|vs|versus|dibandingkan|dibanding|membandingkan)\b/i,
  /\b(antara)\s+(.+?)\s+(dan|dengan)\s+(.+?)(?:\s|$)/i,
  /\b(manakah?\s+(yang|lebih))\b/i,
  /\b(lebih\s+(tinggi|rendah|besar|kecil|baik|buruk))\b/i,
  /\b(perbedaan|selisih|beda)\b/i,
  /\b(dan)\b.*\b(dan)\b/i, // "X dan Y" pattern (2+ regions)
];

const TREND_PATTERNS = [
  /\b(tren|trend|perkembangan|perubahan|fluktuasi|naik\s*turun)\b/i,
  /\b(dari)\s+(\d{4})\s+(sampai|hingga|ke|s\/d)\s+(\d{4})/i,
  /\b(\d{4})\s*[-–—]\s*(\d{4})/i,
  /\b(sepanjang)\s+(tahun|periode|waktu)\b/i,
  /\b(historis|historical|time\s*series|time-series)\b/i,
  /\b(dalam\s+\d+)\s+(tahun|bulan|triwulan|kuartal)\b/i,
];

const RANKING_PATTERNS = [
  /\b(peringkat|ranking|rank|urutan|posisi)\b/i,
  /\b(top|teratas|terbaik|terburuk|tertinggi|terendah|termiskin|terkaya|terbesar|terkecil)\b/i,
  /\b(10\s+(provinsi|kabupaten|kota|daerah|wilayah))\b/i,
  /\b(urutkan|sorting|sort)\b/i,
  /\b(paling|paling\s+(banyak|sedikit|tinggi|rendah))\b/i,
];

const TABLE_PATTERNS = [
  /\b(tabel|table|data\s+tabular)\b/i,
  /\b(pemeluk\s+agama|menurut\s+agama|distribusi\s+penduduk)\b/i,
  /\b(per\s+(kecamatan|kabupaten|kota|provinsi|wilayah))\b/i,
  /\b(breakdown|rincian|detail)\b/i,
  /\b(distribusi|sebaran|penyebaran)\b/i,
];

const PUBLICATION_PATTERNS = [
  /\b(publikasi|publication|laporan|report|brosur|booklet)\b/i,
  /\b(brs|berita\s+resmi|press\s+release|siaran\s+pers)\b/i,
  /\b(pdf|dokumen|file)\b/i,
  /\b(cari\s+(teks|kata|kalimat)\s+(di\s+dalam|dalam))\b/i,
];

/**
 * Detect intent from a user query.
 */
export function detectIntent(
  query: string,
  region: string,
  year?: string
): IntentResult {
  const hints: string[] = [];
  const extractedParams: Record<string, string> = {};

  // Extract year range from query if not provided
  if (!year) {
    const yearRange = query.match(/(\d{4})\s*[-–—]\s*(\d{4})/);
    if (yearRange) {
      extractedParams.year = `${yearRange[1]},${yearRange[2]}`;
    }
  }

  // Extract regions for comparison
  const comparisonMatch = query.match(/(antara)\s+(.+?)\s+(dan|dengan)\s+(.+?)(?:\s+(pada|tahun|di)|$)/i);
  if (comparisonMatch) {
    extractedParams.region1 = comparisonMatch[2].trim();
    extractedParams.region2 = comparisonMatch[4].trim();
  }

  // Score each intent
  const scores: Record<BpsIntent, number> = {
    single_value: 10, // default
    comparison: 0,
    trend: 0,
    ranking: 0,
    table: 0,
    publication: 0,
    unknown: 0,
  };

  for (const pattern of COMPARISON_PATTERNS) {
    if (pattern.test(query)) scores.comparison += 30;
  }
  for (const pattern of TREND_PATTERNS) {
    if (pattern.test(query)) scores.trend += 30;
  }
  for (const pattern of RANKING_PATTERNS) {
    if (pattern.test(query)) scores.ranking += 30;
  }
  for (const pattern of TABLE_PATTERNS) {
    if (pattern.test(query)) scores.table += 30;
  }
  for (const pattern of PUBLICATION_PATTERNS) {
    if (pattern.test(query)) scores.publication += 30;
  }

  // Bonus for multiple regions in query
  const regionCount = (query.match(/(dan|,|versus|vs)/g) || []).length;
  if (regionCount >= 2) scores.comparison += 20;

  // Bonus for year range
  if (year && year.includes(",")) scores.trend += 20;

  // Determine best intent
  let bestIntent: BpsIntent = "single_value";
  let bestScore = scores.single_value;

  for (const [intent, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as BpsIntent;
    }
  }

  // Calculate confidence (0-1)
  const confidence = Math.min(bestScore / 50, 1);

  // Map intent to suggested tool
  const toolMap: Record<BpsIntent, string> = {
    single_value: "find_data",
    comparison: "compare_data",
    trend: "get_trend",
    ranking: "get_ranking",
    table: "find_data", // find_data has static table fallback
    publication: "search",
    unknown: "find_data",
  };

  // Generate hints
  if (bestIntent === "table") {
    hints.push("💡 Query ini meminta data tabel/breakdown. find_data akan otomatis fallback ke static table jika dynamic data tidak tersedia.");
  }
  if (bestIntent === "comparison") {
    hints.push("💡 Query ini meminta perbandingan. Gunakan compare_data untuk hasil yang lebih baik.");
  }
  if (bestIntent === "trend") {
    hints.push("💡 Query ini meminta tren/time-series. Gunakan get_trend untuk data multi-tahun.");
  }
  if (bestIntent === "ranking") {
    hints.push("💡 Query ini meminta ranking. Gunakan get_ranking untuk hasil yang lebih baik.");
  }

  return {
    intent: bestIntent,
    confidence,
    suggestedTool: toolMap[bestIntent],
    extractedParams,
    hints,
  };
}

/**
 * Generate result hints based on the query and result type.
 */
export function generateResultHints(
  query: string,
  domain: string,
  domainName: string,
  _varId?: number,
  _varTitle?: string
): string[] {
  const hints: string[] = [];
  const kw = query.toLowerCase();

  // If result is for a kabupaten/kota, suggest province-level data
  if (domain.length === 4 && !domain.endsWith("00")) {
    const provDomain = domain.slice(0, 2) + "00";
    hints.push(`💡 Data provinsi: find_data(query="${query}", region="provinsi") [domain: ${provDomain}]`);
  }

  // If query is about religion, suggest static table
  if (kw.includes("agama") || kw.includes("religi")) {
    hints.push(`💡 Breakdown detail: list_static_tables(domain="${domain}", keyword="agama")`);
  }

  // If query is about poverty, suggest related indicators
  if (kw.includes("miskin") || kw.includes("kemiskinan")) {
    hints.push(`💡 Gini rasio: get_dynamic_data(domain="${domain}", var="98")`);
    hints.push(`💡 Garis kemiskinan: find_variable(keyword="garis kemiskinan", domain="${domain}")`);
  }

  // If query is about unemployment, suggest related indicators
  if (kw.includes("pengangguran") || kw.includes("nganggur")) {
    hints.push(`💡 TPak: find_variable(keyword="tpak", domain="${domain}")`);
    hints.push(`💡 Angkatan kerja: find_variable(keyword="angkatan kerja", domain="${domain}")`);
  }

  // If query is about IPM, suggest related indicators
  if (kw.includes("ipm") || kw.includes("pembangunan manusia")) {
    hints.push(`💡 Data historis: get_trend(query="ipm", region="${domainName}")`);
  }

  return hints;
}
