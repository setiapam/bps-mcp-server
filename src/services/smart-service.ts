import type { BpsClient } from "../client/bps-client.js";
import type {
  BpsDynamicDataResponse,
  BpsStaticTable,
  BpsStrategicIndicator,
} from "../client/types.js";
import type { DomainResolver } from "./domain-resolver.js";
import type { IPersistentStore } from "./persistent-store.js";
import { buildStructuredPayload, type StructuredRow } from "./data-formatter.js";
import { hasRegionRow } from "./region-series.js";
import { resolvePeriodsForSpec } from "./period-resolver.js";
import {
  lookupVar,
  learnVar,
  invalidateVar,
  learnPeriod,
  invalidatePeriod,
  normalizeKeyword,
} from "./learning.js";
import { detectIntent, generateResultHints, type BpsIntent } from "./intent-detector.js";
import {
  computeRelevanceScore,
  expandQueryTerms,
  resolveVariableForYears,
  searchVariables,
} from "./variable-search.js";
import { filterRelevantVervar } from "./dynamic-data-utils.js";
import { formatUnit, getPeriodId, getPeriodLabel } from "../client/fields.js";
import { htmlTableToMarkdown, parseHtmlTable } from "../utils/html.js";
import { logger } from "../utils/logger.js";

export interface FindVariableItem {
  var_id: number;
  title: string;
  sub_name: string;
  unit?: string;
  def?: string;
}

export interface FindVariableInput {
  keyword: string;
  domain?: string;
  subject?: number;
}

export interface FindVariableResult {
  domain: string;
  keyword: string;
  count: number;
  variables: FindVariableItem[];
}

export async function findVariableService(
  client: BpsClient,
  input: FindVariableInput
): Promise<FindVariableResult> {
  const domain = input.domain || "0000";
  const keyword = input.keyword;
  const allVars: FindVariableItem[] = [];

  if (input.subject) {
    await searchVariablesInSubject(client, domain, input.subject, keyword, allVars);
  } else {
    const candidates = await searchVariables(client, domain, keyword, {
      maxSubjects: 8,
      maxPagesPerSubject: 6,
      maxCandidates: 20,
    });
    for (const candidate of candidates) {
      if (allVars.some((item) => item.var_id === candidate.var_id)) continue;
      allVars.push({
        var_id: candidate.var_id,
        title: candidate.title,
        sub_name: candidate.sub_name,
        unit: candidate.unit,
        def: candidate.def,
      });
    }
  }

  return {
    domain,
    keyword,
    count: allVars.length,
    variables: allVars,
  };
}

export interface FindDataInput {
  query: string;
  region?: string;
  year?: string;
  bypassRedirect?: boolean;
}

export interface DetectedIntentSummary {
  intent: BpsIntent;
  confidence: number;
  suggestedTool: string;
  extractedParams: Record<string, string>;
}

export interface StaticTableMatch {
  table_id: number;
  title: string;
  subj?: string;
  domain: string;
  updt_date?: string | null;
  excel?: string;
  markdownTable: string;
  headers?: string[];
  rows?: string[][];
}

export interface FindDataResult {
  source:
    | "redirect"
    | "domain_not_found"
    | "strategic_indicator"
    | "dynamic_data"
    | "parent_dynamic_data"
    | "static_table"
    | "not_found";
  query: string;
  region: string;
  domain: string;
  domainName: string;
  year?: string;
  varId?: number;
  varTitle?: string;
  unit?: string;
  periods?: string[];
  matchedYears?: string[];
  missingYears?: string[];
  filteredAggregate?: boolean;
  rows: StructuredRow[];
  rawResponse?: BpsDynamicDataResponse;
  parentDomain?: string;
  indicator?: BpsStrategicIndicator;
  headlineNote?: boolean;
  staticTable?: StaticTableMatch;
  alternatives?: Array<{ var_id: number; title: string; unit?: string }>;
  detectedIntent?: DetectedIntentSummary;
  hints?: string[];
}

