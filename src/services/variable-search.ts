import type { BpsClient } from "../client/bps-client.js";
import type { BpsPeriod } from "../client/types.js";
import type { IPersistentStore } from "./persistent-store.js";
import type { LearnedVar } from "./learning.js";
import { invalidateVar, learnVar, lookupVar, normalizeKeyword } from "./learning.js";
import { logger } from "../utils/logger.js";
import { BpsNotFoundError } from "../utils/error.js";
import { getPeriodLabel, getVariableTitle } from "../client/fields.js";

/** Keyword → BPS subject IDs. Subject IDs are stable across domains. */
const KEYWORD_SUBJECTS: Record<string, number[]> = {
  pengangguran: [6],
  nganggur: [6],
  tenaga: [6],
  kerja: [6],
  tpak: [6],
  angkatan: [6],
  tpt: [6],
  miskin: [23],
  kemiskinan: [23],
  gini: [23],
  ketimpangan: [23],
  kemiskin: [23],
  penduduk: [12],
  kependudukan: [12],
  fertilitas: [12],
  migrasi: [12],
  populasi: [12],
  inflasi: [3],
  harga: [3],
  ihk: [3],
  pdrb: [52],
  ekonomi: [52, 35],
  pertumbuhan: [52],
  ipm: [26],
  pembangunan: [26],
  ekspor: [8],
  impor: [8],
  perdagangan: [8],
  pertanian: [55],
  pangan: [55],
  industri: [9],
  manufaktur: [9],
  kesehatan: [30],
  pendidikan: [28],
  pariwisata: [16],
  agama: [12, 27],
  religi: [12, 27],
  keagamaan: [12, 27],
  pengeluaran: [5],
  konsumsi: [5],
};

/** Synonyms and morphological variants used for matching variable titles. */
const TERM_SYNONYMS: Record<string, string[]> = {
  kemiskinan: ["miskin", "poverty"],
  miskin: ["kemiskinan"],
  pengangguran: ["penganggur", "tpt", "unemployment"],
  tpt: ["pengangguran terbuka", "pengangguran"],
  ipm: ["pembangunan manusia", "indeks pembangunan manusia", "hdi"],
  gini: ["ketimpangan", "gini rasio"],
  penduduk: ["populasi", "kependudukan"],
  inflasi: ["ihk", "indeks harga konsumen"],
  pdrb: ["produk domestik regional bruto", "pertumbuhan ekonomi"],
  ekspor: ["export"],
  impor: ["import"],
  agama: ["religi", "kepercayaan"],
  pendidikan: ["sekolah", "literasi", "melek huruf"],
  kesehatan: ["kesehatan", "harapan hidup", "stunting"],
};

const BREAKDOWN_PATTERN = /\b(kabupaten|kebupaten|kab\/kota|per\s*kab|kecamatan|per\s*kec|desa|kelurahan|kab|kec)\b/i;
const PROVINCE_PATTERN = /\bprovinsi\b/i;

export interface VariableCandidate extends LearnedVar {
  score: number;
  /** BPS definition of the variable, when the API provides one. */
  def?: string;
}

export interface SearchVariablesOptions {
  maxSubjects?: number;
  maxPagesPerSubject?: number;
  maxCandidates?: number;
  /**
   * Year hint. BPS uses it to skip series without data in that year, which
   * keeps multi-year queries from checking periods of unrelated old series.
   * It is a soft filter (unknown years return everything), so callers must
   * still validate the periods they finally use.
   */
  year?: string | number;
}

/**
 * Words that say *which statistic* the caller wants, not just the topic.
 * They are Indonesian stopwords, so `normalizeKeyword` drops them — but
 * "jumlah penduduk miskin" means a headcount and "persentase penduduk miskin"
 * means a rate. Scoring must keep that difference.
 */
export interface MeasureHint {
  amount: boolean;
  rate: boolean;
}

export function detectMeasureHint(query: string): MeasureHint {
  const text = (query ?? "").toLowerCase();
  return {
    amount: /\b(jumlah|total|banyak|orang|jiwa|unit|ton|kg)\b/.test(text),
    rate: /\b(persentase|persen|tingkat|rasio|rate|proporsi)\b|%/.test(text),
  };
}


