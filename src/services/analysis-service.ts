import type { BpsClient } from "../client/bps-client.js";
import type { DomainResolver } from "./domain-resolver.js";
import type { IPersistentStore } from "./persistent-store.js";
import { lookupVar, normalizeKeyword } from "./learning.js";
import { resolveVariable as resolveVariableShared, searchVariables } from "./variable-search.js";
import {
  rankKabkota,
  type KabkotaRankingResult,
  type KabkotaRankRow,
} from "./kabkota-ranking.js";
import { findKabkotaIndicator } from "../config/kabkota-indicators.js";
import { buildNationalBreakdown, buildRegionSeries, type RegionSeries } from "./region-series.js";
import { parseYearSpec } from "./period-resolver.js";
import { extractVervarId, getVervarEntries } from "./dynamic-data-utils.js";
import {
  formatUnit,
  getPeriodId,
  getPeriodLabel,
  getVariableTitle,
  getVariableUnit,
} from "../client/fields.js";

// ========== compare_data ==========

export interface CompareDataInput {
  query: string;
  regions?: string | string[];
  wilayah?: string | string[];
  provinces?: string | string[];
  year?: string;
  years?: string;
  start_year?: string;
  end_year?: string;
}

export interface CompareTrendSummary {
  region: string;
  firstYear?: string;
  lastYear?: string;
  firstValue?: number;
  lastValue?: number;
  diff?: number;
  changePct?: number | null;
  direction?: "naik" | "turun" | "stabil";
}

export interface CompareDataResult {
  query: string;
  spec?: string;
  regionsRequested: string[];
  varTitle: string;
  displayTitle: string;
  unit?: string;
  units: string[];
  unitNote?: string;
  seriesLabel?: string;
  multiYear: boolean;
  usedNationalTable: boolean;
  hasData: boolean;
  series: RegionSeries[];
  notes: string[];
  sources: Array<{ who: string; varId: number; varTitle: string; domain: string }>;
  summary?: {
    highest?: { region: string; value: number; unit?: string };
    lowest?: { region: string; value: number; unit?: string };
    yearKeys?: string[];
    yearRange?: string;
    trends?: CompareTrendSummary[];
  };
}