export async function findDataService(
  client: BpsClient,
  resolver: DomainResolver,
  store: IPersistentStore | null,
  input: FindDataInput
): Promise<FindDataResult> {
  const query = input.query;
  const region = input.region || "Indonesia";
  const year = input.year;
  const bypassRedirect = input.bypassRedirect ?? false;

  // Step 0: Detect intent
  const intent = detectIntent(query, region, year);
  logger.debug(
    `find_data: detected intent="${intent.intent}" confidence=${intent.confidence.toFixed(2)} tool="${intent.suggestedTool}"`
  );
  const detectedIntent: DetectedIntentSummary = {
    intent: intent.intent,
    confidence: intent.confidence,
    suggestedTool: intent.suggestedTool,
    extractedParams: intent.extractedParams,
  };

  // Prompt Redirection for specialized intents
  const compareRegion1 = intent.extractedParams.region1;
  const compareRegion2 = intent.extractedParams.region2;
  const canRedirect =
    intent.intent !== "comparison" || (!!compareRegion1 && !!compareRegion2);
  if (
    !bypassRedirect &&
    canRedirect &&
    intent.intent !== "single_value" &&
    intent.intent !== "table" &&
    intent.intent !== "unknown" &&
    intent.confidence >= 0.6
  ) {
    return {
      source: "redirect",
      query,
      region,
      domain: "0000",
      domainName: region,
      year,
      rows: [],
      detectedIntent,
    };
  }

  // Step 1: Resolve domain
  let domain = "0000";
  let domainName = "Indonesia";

  if (region.toLowerCase() !== "indonesia" && region !== "0000") {
    const resolved = await resolver.resolve(region);
    if (resolved) {
      domain = resolved.domainId;
      domainName = resolved.domainName;
    } else {
      return {
        source: "domain_not_found",
        query,
        region,
        domain: "",
        domainName: region,
        year,
        rows: [],
        detectedIntent,
      };
    }
  }

  // Headline topics without a year are best answered by strategic indicators
  const kw = normalizeKeyword(query);
  if (!year && isHeadlineQuery(kw)) {
    const headline = await tryStrategicIndicatorsService(client, kw, domain, undefined);
    if (headline) {
      const unit = formatUnit(headline.unit) || undefined;
      return {
        source: "strategic_indicator",
        query,
        region,
        domain,
        domainName,
        year,
        varTitle: headline.title,
        unit,
        periods: [headline.periode],
        rows: [
          {
            indicator: headline.title,
            period: headline.periode,
            value: headline.value,
            unit,
          },
        ],
        indicator: headline,
        headlineNote: true,
        detectedIntent,
      };
    }
  }

  // Step 2: Find variable via learned mapping → relevance search.
  const asksBreakdown =
    /\b(kabupaten|kebupaten|kab[/\s]kota|kecamatan|per\s*kab|per\s*kec|desa|kelurahan)\b/.test(
      query.toLowerCase()
    );
  const yearList = year
    ? year
        .split(/[,;]/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const learned = asksBreakdown ? null : await lookupVar(query, domain, store);
  const resolved = await resolveVariableForYears(client, store, query, domain, yearList, {
    skipLearned: asksBreakdown,
    maxCandidates: 20,
  });
  let bestVar = resolved?.varData ?? null;
  let resolvedPeriods = resolved?.periods ?? [];
  const candidates = resolved?.candidates ?? [];
  const fromLearning = !!learned && !!bestVar && learned.var_id === bestVar.var_id;
  const matchedYears = resolved?.matchedYears ?? [];
  const missingYears = yearList.filter((value) => !matchedYears.includes(value));

  if (yearList.length > 0 && matchedYears.length === 0) {
    bestVar = null;
    resolvedPeriods = [];
  }

  if (!bestVar) {
    // Fallback: try strategic indicators
    const indResult = await tryStrategicIndicatorsService(client, kw, domain, year);
    if (indResult) {
      const unit = formatUnit(indResult.unit) || undefined;
      return {
        source: "strategic_indicator",
        query,
        region,
        domain,
        domainName,
        year,
        varTitle: indResult.title,
        unit,
        periods: [indResult.periode],
        rows: [
          {
            indicator: indResult.title,
            period: indResult.periode,
            value: indResult.value,
            unit,
          },
        ],
        indicator: indResult,
        headlineNote: false,
        detectedIntent,
      };
    }

    // Fallback: try static tables with keyword strategies
    try {
      const staticMatch = await staticTableFallbackService(client, domain, domainName, kw, query);
      if (staticMatch) {
        return {
          source: "static_table",
          query,
          region,
          domain,
          domainName,
          year,
          varTitle: staticMatch.title,
          rows: [],
          staticTable: staticMatch,
          detectedIntent,
        };
      }
    } catch (staticTableError) {
      logger.debug(
        `find_data: static table fallback failed: ${
          staticTableError instanceof Error ? staticTableError.message : "unknown"
        }`
      );
    }

    return {
      source: "not_found",
      query,
      region,
      domain,
      domainName,
      year,
      rows: [],
      detectedIntent,
    };
  }

  // Step 3: Resolve period
  logger.debug(`find_data: using var_id=${bestVar.var_id} (${bestVar.title}) for query="${query}"`);
  const periodParam = await resolvePeriod(client, store, bestVar.var_id, domain, year, resolvedPeriods);

  // Step 4: Get data
  let result = await client.getDynamicData(domain, String(bestVar.var_id), periodParam);

  const usable = (response: BpsDynamicDataResponse | undefined): boolean =>
    !!response?.datacontent &&
    Object.keys(response.datacontent).length > 0 &&
    (domain === "0000" || hasRegionRow(response, domain, domainName));

  // Self-healing: if data empty and var came from learning, invalidate and retry search
  if (!usable(result) && fromLearning) {
    logger.debug(`find_data: self-healing — invalidating learned var_id=${bestVar.var_id}`);
    await invalidateVar(query, domain, store);
    if (year) {
      for (const y of year.split(",")) await invalidatePeriod(bestVar.var_id, domain, y.trim(), store);
    }

    const retryCandidates = await searchVariables(client, domain, kw, {
      maxSubjects: 6,
      maxPagesPerSubject: 6,
      maxCandidates: 20,
    });
    const retryVar = retryCandidates[0];
    if (retryVar) {
      bestVar = {
        var_id: retryVar.var_id,
        title: retryVar.title,
        sub_name: retryVar.sub_name,
        unit: retryVar.unit,
      };
      const retryPeriod = await resolvePeriod(client, store, bestVar.var_id, domain, year);
      result = await client.getDynamicData(domain, String(bestVar.var_id), retryPeriod);
      candidates.push(...retryCandidates);
    }
  }

  // If the best variable has no data, try the next candidates before
  // falling back to static tables.
  if (!usable(result) && candidates.length > 1) {
    for (const candidate of candidates.slice(1, 4)) {
      if (candidate.var_id === bestVar.var_id) continue;
      try {
        let candidatePeriod = await resolvePeriod(client, store, candidate.var_id, domain, year);
        if (yearList.length > 0) {
          const resolvedYears = await resolvePeriodsForSpec(
            client,
            domain,
            candidate.var_id,
            yearList.join(",")
          );
          if (resolvedYears.entries.length === 0) continue;
          candidatePeriod = resolvedYears.entries.map((entry) => entry.id).join(";");
        }
        const candidateResult = await client.getDynamicData(
          domain,
          String(candidate.var_id),
          candidatePeriod
        );
        if (usable(candidateResult)) {
          bestVar = {
            var_id: candidate.var_id,
            title: candidate.title,
            sub_name: candidate.sub_name,
            unit: candidate.unit,
          };
          result = candidateResult;
          logger.debug(`find_data: candidate fallback → var_id=${bestVar.var_id}`);
          break;
        }
      } catch (candidateError) {
        logger.debug(
          `find_data: candidate var_id=${candidate.var_id} failed: ${
            candidateError instanceof Error ? candidateError.message : "unknown"
          }`
        );
      }
    }
  }

  // Fallback for kab/kota domains: try parent province if no data
  if (!usable(result) && domain !== "0000" && domain.length === 4 && !domain.endsWith("00")) {
    const parentDomain = domain.slice(0, 2) + "00";
    const parentCandidates = await searchVariables(client, parentDomain, kw, {
      maxSubjects: 6,
      maxPagesPerSubject: 6,
      maxCandidates: 10,
    });
    const parentVar = (await lookupVar(query, parentDomain, store)) || parentCandidates[0] || null;
    if (parentVar) {
      const parentPeriod = await resolvePeriod(client, store, parentVar.var_id, parentDomain, year);
      const parentResult = await client.getDynamicData(
        parentDomain,
        String(parentVar.var_id),
        parentPeriod
      );
      if (
        parentResult.datacontent &&
        Object.keys(parentResult.datacontent).length > 0 &&
        (parentDomain === "0000" || hasRegionRow(parentResult, parentDomain, undefined))
      ) {
        const relevantParent = filterRelevantVervar(parentResult, parentDomain);
        const payload = buildStructuredPayload(relevantParent, parentDomain);
        return {
          source: "parent_dynamic_data",
          query,
          region,
          domain,
          domainName,
          parentDomain,
          year,
          varId: parentVar.var_id,
          varTitle: parentVar.title,
          unit: payload.units[0] ?? parentVar.unit,
          periods: [...new Set(payload.rows.map((row) => row.period))],
          rows: payload.rows,
          rawResponse: relevantParent,
          detectedIntent,
        };
      }
    }
  }

  // Still no data after retry — try static tables as fallback
  if (!usable(result)) {
    try {
      const staticMatch = await staticTableFallbackService(client, domain, domainName, kw, query);
      if (staticMatch) {
        return {
          source: "static_table",
          query,
          region,
          domain,
          domainName,
          year,
          varTitle: staticMatch.title,
          rows: [],
          staticTable: staticMatch,
          detectedIntent,
        };
      }
    } catch (staticTableError) {
      logger.debug(
        `find_data: static table fallback failed: ${
          staticTableError instanceof Error ? staticTableError.message : "unknown"
        }`
      );
    }

    const alternatives = candidates
      .filter((candidate) => candidate.var_id !== bestVar.var_id)
      .slice(0, 5)
      .map((c) => ({ var_id: c.var_id, title: c.title, unit: c.unit }));

    return {
      source: "not_found",
      query,
      region,
      domain,
      domainName,
      year,
      varId: bestVar.var_id,
      varTitle: bestVar.title,
      rows: [],
      alternatives,
      detectedIntent,
    };
  }

  // Success — learn the variable mapping
  await learnVar(query, domain, bestVar, store);

  const relevantResult = filterRelevantVervar(
    result,
    domain,
    domainName,
    asksBreakdown ? 10_000 : 10
  );
  const payload = buildStructuredPayload(relevantResult, domain);
  const hints = generateResultHints(query, domain, domainName, bestVar.var_id, bestVar.title);

  return {
    source: "dynamic_data",
    query,
    region,
    domain,
    domainName,
    year,
    varId: bestVar.var_id,
    varTitle: bestVar.title,
    unit: payload.units[0] ?? bestVar.unit,
    periods: [...new Set(payload.rows.map((row) => row.period))],
    matchedYears,
    missingYears,
    filteredAggregate: relevantResult !== result,
    rows: payload.rows,
    rawResponse: relevantResult,
    detectedIntent,
    hints,
  };
}

/** Headline topics that are best answered by strategic indicators when no year is given. */
const HEADLINE_PATTERNS = [
  /\binflasi\b/,
  /\bpertumbuhan ekonomi\b/,
  /\bpengangguran\b/,
  /\bkemiskinan\b/,
  /\bmiskin\b/,
  /\bgini\b/,
  /\bketimpangan\b/,
  /\bipm\b/,
  /\bindeks pembangunan manusia\b/,
  /\bekspor\b/,
  /\bimpor\b/,
  /\bneraca perdagangan\b/,
];

function isHeadlineQuery(normalizedQuery: string): boolean {
  return HEADLINE_PATTERNS.some((pattern) => pattern.test(normalizedQuery));
}

async function resolvePeriod(
  client: BpsClient,
  store: IPersistentStore | null,
  varId: number,
  domain: string,
  year: string | undefined,
  knownPeriods?: unknown[]
): Promise<string | undefined> {
  if (!year) {
    try {
      const periods =
        knownPeriods && knownPeriods.length > 0
          ? knownPeriods
          : await client.listPeriods(domain, varId, 1);
      if (periods.length > 0) {
        return getPeriodId(periods[0]) || undefined;
      }
    } catch {
      /* fall through */
    }
    return undefined;
  }

  const yearNums = year
    .split(/[,;]/)
    .map((y) => y.trim())
    .filter(Boolean);

  try {
    const periods =
      knownPeriods && knownPeriods.length > 0
        ? knownPeriods
        : await listAllPeriodsSafe(client, domain, varId);
    if (periods.length > 0) {
      const matchingPeriods = periods.filter((p) => {
        const label = getPeriodLabel(p);
        return yearNums.some((y) => label.includes(y));
      });
      if (matchingPeriods.length > 0) {
        for (const p of matchingPeriods) {
          const label = getPeriodLabel(p);
          const id = getPeriodId(p);
          const matchedYear = yearNums.find((y) => label.includes(y));
          if (matchedYear && id) {
            await learnPeriod(varId, domain, matchedYear, id, store);
          }
        }
        return matchingPeriods
          .map((p) => getPeriodId(p))
          .filter(Boolean)
          .join(",");
      }
    }
  } catch {
    // If period lookup fails, no usable period.
  }
  return undefined;
}

async function listAllPeriodsSafe(
  client: BpsClient,
  domain: string,
  varId: number
): Promise<unknown[]> {
  const maybeAll = (
    client as BpsClient & {
      listAllPeriods?: (domain?: string, varId?: number) => Promise<unknown[]>;
    }
  ).listAllPeriods;
  if (typeof maybeAll === "function") {
    return maybeAll.call(client, domain, varId);
  }
  return client.listPeriods(domain, varId);
}

async function tryStrategicIndicatorsService(
  client: BpsClient,
  kw: string,
  domain: string,
  year: string | undefined
): Promise<BpsStrategicIndicator | null> {
  const indicators = await client.listStrategicIndicators(domain);
  if (!indicators.data || indicators.data.length === 0) return null;

  const terms = expandQueryTerms(kw);
  let best: { indicator: (typeof indicators.data)[number]; score: number } | null = null;

  for (const indicator of indicators.data) {
    const titleLower = indicator.title.toLowerCase();
    let score = 0;
    if (titleLower.includes(kw)) score += 40;
    for (const term of terms) {
      if (term.length > 2 && titleLower.includes(term)) score += 10;
    }
    if (score === 0) continue;
    if (year && !indicator.periode.includes(year)) continue;
    if (!best || score > best.score) best = { indicator, score };
  }

  return best?.indicator ?? null;
}

async function searchVariablesInSubject(
  client: BpsClient,
  domain: string,
  subject: number | undefined,
  keyword: string,
  results: FindVariableItem[]
): Promise<void> {
  let firstPage;
  try {
    firstPage = await client.listVariables(domain, subject, undefined, 1, 100);
  } catch (error) {
    logger.debug(
      `searchVariablesInSubject failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  if (!firstPage.data || firstPage.data.length === 0) return;

  const pages = Math.min(firstPage.page?.pages ?? 1, 6);
  const scored: Array<{ variable: (typeof firstPage.data)[number]; score: number }> = [];

  for (let page = 1; page <= pages; page++) {
    const result =
      page === 1 ? firstPage : await client.listVariables(domain, subject, undefined, page, 100);
    if (!result.data || result.data.length === 0) break;

    for (const variable of result.data) {
      const score = computeRelevanceScore(keyword, variable.title, variable.sub_name, variable.def);
      if (score > 0) scored.push({ variable, score });
    }
    if (scored.length >= 30) break;
  }

  scored.sort((a, b) => b.score - a.score);
  for (const { variable } of scored.slice(0, 15)) {
    if (results.some((existing) => existing.var_id === variable.var_id)) continue;
    results.push({
      var_id: variable.var_id,
      title: variable.title,
      sub_name: variable.sub_name,
      unit: variable.unit,
      def: variable.def,
    });
  }
}

async function staticTableFallbackService(
  client: BpsClient,
  domain: string,
  domainName: string,
  kw: string,
  query: string
): Promise<StaticTableMatch | null> {
  const words = kw.split(/\s+/).filter(Boolean);
  let tableDomain = domain;
  let tables = await safeListStaticTables(client, domain, kw);

  if (tables.length === 0 && words.length > 1) {
    const lastTwo = words.slice(-2).join(" ");
    tables = await safeListStaticTables(client, domain, lastTwo);
    if (tables.length === 0) {
      const firstTwo = words.slice(0, 2).join(" ");
      tables = await safeListStaticTables(client, domain, firstTwo);
    }
  }

  if (tables.length === 0 && words.length <= 2 && kw !== "penduduk") {
    tables = await safeListStaticTables(client, domain, "penduduk");
  }

  if (tables.length === 0) {
    tables = await safeListStaticTables(client, domain, undefined);
  }

  if (tables.length === 0 && domain.length === 4 && !domain.endsWith("00")) {
    const parentDomain = `${domain.slice(0, 2)}00`;
    tableDomain = parentDomain;
    tables = await safeListStaticTables(client, parentDomain, kw);
    if (tables.length === 0 && words.length > 1) {
      tables = await safeListStaticTables(client, parentDomain, words.slice(-2).join(" "));
    }
    if (tables.length === 0) {
      tables = await safeListStaticTables(client, parentDomain, "penduduk");
    }
  }

  const asksBreakdown = /\b(kabupaten|kecamatan|desa|kelurahan|per\s*kab|per\s*kec)\b/i.test(query);
  const searchTerms = [kw, ...words.filter((word) => word.length > 2)];
  const queryText = query.toLowerCase();
  const scoredTables = tables
    .map((table) => {
      const title = table.title.toLowerCase();
      const subject = (table.subj ?? "").toLowerCase();
      const topicHits = searchTerms.filter((term) => title.includes(term)).length;
      if (topicHits === 0) return { table, score: 0 };
      let score = 20 + topicHits * 15;
      if (title.includes(kw)) score += 15;
      if (domainName && title.includes(domainName.toLowerCase())) score += 10;
      if (title.includes("kabupaten")) score += 5;
      if (title.includes("jumlah") || title.includes("penduduk")) score += 5;
      if (title.includes("menurut") && searchTerms.some((term) => title.includes(term))) score += 10;
      if (searchTerms.some((term) => term.length > 3 && subject.includes(term))) score += 15;
      if (
        /\bpengadilan\b|\bperkara\b|\bperceraian\b/.test(title) &&
        !/\bpengadilan\b|\bperkara\b|\bperceraian\b/.test(queryText)
      ) {
        score -= 40;
      }
      if (/desa|kelurahan|kecamatan/.test(title)) {
        score += asksBreakdown ? 15 : -25;
      }
      return { table, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredTables.length === 0) return null;

  let framesetFallback: StaticTableMatch | null = null;
  for (const { table } of scoredTables.slice(0, 5)) {
    let detail;
    try {
      detail = await client.getStaticTable(tableDomain, table.table_id);
    } catch {
      continue;
    }
    const markdownTable = htmlTableToMarkdown(detail.table);
    const parsed = parseHtmlTable(detail.table);
    const match: StaticTableMatch = {
      table_id: detail.table_id,
      title: detail.title,
      subj: detail.subj,
      domain: tableDomain,
      updt_date: detail.updt_date,
      excel: detail.excel,
      markdownTable,
      headers: parsed && !parsed.isFrameset ? parsed.headers : undefined,
      rows: parsed && !parsed.isFrameset ? parsed.rows : undefined,
    };

    if (markdownTable.startsWith("_Tabel ini disajikan BPS sebagai file Excel")) {
      framesetFallback = framesetFallback ?? match;
      continue;
    }
    return match;
  }

  return framesetFallback;
}

async function safeListStaticTables(
  client: BpsClient,
  domain: string,
  keyword?: string,
  maxPages = 3
): Promise<BpsStaticTable[]> {
  const results: BpsStaticTable[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await client.listStaticTables(domain, keyword, undefined, undefined, page);
      for (const table of res.data || []) {
        if (seen.has(table.table_id)) continue;
        seen.add(table.table_id);
        results.push(table);
      }
      const pages = res.page?.pages ?? 1;
      if (page >= Math.min(pages, maxPages) || (res.data?.length ?? 0) === 0) break;
    } catch (err) {
      logger.debug(
        `safeListStaticTables failed for keyword="${keyword}" page=${page}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      break;
    }
  }
  return results;
}