/** Extract root words and synonyms so "kemiskinan" also matches "miskin". */
export function expandQueryTerms(query: string): string[] {
  const normalized = normalizeKeyword(query);
  const baseWords = normalized.split(/\s+/).filter((word) => word.length > 2);
  const terms = new Set<string>([...baseWords]);

  for (const word of baseWords) {
    if (word.length > 6 && word.startsWith("ke") && word.endsWith("an")) {
      terms.add(word.slice(2, -2));
    }
    if (word.length > 7 && word.startsWith("pe") && word.endsWith("an")) {
      terms.add(word.slice(2, -2));
    }
    if (word.length > 8 && word.startsWith("per") && word.endsWith("an")) {
      terms.add(word.slice(3, -2));
    }
    if (word.length > 5 && word.endsWith("an")) {
      terms.add(word.slice(0, -2));
    }
  }

  for (const [key, synonyms] of Object.entries(TERM_SYNONYMS)) {
    if (normalized.includes(key) || baseWords.includes(key)) {
      for (const synonym of synonyms) terms.add(synonym);
    }
  }

  return [...terms].filter(Boolean);
}

/** Group synonyms/roots so two aliases in one title only count once. */
function groupTerms(terms: string[]): string[][] {
  const groups: string[][] = Object.entries(TERM_SYNONYMS).map(([key, values]) => [
    key,
    ...values,
  ]);
  const result: string[][] = [];

  for (const term of terms) {
    let assigned = false;
    for (const group of groups) {
      if (group.some((member) => member === term || member.includes(term) || term.includes(member))) {
        if (!result.includes(group)) result.push(group);
        assigned = true;
        break;
      }
    }
    if (!assigned) result.push([term]);
  }
  return result;
}

export function getSubjectIdsForKeyword(query: string): number[] {
  const normalized = normalizeKeyword(query);
  const ids: number[] = [];
  for (const [keyword, subIds] of Object.entries(KEYWORD_SUBJECTS)) {
    if (normalized.includes(keyword)) ids.push(...subIds);
  }
  return [...new Set(ids)];
}

/**
 * Score how well a variable title matches a query.
 * Returns 0 when there is no keyword match at all — generic bonuses such as
 * "title contains 'jumlah' or is short" must never make an unrelated variable
 * win (this previously made "pemeluk agama" return a population variable).
 */