function normalizeStringList(input?: string | string[]): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function compareDataService(
  client: BpsClient,
  resolver: DomainResolver,
  store: IPersistentStore | null,
  input: CompareDataInput
): Promise<CompareDataResult> {
  const rawRegions = input.regions ?? input.wilayah ?? input.provinces;
  const regionList = normalizeStringList(rawRegions);
  if (regionList.length === 0) {
    throw new Error('Parameter \'regions\' wajib diisi, misal regions="Jawa Timur, Jawa Barat".');
  }
  if (regionList.length < 2) {
    throw new Error("Minimal 2 wilayah untuk perbandingan.");
  }

  const { query, year, years, start_year, end_year } = input;
  const spec = years ?? (start_year ? `${start_year}-${end_year ?? start_year}` : year);
  const parsed = parseYearSpec(spec);
  const multiYear = parsed.years.length > 1 || parsed.periodIds.length > 1;

  const resolvedRegions = await Promise.all(
    regionList.map(async (regionName) => ({
      regionName,
      resolved: await resolver.resolve(regionName),
    }))
  );

  const seriesList: RegionSeries[] = [];
  let usedNationalTable = false;

  const provinceOnly =
    resolvedRegions.length > 1 &&
    resolvedRegions.every(
      (item) =>
        item.resolved !== null &&
        /^\d{4}$/.test(item.resolved.domainId) &&
        item.resolved.domainId.endsWith("00")
    );

  if (provinceOnly) {
    const breakdown = await buildNationalBreakdown(
      client,
      query,
      resolvedRegions.map((item) => ({
        name: item.regionName,
        domainName: item.resolved!.domainName,
      })),
      parsed.years,
      store
    );
    if (breakdown) {
      usedNationalTable = true;
      for (const item of resolvedRegions) {
        const points = breakdown.byRegion.get(item.resolved!.domainName) ?? [];
        seriesList.push({
          region: item.regionName,
          domain: "0000",
          domainName: item.resolved!.domainName,
          varId: breakdown.varId,
          varTitle: breakdown.varTitle,
          unit: breakdown.unit,
          seriesLabel: breakdown.seriesLabel,
          points,
          missingYears: parsed.years.filter((y) => !points.some((point) => point.year === y)),
          availableYears: [],
          notes: [],
        });
      }
    }
  }

  if (!usedNationalTable) {
    for (const item of resolvedRegions) {
      if (!item.resolved) {
        seriesList.push({
          region: item.regionName,
          domain: "?",
          domainName: item.regionName,
          varId: null,
          varTitle: query,
          points: [],
          missingYears: parsed.years,
          availableYears: [],
          notes: ["Wilayah tidak ditemukan."],
        });
        continue;
      }
      const series = await buildRegionSeries(
        client,
        store,
        query,
        item.regionName,
        item.resolved.domainId,
        item.resolved.domainName,
        { years: parsed.years, maxCandidates: 6 }
      );
      seriesList.push(series);
    }
  }

  const withData = seriesList.filter((series) => series.points.length > 0);
  if (withData.length === 0) {
    return {
      query,
      spec,
      regionsRequested: regionList,
      varTitle: query,
      displayTitle: query,
      units: [],
      multiYear,
      usedNationalTable,
      hasData: false,
      series: seriesList,
      notes: seriesList.map((s) => `${s.region}: ${s.notes.join(" ") || "tidak ada data"}`),
      sources: [],
    };
  }

  const varTitle = withData[0].varTitle || query;
  const sameTitle = new Set(withData.map((series) => series.varTitle)).size === 1;
  const displayTitle = sameTitle ? varTitle : query.charAt(0).toUpperCase() + query.slice(1);

  const originalUnits = [...new Set(withData.map((series) => series.unit).filter(Boolean))];
  const massScale = (unit?: string): number | null => {
    const normalized = (unit ?? "").toLowerCase().trim();
    if (normalized === "juta jiwa" || normalized === "juta orang") return 1000;
    if (normalized === "ribu jiwa" || normalized === "ribu orang") return 1;
    if (normalized === "jiwa" || normalized === "orang") return 0.001;
    return null;
  };
  const scales = withData.map((series) => massScale(series.unit));
  const canNormalize = withData.length > 1 && scales.every((scale) => scale !== null);
  let unitNote = "";
  if (canNormalize) {
    withData.forEach((series, index) => {
      const scale = scales[index] as number;
      series.points = series.points.map((point) => ({ ...point, value: point.value * scale }));
      series.unit = "Ribu Jiwa";
    });
    if (originalUnits.length > 1) {
      unitNote = `Satuan diseragamkan ke Ribu Jiwa (asli: ${originalUnits.join(", ")}).`;
    }
  }

  const unitList = [...new Set(withData.map((series) => series.unit).filter((u): u is string => Boolean(u)))];
  const unitLabel = unitList.length === 1 ? formatUnit(unitList[0]) : undefined;
  const seriesLabel = withData.find((series) => series.seriesLabel)?.seriesLabel;

  let summary: CompareDataResult["summary"];
  if (!multiYear) {
    const numeric = seriesList
      .filter((series) => series.points.length > 0)
      .map((series) => ({
        region: series.region,
        value: series.points[0].value,
        unit: formatUnit(series.unit) || undefined,
      }));
    if (numeric.length >= 2) {
      const sorted = [...numeric].sort((a, b) => b.value - a.value);
      summary = {
        highest: sorted[0],
        lowest: sorted[sorted.length - 1],
      };
    }
  } else {
    const yearKeys = [
      ...new Set(withData.flatMap((series) => series.points.map((point) => point.year))),
    ].sort();
    const yearRange =
      yearKeys.length > 1 ? `${yearKeys[0]}–${yearKeys[yearKeys.length - 1]}` : yearKeys[0];
    const trends: CompareTrendSummary[] = withData.map((series) => {
      const pts = series.points;
      if (pts.length < 2) {
        return {
          region: series.region,
          firstYear: pts[0]?.year,
          firstValue: pts[0]?.value,
        };
      }
      const first = pts[0];
      const last = pts[pts.length - 1];
      const diff = last.value - first.value;
      const changePct = first.value !== 0 ? Number(((diff / first.value) * 100).toFixed(1)) : null;
      const direction: "naik" | "turun" | "stabil" = diff > 0 ? "naik" : diff < 0 ? "turun" : "stabil";
      return {
        region: series.region,
        firstYear: first.year,
        lastYear: last.year,
        firstValue: first.value,
        lastValue: last.value,
        diff,
        changePct,
        direction,
      };
    });
    summary = { yearKeys, yearRange, trends };
  }

  const extraNotes = seriesList.flatMap((series) =>
    series.notes.map((note) => `${series.region}: ${note}`)
  );
  if (unitNote) extraNotes.unshift(unitNote);
  if (usedNationalTable) {
    extraNotes.unshift(
      "Satu tabel nasional dipakai untuk semua wilayah, sehingga satuan dan presisinya konsisten."
    );
  }

  const sourceKeys = new Set<string>();
  const sources = seriesList
    .filter((series) => series.varId !== null)
    .filter((series) => {
      const key = `${series.varId}:${series.domain}`;
      if (sourceKeys.has(key)) return false;
      sourceKeys.add(key);
      return true;
    })
    .map((series) => {
      const shared = seriesList.filter(
        (other) => other.varId === series.varId && other.domain === series.domain
      );
      const who = shared.length > 1 ? "semua wilayah" : series.region;
      return {
        who,
        varId: series.varId as number,
        varTitle: series.varTitle,
        domain: series.domain,
      };
    });

  return {
    query,
    spec,
    regionsRequested: regionList,
    varTitle,
    displayTitle,
    unit: unitLabel || undefined,
    units: unitList,
    unitNote: unitNote || undefined,
    seriesLabel,
    multiYear,
    usedNationalTable,
    hasData: true,
    series: seriesList,
    notes: [...new Set(extraNotes)],
    sources,
    summary,
  };
}

