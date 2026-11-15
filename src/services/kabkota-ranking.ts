import type { BpsClient } from "../client/bps-client.js";
import type { DomainResolver } from "./domain-resolver.js";
import { getPeriodId, getPeriodLabel, isNeutralPeriodLabel } from "../client/fields.js";
import { buildStructuredPayload, type StructuredRow } from "./data-formatter.js";
import { computeRelevanceScore, searchVariables } from "./variable-search.js";
import { findKabkotaIndicator, type KabkotaIndicatorHint } from "../config/kabkota-indicators.js";
import { logger } from "../utils/logger.js";

/**
 * National ranking across kabupaten/kota.
 *
 * BPS has no national kab/kota table for most indicators: the numbers live in
 * each provincial domain under a different var_id. This service fans out over
 * the provinces (the client's scheduler keeps the request rate safe), extracts
 * one value per kabupaten/kota, and merges the result into a single ranking —
 * so the agent needs one tool call instead of ~170.
 */

export interface KabkotaRankOptions {
  query: string;
  year?: string;
  topN: number;
  order: "highest" | "lowest";
  /** Optional province names/codes to restrict the sweep. */
  provinces?: string[];
  /** How many provinces to query in parallel (client throttles the rest). */
  concurrency?: number;
  /**
   * "common" (default): use the newest year that enough provinces publish, so
   * every row in the ranking is comparable.
   * "latest": use each province's own newest period (mixed years).
   */
  periodMode?: "common" | "latest";
}

export interface KabkotaRankRow {
  region: string;
  province: string;
  domain: string;
  value: number;
  period: string;
  series?: string;
  unit?: string;
  indicator: string;
}

export interface KabkotaRankingResult {
  rows: KabkotaRankRow[];
  /** Regions with a usable value (before top-N slicing). */
  totalRegions: number;
  provincesCovered: number;
  provincesConsidered: number;
  periods: string[];
  series: string[];
  indicatorLabel: string;
  missing: Array<{ province: string; reason: string }>;
  /** Year actually used for every row (undefined when periodMode="latest"). */
  targetYear?: string;
  /** Set when the caller asked for a specific year. */
  yearRequested?: string;
}

interface ProvinceTarget {
  province: ProvinceRef;
  candidates: Array<{ varId: string; title: string }>;
}

interface ProvinceRef {
  domain: string;
  name: string;
}

const DEFAULT_CONCURRENCY = 3;

/** Share of provinces that must publish a year before it is used for all. */
const COMMON_YEAR_COVERAGE = 0.6;

/** Kab/kota series older than this are reported as gaps, not ranked. */
const MAX_DATA_AGE_YEARS = 2;

export async function rankKabkota(
  client: BpsClient,
  resolver: DomainResolver,
  options: KabkotaRankOptions
): Promise<KabkotaRankingResult> {
  const hint = findKabkotaIndicator(options.query);
  const provinces = await resolveProvinces(resolver, options.provinces);
  const missing: Array<{ province: string; reason: string }> = [];

  // Provinces we know only publish province totals: report them as gaps
  // instead of spending 3 requests each to rediscover that.
  const included: ProvinceRef[] = [];
  for (const province of provinces) {
    const knownGap = hint?.unavailable[province.domain];
    if (knownGap) {
      missing.push({ province: province.name, reason: knownGap });
      continue;
    }
    included.push(province);
  }

  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  // 1. Which variable holds the kab/kota breakdown in each province.
  const targets: ProvinceTarget[] = [];
  for (const province of included) {
    const candidates = await candidateVariables(client, province, options.query, hint);
    if (candidates.length === 0) {
      missing.push({ province: province.name, reason: "tidak ada tabel kabupaten/kota yang cocok" });
      continue;
    }
    targets.push({ province, candidates });
  }

  // 2. Pick one comparison year. Each BPS province releases Sakernas at its own
  //    pace; defaulting to "latest per province" mixes 2024/2025/2026 and makes
  //    the ranking incomparable (an agent then re-sweeps everything by hand to
  //    normalise the year — exactly what this tool must prevent).
  const targetYear =
    options.year ??
    (options.periodMode === "latest"
      ? undefined
      : await selectTargetYear(client, targets, concurrency));

  // 3. Fetch and merge.
  const collected: KabkotaRankRow[] = [];

  for (let index = 0; index < targets.length; index += concurrency) {
    const batch = targets.slice(index, index + concurrency);
    const settled = await Promise.allSettled(
      batch.map((target) => fetchProvinceRows(client, target, options.query, targetYear))
    );

    settled.forEach((outcome, position) => {
      const target = batch[position];
      if (outcome.status === "fulfilled") {
        if (outcome.value.rows.length === 0) {
          missing.push({
            province: target.province.name,
            reason: outcome.value.reason ?? "tidak ada tabel kabupaten/kota yang cocok",
          });
        } else {
          collected.push(...outcome.value.rows);
        }
      } else {
        const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        logger.debug(`rankKabkota: ${target.province.name} failed: ${reason}`);
        missing.push({ province: target.province.name, reason: `gagal diambil (${reason.slice(0, 120)})` });
      }
    });
  }

  const sorted = collected.sort((a, b) =>
    options.order === "highest" ? b.value - a.value : a.value - b.value
  );

  const periods = [...new Set(sorted.map((row) => row.period))];
  const series = [
    ...new Set(
      sorted
        .map((row) => row.series?.trim())
        .filter((value): value is string => !!value && !/^tidak ada$/i.test(value))
        .map((value) => value.replace(/\s+/g, " "))
    ),
  ];

  return {
    rows: sorted.slice(0, Math.max(1, options.topN)),
    totalRegions: sorted.length,
    provincesCovered: new Set(collected.map((row) => row.domain)).size,
    provincesConsidered: provinces.length,
    periods,
    series,
    indicatorLabel: hint?.label ?? (collected[0]?.indicator ?? options.query),
    missing,
    targetYear,
    yearRequested: options.year,
  };
}