export function computeRelevanceScore(
  query: string,
  title: string,
  subName = "",
  definition = ""
): number {
  const kw = normalizeKeyword(query);
  if (!kw) return 0;

  const titleLower = (title ?? "").toLowerCase();
  const subLower = (subName ?? "").toLowerCase();
  const defLower = (definition ?? "").toLowerCase();
  const terms = expandQueryTerms(kw);
  const termGroups = groupTerms(terms);
  const queryWords = kw.split(/\s+/).filter((word) => word.length > 2);
  const measure = detectMeasureHint(query);

  let score = 0;
  let matchedGroups = 0;

  for (const group of termGroups) {
    if (group.some((term) => titleLower.includes(term))) {
      score += 30;
      matchedGroups++;
    } else if (group.some((term) => subLower.includes(term))) {
      score += 8;
      matchedGroups++;
    } else if (group.some((term) => defLower.includes(term))) {
      score += 4;
      matchedGroups++;
    }
  }

  // No keyword match at all → not a candidate.
  if (matchedGroups === 0) return 0;

  if (titleLower.includes(kw)) score += 30;
  if (termGroups.length > 1 && matchedGroups >= termGroups.length) score += 20;
  if (titleLower.startsWith(kw)) score += 15;

  // Prefer primary indicators over long breakdowns.
  if (titleLower.includes("persentase") || titleLower.includes("tingkat")) score += 10;
  if (titleLower.includes("jumlah")) score += 5;
  if (title.length < 60) score += 10;
  if (title.length > 120) score -= 15;
  if (titleLower.includes("metode lama")) score -= 25;
  if (titleLower.includes("metode baru")) score += 5;

  const titleWordCount = titleLower.split(/\s+/).filter(Boolean).length;
  const excessWords = titleWordCount - queryWords.length - 2;
  if (excessWords > 0) score -= Math.min(excessWords * 3, 18);

  const asksBreakdown = BREAKDOWN_PATTERN.test(query) || BREAKDOWN_PATTERN.test(kw);
  const isBreakdownTitle =
    titleLower.includes("kabupaten/kota") ||
    titleLower.includes("kabupaten") ||
    titleLower.includes("kebupaten") ||
    titleLower.includes("kecamatan") ||
    titleLower.includes("desa") ||
    titleLower.includes("kelurahan");
  if (isBreakdownTitle) {
    score += asksBreakdown ? 30 : -25;
  }
  if (PROVINCE_PATTERN.test(titleLower)) {
    score += asksBreakdown ? 5 : 10;
  }

  // Amount vs rate. "jumlah penduduk miskin" must not answer with a percentage
  // just because the rate table has the same topic words.
  if (measure.amount && !measure.rate) {
    if (/jumlah|total|banyak/.test(titleLower)) score += 15;
    if (/persentase|persen|tingkat|rasio/.test(titleLower)) score -= 20;
  } else if (measure.rate && !measure.amount) {
    if (/persentase|persen|tingkat|rasio/.test(titleLower)) score += 10;
    if (/^jumlah|total/.test(titleLower)) score -= 8;
  }

  // If the query does not ask for an index, prefer the main indicator.
  if (titleLower.includes("indeks") && !terms.some((term) => term.includes("indeks"))) {
    score -= 15;
  }

  if (kw.includes("penduduk")) {
    if (titleLower.includes("jumlah penduduk")) score += 25;
    if (titleLower.includes("kepadatan") && !kw.includes("kepadatan")) score -= 30;
    if (titleLower.includes("laju pertumbuhan") && !kw.includes("laju")) score -= 20;
    if (titleLower.includes("rasio") && !kw.includes("rasio")) score -= 15;
    if (titleLower.includes("proyeksi") && !kw.includes("proyeksi")) score -= 5;
  }

  if (kw.includes("ipm") || kw.includes("pembangunan manusia")) {
    if (titleLower.includes("metode lama")) score -= 40;
    if (titleLower.includes("metode baru")) score += 15;
    if (titleLower.includes("komponen") && !kw.includes("komponen")) score -= 20;
    if (titleLower.includes("sp2010")) score -= 20;
    if (titleLower.includes("sp2020")) score += 20;
    if (titleLower.includes("long form")) score += 15;
  }

  if (kw.includes("miskin") || kw.includes("kemiskinan")) {
    if (kw.includes("garis")) {
      if (titleLower.includes("garis kemiskinan")) score += 60;
      if (titleLower.includes("persentase") || titleLower.includes("jumlah penduduk miskin")) score -= 20;
    } else if (measure.amount && !measure.rate) {
      // "jumlah penduduk miskin" asks for a headcount, not a rate.
      if (titleLower.includes("jumlah")) score += 40;
      if (titleLower.includes("persentase")) score -= 40;
      if (titleLower.includes("garis kemiskinan")) score -= 30;
    } else {
      if (titleLower.includes("persentase")) score += 40;
      else if (titleLower.includes("jumlah penduduk miskin")) score += 15;
      if (titleLower.includes("garis kemiskinan")) score -= 30;
    }
    if (
      (titleLower.includes("indeks kedalaman") || titleLower.includes("indeks keparahan")) &&
      !kw.includes("indeks")
    ) {
      score -= 20;
    }
  }

  if (kw.includes("agama") || kw.includes("religi")) {
    if (titleLower.includes("agama")) score += 40;
    if (titleLower.includes("kepercayaan")) score += 10;
  }

  return score;
}

function dedupe(values: number[]): number[] {
  return [...new Set(values)];
}