// ========== get_trend ==========

export interface GetTrendInput {
  query: string;
  region?: string;
  wilayah?: string;
  start_year?: string;
  end_year?: string;
  years?: string;
}

export interface TrendPoint {
  id: string;
  label: string;
  year: string;
  value: number;
  changePct: number | null;
}

export interface TrendHeadlineFallback {
  title: string;
  periode: string;
  value: number | string;
  unit?: string;
  name?: string;
}

export interface GetTrendResult {
  query: string;
  spec: string;
  yearList: string[];
  varId: number | null;
  varTitle: string;
  unit?: string;
  domain: string;
  domainName: string;
  seriesLabel?: string;
  missingYears: string[];
  notes: string[];
  points: TrendPoint[];
  totalChangePct?: number | null;
  direction?: "naik" | "turun" | "stabil";
  headlineFallback?: TrendHeadlineFallback;
}

export async function getTrendService(
  client: BpsClient,
  resolver: DomainResolver,
  store: IPersistentStore | null,
  input: GetTrendInput
): Promise<GetTrendResult> {
  const region = input.region || input.wilayah || "Indonesia";
  const startYear = input.start_year || "2019";
  const endYear = input.end_year || "2024";

  let domain = "0000";
  let domainName = "Indonesia";
  if (region.toLowerCase() !== "indonesia" && region !== "0000") {
    const resolved = await resolver.resolve(region);
    if (!resolved) {
      throw new Error(`Wilayah "${region}" tidak ditemukan.`);
    }
    domain = resolved.domainId;
    domainName = resolved.domainName;
  }

  const spec = input.years ?? `${startYear}-${endYear}`;
  const parsedYears = parseYearSpec(spec);
  const yearList = parsedYears.years;

  if (yearList.length === 0) {
    throw new Error("Rentang tahun tidak valid.");
  }
  if (yearList.length > 11) {
    throw new Error("Rentang maksimal 10 tahun per panggilan. Pecah menjadi beberapa rentang.");
  }

  const series = await buildRegionSeries(client, store, input.query, region, domain, domainName, {
    years: yearList,
    maxCandidates: 6,
  });

  if (series.points.length === 0) {
    try {
      const indicators = await client.listStrategicIndicators(domain);
      const kw = normalizeKeyword(input.query);
      for (const ind of indicators.data ?? []) {
        const title = ind.title.toLowerCase();
        if (
          title.includes(kw) ||
          kw.split(/\s+/).some((word) => word.length > 2 && title.includes(word))
        ) {
          const unit = formatUnit(ind.unit) || undefined;
          return {
            query: input.query,
            spec,
            yearList,
            varId: null,
            varTitle: ind.title,
            unit,
            domain,
            domainName,
            missingYears: yearList,
            notes: series.notes,
            points: [],
            headlineFallback: {
              title: ind.title,
              periode: ind.periode,
              value: ind.value,
              unit,
              name: ind.name,
            },
          };
        }
      }
    } catch {
      // fall through
    }

    return {
      query: input.query,
      spec,
      yearList,
      varId: series.varId,
      varTitle: series.varTitle,
      unit: formatUnit(series.unit) || undefined,
      domain,
      domainName,
      missingYears: series.missingYears,
      notes: series.notes,
      points: [],
    };
  }

  const points: TrendPoint[] = series.points.map((point, index) => {
    let changePct: number | null = null;
    if (index > 0) {
      const previous = series.points[index - 1].value;
      if (previous !== 0) {
        changePct = Number((((point.value - previous) / previous) * 100).toFixed(1));
      }
    }
    return {
      id: point.id,
      label: point.label,
      year: point.year,
      value: point.value,
      changePct,
    };
  });

  let totalChangePct: number | null | undefined;
  let direction: "naik" | "turun" | "stabil" | undefined;
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.value !== 0) {
      totalChangePct = Number((((last.value - first.value) / first.value) * 100).toFixed(1));
      direction = last.value > first.value ? "naik" : last.value < first.value ? "turun" : "stabil";
    }
  }

  return {
    query: input.query,
    spec,
    yearList,
    varId: series.varId,
    varTitle: series.varTitle,
    unit: formatUnit(series.unit) || undefined,
    domain,
    domainName,
    seriesLabel: series.seriesLabel,
    missingYears: series.missingYears,
    notes: series.notes,
    points,
    totalChangePct,
    direction,
  };
}