async function resolveProvinces(
  resolver: DomainResolver,
  requested?: string[]
): Promise<ProvinceRef[]> {
  await resolver.ensureLoaded();

  const isProvince = (domain: string) =>
    domain.length === 4 && domain.endsWith("00") && domain !== "0000";
  const all = resolver
    .getDomains()
    .filter((domain) => isProvince(domain.domain_id))
    .map((domain) => ({ domain: domain.domain_id, name: domain.domain_name }));

  const unique = new Map(all.map((province) => [province.domain, province]));

  if (!requested || requested.length === 0) {
    return [...unique.values()];
  }

  const selected: ProvinceRef[] = [];
  for (const query of requested) {
    const resolved = await resolver.resolve(query);
    if (resolved && unique.has(resolved.domainId)) {
      selected.push(unique.get(resolved.domainId)!);
    }
  }
  return selected;
}

/**
 * Newest year that enough provinces actually publish. Using the newest *shared*
 * year keeps the ranking apples-to-apples instead of mixing 2024/2025/2026.
 */
async function selectTargetYear(
  client: BpsClient,
  targets: ProvinceTarget[],
  concurrency: number
): Promise<string | undefined> {
  if (targets.length === 0) return undefined;

  const yearCounts = new Map<string, number>();
  let reporting = 0;

  for (let index = 0; index < targets.length; index += concurrency) {
    const batch = targets.slice(index, index + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (target) => {
        const periods = await client.listPeriods(
          target.province.domain,
          Number(target.candidates[0].varId)
        );
        const years = new Set(
          periods
            .map((period) => getPeriodLabel(period).match(/\d{4}/)?.[0])
            .filter((year): year is string => !!year)
        );
        return years;
      })
    );

    for (const outcome of settled) {
      if (outcome.status !== "fulfilled" || outcome.value.size === 0) continue;
      reporting += 1;
      for (const year of outcome.value) {
        yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      }
    }
  }

  if (yearCounts.size === 0) return undefined;
  const threshold = Math.max(2, Math.ceil(reporting * COMMON_YEAR_COVERAGE));
  const eligible = [...yearCounts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([year]) => year)
    .sort();

  if (eligible.length > 0) return eligible[eligible.length - 1];

  // No shared year: take the most common one rather than mixing all of them.
  return [...yearCounts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
}

interface ProvinceFetchResult {
  rows: KabkotaRankRow[];
  /** Why no rows came back, for the coverage report. */
  reason?: string;
}