async function loadSubjects(
  client: BpsClient,
  domain: string
): Promise<Array<{ sub_id: number; title: string }>> {
  const maybeAll = (client as BpsClient & {
    listAllSubjects?: (domain?: string) => Promise<Array<{ sub_id: number; title: string }>>;
  }).listAllSubjects;

  try {
    if (typeof maybeAll === "function") {
      return await maybeAll.call(client, domain);
    }
    const result = await client.listSubjects(domain);
    return result.data ?? [];
  } catch (error) {
    if (error instanceof BpsNotFoundError) return [];
    throw error;
  }
}

/**
 * Search variables across the subjects that are likely relevant to a query.
 * Returns candidates sorted by relevance (best first).
 */
export async function searchVariables(
  client: BpsClient,
  domain: string,
  query: string,
  options: SearchVariablesOptions = {}
): Promise<VariableCandidate[]> {
  const kw = normalizeKeyword(query);
  if (!kw) return [];

  const maxSubjects = options.maxSubjects ?? 6;
  const maxPagesPerSubject = options.maxPagesPerSubject ?? 6;
  const maxCandidates = options.maxCandidates ?? 20;
  const yearHint = Number(options.year);
  const filterYear = Number.isFinite(yearHint) && yearHint > 0 ? yearHint : undefined;

  const mappedSubjectIds = getSubjectIdsForKeyword(kw);
  const terms = expandQueryTerms(kw);
  const candidates: VariableCandidate[] = [];
  const seen = new Set<number>();
  const scannedSubjectIds = new Set<number>();

  const addVariables = (variables: Array<{ var_id: number; title: string; sub_name: string; unit?: string; def?: string }>) => {
    for (const variable of variables) {
      if (seen.has(variable.var_id)) continue;
      // Score against the raw query: measure words ("jumlah", "persentase")
      // are stopwords and would otherwise be normalized away.
      const score = computeRelevanceScore(query, variable.title, variable.sub_name, variable.def);
      if (score <= 0) continue;
      seen.add(variable.var_id);
      candidates.push({
        var_id: variable.var_id,
        title: variable.title ?? "",
        sub_name: variable.sub_name ?? "",
        unit: variable.unit,
        def: variable.def,
        score,
      });
    }
  };

  const searchSubject = async (subjectId: number) => {
    const first = await client.listVariables(domain, subjectId, filterYear, 1, 100);
    addVariables(first.data ?? []);
    const pages = Math.min(first.page?.pages ?? 1, maxPagesPerSubject);
    for (let page = 2; page <= pages; page++) {
      if (candidates.length >= maxCandidates * 2) break;
      const next = await client.listVariables(domain, subjectId, filterYear, page, 100);
      if (!next.data || next.data.length === 0) break;
      addVariables(next.data);
    }
  };

  const searchSubjects = async (subjectIds: number[]) => {
    for (const subjectId of subjectIds) {
      if (scannedSubjectIds.size >= maxSubjects) return;
      if (scannedSubjectIds.has(subjectId)) continue;
      if (candidates.length >= maxCandidates * 2) return;
      scannedSubjectIds.add(subjectId);
      try {
        await searchSubject(subjectId);
      } catch (error) {
        // Some domains expose a subject in the list but return
        // "list-not-available" when its variables are requested. Skip it.
        if (error instanceof BpsNotFoundError) {
          logger.debug(`searchVariables: subject ${subjectId} unavailable in domain ${domain}`);
          continue;
        }
        throw error;
      }
    }
  };

  // Pass 1: the curated keyword → subject map. Subject IDs are stable across
  // domains, so most queries need no subject listing at all.
  await searchSubjects(mappedSubjectIds);

  // Pass 2: page through the domain's subject index only when the curated map
  // found (almost) nothing. Listing subjects costs 4-6 requests per domain and
  // is the same for every query, so paying it up front on each cold start is
  // the main reason find_variable/find_data used to take ten-plus requests.
  if (candidates.length < 3) {
    const subjects = await loadSubjects(client, domain);
    const matchedSubjectIds = subjects
      .filter((subject) => {
        const title = (subject.title ?? "").toLowerCase();
        return terms.some((term) => term.length > 2 && title.includes(term));
      })
      .map((subject) => subject.sub_id)
      .filter((subjectId) => !mappedSubjectIds.includes(subjectId));
    await searchSubjects(dedupe(matchedSubjectIds));
  }

  // Fallback: scan all variables when subject mapping found nothing.
  // Never mix national variable IDs into a provincial domain: BPS IDs are
  // domain-specific, and the same ID can point to an unrelated table in another
  // domain (e.g. national var 413 = IPM, but domain 3500 var 413 = perikanan).
  if (candidates.length === 0) {
    for (let page = 1; page <= 2; page++) {
      try {
        const result = await client.listVariables(domain, undefined, filterYear, page, 100);
        if (!result.data || result.data.length === 0) break;
        addVariables(result.data);
        if (candidates.length >= 5) break;
      } catch (error) {
        if (error instanceof BpsNotFoundError) break;
        throw error;
      }
    }
  }

  candidates.sort(
    (a, b) => b.score - a.score || (a.title?.length ?? 0) - (b.title?.length ?? 0) || a.var_id - b.var_id
  );
  logger.debug(
    `searchVariables: "${kw}" domain=${domain} → ${candidates.length} candidates` +
      (candidates[0] ? `, best=${candidates[0].var_id} (${candidates[0].title}, score=${candidates[0].score})` : "")
  );
  return candidates.slice(0, maxCandidates);
}