// ========== get_ranking ==========

export interface GetRankingInput {
  query: string;
  level: "provinsi" | "kabkota";
  top_n?: number;
  order?: "highest" | "lowest";
  year?: string;
  period_mode?: "common" | "latest";
  provinces?: string | string[];
}

export interface KabkotaRankingServiceResult {
  level: "kabkota";
  query: string;
  indicator: string;
  unit?: string;
  order: "highest" | "lowest";
  targetYear?: string;
  yearRequested?: string;
  periods: string[];
  series: string[];
  totalRegions: number;
  provincesCovered: number;
  provincesConsidered: number;
  missingProvinces: Array<{ province: string; reason: string }>;
  rows: KabkotaRankRow[];
  rawKabkotaResult: KabkotaRankingResult;
}

export interface ProvinceRankingRow {
  rank: number;
  province: string;
  value: number;
}

export interface ProvinceRankingServiceResult {
  level: "provinsi";
  query: string;
  indicator: string;
  varId?: number;
  unit?: string;
  order: "highest" | "lowest";
  targetYear?: string;
  periodLabel?: string;
  periods: string[];
  totalRegions: number;
  rows: ProvinceRankingRow[];
  hasKabkotaAlternative: boolean;
  errorReason?: "no_variable" | "no_data" | "unparseable" | "too_many_categories";
  categoryCount?: number;
}