async function fetchProvinceRows(
  client: BpsClient,
  target: ProvinceTarget,
  query: string,
  year?: string
): Promise<ProvinceFetchResult> {
  const { province, candidates } = target;

  for (const candidate of candidates) {
    try {
      const periodId = await findPeriodId(client, province.domain, candidate.varId, year);
      if (!periodId) {
        if (year) return { rows: [], reason: `belum ada data ${year}` };
        continue;
      }

      const response = await client.getDynamicData(province.domain, candidate.varId, periodId);
      const payload = buildStructuredPayload(response, province.domain);
      const rows = pickRegionRows(payload.rows, query, province);
      if (rows.length >= 2) {
        const staleYear = stalenessYear(rows);
        if (staleYear !== null) {
          return {
            rows: [],
            reason: `data terbaru ${staleYear} (lebih dari ${MAX_DATA_AGE_YEARS} tahun)`,
          };
        }
        logger.debug(
          `rankKabkota: ${province.name} → var ${candidate.varId} (${rows.length} kab/kota)`
        );
        return { rows };
      }
    } catch (error) {
      logger.debug(
        `rankKabkota: ${province.name} var ${candidate.varId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return { rows: [], reason: "tidak ada tabel kabupaten/kota yang cocok" };
}

/** Year of the newest row, or null when the whole series is recent enough. */
function stalenessYear(rows: KabkotaRankRow[]): number | null {
  const years = rows
    .map((row) => Number(row.period.match(/\d{4}/)?.[0] ?? 0))
    .filter((year) => year > 1900);
  if (years.length === 0) return null;
  const newest = Math.max(...years);
  return new Date().getFullYear() - newest > MAX_DATA_AGE_YEARS ? newest : null;
}

async function candidateVariables(
  client: BpsClient,
  province: ProvinceRef,
  query: string,
  hint: KabkotaIndicatorHint | null
): Promise<Array<{ varId: string; title: string }>> {
  const hinted = hint?.variables[province.domain];
  if (hinted) {
    return [{ varId: hinted, title: hint!.label }];
  }

  const discovered = await searchVariables(client, province.domain, query, {
    maxSubjects: 6,
    maxPagesPerSubject: 3,
    maxCandidates: 12,
  });

  return discovered
    .slice(0, 4)
    .map((candidate) => ({ varId: String(candidate.var_id), title: candidate.title }));
}

/**
 * Resolve the period to request. BPS requires `th`, so with no year we take the
 * newest period the variable publishes (periods come back newest-first).
 */
async function findPeriodId(
  client: BpsClient,
  domain: string,
  varId: string,
  year?: string
): Promise<string | undefined> {
  const periods = await client.listPeriods(domain, Number(varId));
  if (periods.length === 0) return undefined;
  if (!year) return getPeriodId(periods[0]) || undefined;

  const matching = periods.filter((period) => getPeriodLabel(period).includes(year));
  if (matching.length === 0) return undefined;
  // Prefer the annual/August period when a year has several (Feb vs Aug).
  const withAgustus = matching.find((period) => /agustus|tahunan/i.test(getPeriodLabel(period)));
  return getPeriodId(withAgustus ?? matching[matching.length - 1]) || undefined;
}

/**
 * Keep one value per kabupaten/kota, choosing the series that matches the query
 * (e.g. TPT rather than TPAK when a table packs several indicators).
 */
function pickRegionRows(
  rows: StructuredRow[],
  query: string,
  province: ProvinceRef
): KabkotaRankRow[] {
  const regions = rows.filter((row) => isRegionRow(row, province));
  if (regions.length === 0) return [];

  const series = selectSeries(regions, query);
  let candidates = regions;
  if (series !== null) {
    const matching = regions.filter((row) => normalize(row.series) === series);
    if (matching.length > 0) candidates = matching;
  }

  const subperiod = selectSubperiod(candidates);
  if (subperiod !== null) {
    const matching = candidates.filter((row) => normalize(row.subperiod) === subperiod);
    if (matching.length > 0) candidates = matching;
  }

  const byRegion = new Map<string, KabkotaRankRow>();
  for (const row of candidates) {
    const region = (row.category ?? "").replace(/^\d+\s*[-–]?\s*/, "").trim();
    if (!region || byRegion.has(region)) continue;
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;

    const unit = row.unit ?? "";
    // Guard against broken source rows (e.g. an unemployment count of 9.154
    // published as a percentage). Percentages above 100 are data errors.
    if (/persen|percent|%/i.test(unit) && (row.value < 0 || row.value > 100)) continue;

    byRegion.set(region, {
      region: titleCaseRegion(region),
      province: province.name,
      domain: province.domain,
      value: row.value,
      period: [row.period, isNeutralPeriodLabel(row.subperiod) ? undefined : row.subperiod]
        .filter(Boolean)
        .join(" "),
      series: row.series?.trim(),
      unit,
      indicator: row.indicator,
    });
  }

  return [...byRegion.values()];
}

function isRegionRow(row: StructuredRow, province: ProvinceRef): boolean {
  const label = (row.category ?? "").trim();
  if (!label) return false;
  if (/^(indonesia|nasional|total|jumlah)$/i.test(label)) return false;
  if (/provinsi/i.test(label)) return false;

  // Rows often carry the domain code: "7600 - Provinsi Sulawesi Barat",
  // "3301 Kabupaten Cilacap". The province row starts with the province code.
  if (label.startsWith(province.domain)) return false;

  const stripped = normalize(label.replace(/^\d+\s*[-–]?\s*/, ""));
  if (stripped === normalize(province.name)) return false;
  return stripped.length > 1;
}

/** Pick the series (derived variable) that best matches the query. */
function selectSeries(rows: StructuredRow[], query: string): string | null {
  const labels = [
    ...new Set(
      rows
        .map((row) => row.series?.trim())
        .filter((label): label is string => !!label && !/^tidak ada$/i.test(label))
    ),
  ];
  if (labels.length === 0) return null;
  if (labels.length === 1) return normalize(labels[0]);

  const scored = labels
    .map((label) => {
      let score = computeRelevanceScore(query, label);
      if (/persentase|tingkat|rasio|%/i.test(label)) score += 15;
      return { label, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] && scored[0].score > 0 ? normalize(scored[0].label) : normalize(labels[0]);
}

/** Prefer the August/annual series when a table has several sub-periods. */
function selectSubperiod(rows: StructuredRow[]): string | null {
  const labels = [...new Set(rows.map((row) => row.subperiod).filter((label): label is string => !!label))];
  if (labels.length <= 1) return null;

  const preference = [/^agustus$/i, /^tahunan$/i, /semester\s*2/i, /desember/i, /november/i];
  for (const pattern of preference) {
    const match = labels.find((label) => pattern.test(label.trim()));
    if (match) return normalize(match);
  }
  return normalize(labels[labels.length - 1]);
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function titleCaseRegion(value: string): string {
  // Banten publishes "Kab Pandeglang"/"Kab Serang"; expand for readability.
  const expanded = value.replace(/^kab\.?\s+/i, "Kabupaten ");
  if (expanded !== expanded.toUpperCase()) return expanded;
  return expanded
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase()))
    .join(" ");
}

export function formatKabkotaRanking(
  result: KabkotaRankingResult,
  options: { order: "highest" | "lowest"; query: string }
): string {
  const lines: string[] = [];
  const unit = result.rows[0]?.unit ? ` (${result.rows[0].unit})` : "";
  const direction = options.order === "highest" ? "Tertinggi" : "Terendah";
  const periodLabel =
    result.periods.length === 1
      ? result.periods[0]
      : result.periods.length === 0
        ? "-"
        : `${result.periods[0]} … ${result.periods[result.periods.length - 1]}`;

  const periodHeader = result.targetYear
    ? `${result.targetYear} (tahun yang sama untuk semua provinsi)`
    : periodLabel;

  lines.push(`## Ranking Kabupaten/Kota: ${result.indicatorLabel}${unit}`);
  lines.push(`**Urutan:** ${direction} | **Periode:** ${periodHeader}`);
  lines.push("");
  lines.push("| # | Kabupaten/Kota | Provinsi | Nilai | Periode |");
  lines.push("| --- | --- | --- | --- | --- |");

  result.rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${row.region} | ${row.province} | ${row.value.toLocaleString("id-ID")} | ${row.period} |`
    );
  });

  lines.push("");
  lines.push(
    `_Cakupan: ${result.totalRegions} kabupaten/kota dari ${result.provincesCovered} provinsi. ` +
      `Menampilkan ${result.rows.length} teratas._`
  );

  if (result.targetYear) {
    lines.push(
      `_Angka di atas sudah diseragamkan ke tahun ${result.targetYear}; tidak perlu menyisir ulang tabel provinsi. ` +
        `Untuk tahun lain: get_ranking(..., year="2025"). Untuk seri terbaru per provinsi: period_mode="latest"._`
    );
  } else if (result.periods.length > 1) {
    lines.push(
      `_Catatan: periode tidak seragam (${result.periods.join(", ")}) karena period_mode="latest". ` +
        `Sebutkan tahun per baris, atau panggil ulang dengan year="<tahun>" agar sebanding._`
    );
  }

  if (result.series.length > 1) {
    lines.push(`_Seri yang dipakai: ${result.series[0]}; seri lain di tabel: ${result.series.slice(1).join(", ")}._`);
  }

  if (result.missing.length > 0) {
    const listed = result.missing.slice(0, 12).map((item) => `${item.province} (${item.reason})`);
    lines.push("");
    lines.push(`**Provinsi tanpa data kabupaten/kota:** ${listed.join("; ")}${result.missing.length > 12 ? "; …" : ""}`);
    lines.push(
      `_Untuk provinsi tersebut, TPT hanya tersedia level provinsi — gunakan get_ranking(level="provinsi") atau find_data._`
    );
  }

  return lines.join("\n");
}