/**
 * Resolve the best variable for a query: learned mapping → full search.
 * Saves a successful mapping for future calls.
 */
export async function resolveVariable(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  domain: string
): Promise<LearnedVar | null> {
  const learned = await lookupVar(query, domain, store);
  if (learned) return learned;

  const candidates = await searchVariables(client, domain, query);
  const best = candidates[0];
  if (!best) return null;

  await learnVar(query, domain, best, store);
  return {
    var_id: best.var_id,
    title: best.title,
    sub_name: best.sub_name,
    unit: best.unit,
  };
}

export interface ResolvedVariableWithPeriods {
  varData: LearnedVar;
  periods: BpsPeriod[];
  matchedYears: string[];
  candidates: VariableCandidate[];
  /** True when served straight from the learned store (no search ran). */
  learnedHit?: boolean;
}

export interface ResolveYearsOptions {
  /** Do not trust a learned mapping (e.g. a breakdown query). */
  skipLearned?: boolean;
  maxCandidates?: number;
}

async function listAllPeriodsSafe(
  client: BpsClient,
  domain: string,
  varId: number
): Promise<BpsPeriod[]> {
  const maybeAll = (client as BpsClient & {
    listAllPeriods?: (domain?: string, varId?: number) => Promise<BpsPeriod[]>;
  }).listAllPeriods;
  if (typeof maybeAll === "function") {
    return maybeAll.call(client, domain, varId);
  }
  return client.listPeriods(domain, varId);
}

/**
 * Resolve a variable and require that it has periods for the requested years.
 * BPS often keeps an old series (e.g. IPM 2014–2019) next to a current one;
 * without this check a 2023 query silently returns 2019 data.
 *
 * Order matters for speed: a learned (or curated national) mapping is validated
 * with ONE period listing and returned immediately. Only when it does not cover
 * the requested years does the expensive subject/variable sweep run. Repeat
 * questions therefore cost 1-3 requests instead of 15-30.
 */