export type GetRankingResult = KabkotaRankingServiceResult | ProvinceRankingServiceResult;

export async function getRankingService(
  client: BpsClient,
  resolver: DomainResolver,
  store: IPersistentStore | null,
  input: GetRankingInput
): Promise<GetRankingResult> {
  const topN = input.top_n ?? 10;
  const order = input.order ?? "highest";
  const periodMode = input.period_mode ?? "common";

  if (input.level === "kabkota") {
    const provinceList = input.provinces ? normalizeStringList(input.provinces) : undefined;
    const ranking = await rankKabkota(client, resolver, {
      query: input.query,
      year: input.year,
      topN: Math.min(topN, 200),
      order,
      provinces: provinceList && provinceList.length > 0 ? provinceList : undefined,
      periodMode,
    });

    return {
      level: "kabkota",
      query: input.query,
      indicator: ranking.indicatorLabel,
      unit: ranking.rows[0]?.unit || undefined,
      order,
      targetYear: ranking.targetYear,
      yearRequested: ranking.yearRequested,
      periods: ranking.periods,
      series: ranking.series,
      totalRegions: ranking.totalRegions,
      provincesCovered: ranking.provincesCovered,
      provincesConsidered: ranking.provincesConsidered,
      missingProvinces: ranking.missing,
      rows: ranking.rows,
      rawKabkotaResult: ranking,
    };
  }

  const varData = await resolveVariableForRanking(client, store, input.query);
  if (!varData) {
    return {
      level: "provinsi",
      query: input.query,
      indicator: input.query,
      order,
      periods: [],
      totalRegions: 0,
      rows: [],
      hasKabkotaAlternative: Boolean(findKabkotaIndicator(input.query)),
      errorReason: "no_variable",
    };
  }

  const periods = await listAllPeriodsSafe(client, "0000", varData.var_id);
  let selectedPeriod = input.year
    ? periods.find((period) => getPeriodLabel(period).includes(input.year!))
    : periods[0];
  if (!selectedPeriod) selectedPeriod = periods[0];

  const selectedPeriodId = selectedPeriod ? getPeriodId(selectedPeriod) : "";
  const periodLabel = selectedPeriod ? getPeriodLabel(selectedPeriod) : "";
  const varTitle = getVariableTitle(varData) || varData.title;
  const unit = formatUnit(getVariableUnit(varData) ?? varData.unit) || undefined;

  const result = await client.getDynamicData("0000", String(varData.var_id), selectedPeriodId || undefined);
  if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
    return {
      level: "provinsi",
      query: input.query,
      indicator: varTitle,
      varId: varData.var_id,
      unit,
      order,
      targetYear: periodLabel || input.year,
      periodLabel,
      periods: periodLabel ? [periodLabel] : [],
      totalRegions: 0,
      rows: [],
      hasKabkotaAlternative: Boolean(findKabkotaIndicator(input.query)),
      errorReason: "no_data",
    };
  }

  const entries = getVervarEntries(result).filter(
    (entry) => !/^(indonesia|nasional|total|jumlah)$/i.test(entry.label.trim())
  );
  if (entries.length === 0) {
    return {
      level: "provinsi",
      query: input.query,
      indicator: varTitle,
      varId: varData.var_id,
      unit,
      order,
      targetYear: periodLabel || input.year,
      periodLabel,
      periods: periodLabel ? [periodLabel] : [],
      totalRegions: 0,
      rows: [],
      hasKabkotaAlternative: Boolean(findKabkotaIndicator(input.query)),
      errorReason: "unparseable",
    };
  }
  if (entries.length > 40) {
    return {
      level: "provinsi",
      query: input.query,
      indicator: varTitle,
      varId: varData.var_id,
      unit,
      order,
      targetYear: periodLabel || input.year,
      periodLabel,
      periods: periodLabel ? [periodLabel] : [],
      totalRegions: 0,
      rows: [],
      hasKabkotaAlternative: Boolean(findKabkotaIndicator(input.query)),
      errorReason: "too_many_categories",
      categoryCount: entries.length,
    };
  }

  const valuesByVervar = new Map<string, number>();
  for (const [key, value] of Object.entries(result.datacontent)) {
    if (typeof value !== "number") continue;
    const vervarId = extractVervarId(key, result);
    if (vervarId && !valuesByVervar.has(vervarId)) valuesByVervar.set(vervarId, value);
  }

  const rankings = entries
    .filter((entry) => valuesByVervar.has(entry.id))
    .map((entry) => ({ province: entry.label, value: valuesByVervar.get(entry.id)! }));

  if (rankings.length === 0) {
    return {
      level: "provinsi",
      query: input.query,
      indicator: varTitle,
      varId: varData.var_id,
      unit,
      order,
      targetYear: periodLabel || input.year,
      periodLabel,
      periods: periodLabel ? [periodLabel] : [],
      totalRegions: 0,
      rows: [],
      hasKabkotaAlternative: Boolean(findKabkotaIndicator(input.query)),
      errorReason: "unparseable",
    };
  }

  rankings.sort((a, b) => (order === "highest" ? b.value - a.value : a.value - b.value));
  const display = rankings.slice(0, Math.min(topN, rankings.length));

  return {
    level: "provinsi",
    query: input.query,
    indicator: varTitle,
    varId: varData.var_id,
    unit,
    order,
    targetYear: periodLabel || input.year,
    periodLabel,
    periods: periodLabel ? [periodLabel] : [],
    totalRegions: rankings.length,
    rows: display.map((item, idx) => ({
      rank: idx + 1,
      province: item.province,
      value: item.value,
    })),
    hasKabkotaAlternative: Boolean(findKabkotaIndicator(input.query)),
  };
}

// --- Helpers ---

async function listAllPeriodsSafe(client: BpsClient, domain: string, varId: number) {
  const maybeAll = (
    client as BpsClient & {
      listAllPeriods?: (domain?: string, varId?: number) => Promise<Array<Record<string, unknown>>>;
    }
  ).listAllPeriods;
  if (typeof maybeAll === "function") {
    return maybeAll.call(client, domain, varId);
  }
  return client.listPeriods(domain, varId);
}

async function resolveVariableForRanking(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
  const learned = await lookupVar(query, "0000", store);
  if (learned) {
    try {
      const periods = await listAllPeriodsSafe(client, "0000", learned.var_id);
      const hasRecent = periods.some((period) => {
        const year = Number(getPeriodLabel(period).match(/\d{4}/)?.[0] ?? 0);
        return year >= 2020;
      });
      if (hasRecent) return learned;
    } catch {
      // Fall through to the search below.
    }
  }

  const candidates = await searchVariables(client, "0000", query, {
    maxSubjects: 8,
    maxPagesPerSubject: 6,
    maxCandidates: 40,
  });
  if (candidates.length === 0) {
    return resolveVariableShared(client, store, query, "0000");
  }

  const provinceCandidates = candidates.filter(
    (candidate) => /provinsi/i.test(candidate.title) && !/metode lama/i.test(candidate.title)
  );
  const pool = provinceCandidates.length > 0 ? provinceCandidates : candidates;

  const scored = pool
    .map((candidate) => ({
      candidate,
      score:
        candidate.score +
        (/persentase|tingkat|indeks|rasio/i.test(candidate.title) ? 10 : 0) -
        (/kabupaten|kecamatan/i.test(candidate.title) ? 20 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  for (const { candidate } of scored.slice(0, 5)) {
    const periods = await listAllPeriodsSafe(client, "0000", candidate.var_id);
    const hasRecent = periods.some((period) => {
      const year = Number(getPeriodLabel(period).match(/\d{4}/)?.[0] ?? 0);
      return year >= 2020;
    });
    if (hasRecent) return candidate;
  }

  return scored[0]?.candidate ?? null;
}