export async function resolveVariableForYears(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  domain: string,
  years: string[],
  options: ResolveYearsOptions = {}
): Promise<ResolvedVariableWithPeriods | null> {
  const normalizedYears = years.map((year) => year.trim()).filter(Boolean);
  const wantsYears = normalizedYears.length > 0;

  const learned = options.skipLearned ? null : await lookupVar(query, domain, store);
  if (learned) {
    let periods: BpsPeriod[] | null = null;
    try {
      periods = await listAllPeriodsSafe(client, domain, learned.var_id);
    } catch (error) {
      if (!(error instanceof BpsNotFoundError)) throw error;
    }
    if (periods && periods.length > 0) {
      const labels = periods.map((period) => getPeriodLabel(period));
      const matchedYears = normalizedYears.filter((year) =>
        labels.some((label) => label.includes(year))
      );
      if (!wantsYears || matchedYears.length === normalizedYears.length) {
        logger.debug(
          `resolveVariableForYears: learned fast path "${query}" domain=${domain} → ` +
          `var_id=${learned.var_id} (${getVariableTitle(learned)}), matched=${matchedYears.join(",") || "latest"}`
        );
        return { varData: learned, periods, matchedYears, candidates: [], learnedHit: true };
      }

      // One missing year is common ("5 tahun terakhir" where the newest release
      // lags) and must not trigger a 20-request search: the caller already
      // reports which years are missing. A learned series that covers almost
      // nothing is stale and falls through to the search below.
      const missingYears = normalizedYears.filter((year) => !matchedYears.includes(year));
      if (missingYears.length === 1 && matchedYears.length >= 2) {
        logger.debug(
          `resolveVariableForYears: learned fast path (partial) "${query}" domain=${domain} → ` +
          `var_id=${learned.var_id}, missing=${missingYears.join(",")}`
        );
        return { varData: learned, periods, matchedYears, candidates: [], learnedHit: true };
      }
    }
  }

  if (!wantsYears) {
    const searched = await searchVariables(client, domain, query, {
      maxCandidates: options.maxCandidates ?? 20,
    });
    const varData = searched[0] ?? null;
    if (!varData) return null;
    const periods = await listAllPeriodsSafe(client, domain, varData.var_id);
    return { varData, periods, matchedYears: [], candidates: searched };
  }

  const candidates: Array<LearnedVar & { score?: number }> = [];
  const seen = new Set<number>();

  const searched = await searchVariables(client, domain, query, {
    maxCandidates: options.maxCandidates ?? 20,
    // Newest year: series that stop before it are dropped by BPS itself.
    year: normalizedYears[normalizedYears.length - 1],
  });
  for (const candidate of searched) {
    if (seen.has(candidate.var_id)) continue;
    seen.add(candidate.var_id);
    candidates.push(candidate);
  }

  // A partially matching learned mapping is still a valid candidate; national
  // KNOWN_VARS are curated and stable, so they go first.
  if (learned && !seen.has(learned.var_id)) {
    if (domain === "0000") {
      candidates.unshift(learned);
    } else {
      candidates.push(learned);
    }
    seen.add(learned.var_id);
  }

  let best: { varData: LearnedVar; periods: BpsPeriod[]; matchedYears: string[] } | null = null;
  let bestMatchCount = -1;

  // BPS rate-limits bursts (HTTP 429), so period lists are checked one at a
  // time. The learned fast path above means this only runs for first-time
  // queries; the year hint above keeps the candidate list short.
  for (const candidate of candidates.slice(0, 6)) {
    let periods: BpsPeriod[];
    try {
      periods = await listAllPeriodsSafe(client, domain, candidate.var_id);
    } catch (error) {
      if (error instanceof BpsNotFoundError) continue;
      throw error;
    }
    const labels = periods.map((period) => getPeriodLabel(period));
    const matchedYears = normalizedYears.filter((year) =>
      labels.some((label) => label.includes(year))
    );

    if (matchedYears.length > bestMatchCount) {
      bestMatchCount = matchedYears.length;
      best = { varData: candidate, periods, matchedYears };
    }
    if (matchedYears.length === normalizedYears.length) break;
  }

  if (!best) return null;

  // If a stale learned mapping lost to a better candidate, remove it.
  if (learned && learned.var_id !== best.varData.var_id) {
    await invalidateVar(query, domain, store);
  }

  await learnVar(query, domain, best.varData, store);
  logger.debug(
    `resolveVariableForYears: "${query}" domain=${domain} years=${normalizedYears.join(",")} → ` +
    `var_id=${best.varData.var_id} (${getVariableTitle(best.varData)}), matched=${best.matchedYears.join(",") || "none"}`
  );
  return { ...best, candidates: searched };
}

