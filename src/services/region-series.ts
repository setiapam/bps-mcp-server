import type { BpsClient } from "../client/bps-client.js";
import type { BpsDynamicDataResponse } from "../client/types.js";
import type { IPersistentStore } from "./persistent-store.js";
import { resolveVariableForYears, searchVariables } from "./variable-search.js";
import { extractVervarId, getVervarEntries, selectAggregateTurvar } from "./dynamic-data-utils.js";
import { resolvePeriodsForSpec } from "./period-resolver.js";
import {
  getPeriodId,
  getPeriodLabel,
  getTurthId,
  getTurthLabel,
  getTurvarId,
  getVariableId,
  getVariableTitle,
  getVariableUnit,
  isNeutralPeriodLabel,
} from "../client/fields.js";

/**
 * Builds one comparable series (year → value) for a region.
 *
 * BPS provincial domains reuse national tables whose only row is "Indonesia",
 * so "kemiskinan Jawa Timur" used to answer with the national number. Candidates
 * are therefore accepted only when they actually contain a row for the region,
 * and the candidate with the widest year coverage wins.
 */

export function normalizeRegionLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(provinsi|propinsi|prov|kabupaten|kab|kota|administrasi)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pick the vervar id that represents the requested region. */
export function pickRegionVervarId(
  response: BpsDynamicDataResponse,
  domain: string,
  domainName?: string
): string | null {
  const entries = getVervarEntries(response);
  if (entries.length === 0) return null;

  const combined = entries.find((entry) =>
    /^(kota\s*\+\s*desa|perkotaan\s*\+\s*perdesaan|total|jumlah|semua|nasional)$/i.test(entry.label.trim())
  );

  if (domain === "0000") {
    const indonesia = entries.find((entry) => /\bindonesia\b/i.test(entry.label));
    if (indonesia) return indonesia.id;
    if (combined) return combined.id;
    return entries.length === 1 ? entries[0].id : null;
  }

  const target = domainName ? normalizeRegionLabel(domainName) : "";
  if (target) {
    const exact = entries.find((entry) => normalizeRegionLabel(entry.label) === target);
    if (exact) return exact.id;
  }

  const byId =
    entries.find((entry) => entry.id === domain) ??
    entries.find((entry) => entry.id === `${domain.slice(0, 2)}99`) ??
    entries.find((entry) => entry.id === `${domain.slice(0, 4)}0`);
  if (byId) return byId.id;

  if (target) {
    const contains = entries.find((entry) => {
      const normalized = normalizeRegionLabel(entry.label);
      return normalized.length > 2 && (normalized.includes(target) || target.includes(normalized));
    });
    if (contains) return contains.id;
  }

  return combined?.id ?? null;
}

export function hasRegionRow(
  response: BpsDynamicDataResponse,
  domain: string,
  domainName?: string
): boolean {
  const vervarId = pickRegionVervarId(response, domain, domainName);
  if (!vervarId) return false;
  return Object.entries(response.datacontent ?? {}).some(
    ([key, value]) => typeof value === "number" && extractVervarId(key, response) === vervarId
  );
}

interface KeyParts {
  vervarId: string | null;
  turvarId: string | null;
  rest: string;
}

function stripKeyPrefixes(key: string, response: BpsDynamicDataResponse): KeyParts {
  const vervarId = extractVervarId(key, response);
  let rest = vervarId ? key.slice(vervarId.length) : key;

  const varIds = (response.var ?? [])
    .map((variable) => getVariableId(variable))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const matchedVar = varIds.find((id) => rest.startsWith(id));
  if (matchedVar) rest = rest.slice(matchedVar.length);

  const turvarIds = (response.turvar ?? [])
    .map((turvar) => getTurvarId(turvar))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const matchedTurvar = turvarIds.find((id) => rest.startsWith(id));
  if (matchedTurvar) rest = rest.slice(matchedTurvar.length);

  return { vervarId, turvarId: matchedTurvar ?? null, rest };
}

function pickValueForPeriod(
  response: BpsDynamicDataResponse,
  vervarId: string,
  periodId: string,
  turthId: string | null
): number | null {
  const aggregateTurvar = selectAggregateTurvar(response);
  const suffixes = turthId
    ? [`${periodId}${turthId}`, `${turthId}${periodId}`]
    : [periodId];

  for (const [key, raw] of Object.entries(response.datacontent ?? {})) {
    if (typeof raw !== "number") continue;
    const parts = stripKeyPrefixes(key, response);
    if (parts.vervarId !== vervarId && !key.startsWith(vervarId)) continue;
    if (!suffixes.includes(parts.rest)) continue;
    if (aggregateTurvar && parts.turvarId !== aggregateTurvar) continue;
    return raw;
  }
  return null;
}

/** Choose the series (turtahun) with the best coverage, preferring annual/Maret. */
function selectSeriesTurth(
  response: BpsDynamicDataResponse,
  periodIds: string[]
): { id: string; label: string } | null {
  const entries = (response.turtahun ?? [])
    .map((turth) => ({ id: getTurthId(turth), label: getTurthLabel(turth) }))
    .filter((entry) => entry.id !== "");
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0];

  const coverages = entries.map((entry) => {
    const keys = Object.keys(response.datacontent ?? {});
    const coverage = periodIds.filter((periodId) =>
      keys.some((key) => {
        const parts = stripKeyPrefixes(key, response);
        return parts.rest === `${periodId}${entry.id}` || parts.rest === `${entry.id}${periodId}`;
      })
    ).length;
    return { entry, coverage };
  });

  const withData = coverages.filter((item) => item.coverage > 0);
  if (withData.length === 0) return entries[0];

  const bestCoverage = Math.max(...withData.map((item) => item.coverage));
  const best = withData.filter((item) => item.coverage === bestCoverage).map((item) => item.entry);

  return (
    best.find((entry) => isNeutralPeriodLabel(entry.label)) ??
    best.find((entry) => /semester\s*1|maret/i.test(entry.label)) ??
    best.find((entry) => /desember/i.test(entry.label)) ??
    best[0]
  );
}

export interface SeriesPoint {
  id: string;
  label: string;
  year: string;
  value: number;
}

export interface RegionSeries {
  region: string;
  domain: string;
  domainName: string;
  varId: number | null;
  varTitle: string;
  unit?: string;
  seriesLabel?: string;
  points: SeriesPoint[];
  missingYears: string[];
  availableYears: string[];
  notes: string[];
}

export interface BuildSeriesOptions {
  years: string[];
  /** How many candidate variables to try before giving up. */
  maxCandidates?: number;
}

export async function buildRegionSeries(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  region: string,
  domain: string,
  domainName: string,
  options: BuildSeriesOptions
): Promise<RegionSeries> {
  const years = options.years;
  const notes: string[] = [];
  const base: RegionSeries = {
    region,
    domain,
    domainName,
    varId: null,
    varTitle: query,
    points: [],
    missingYears: years,
    availableYears: [],
    notes,
  };

  let resolved;
  try {
    resolved = await resolveVariableForYears(client, store, query, domain, years, {
      maxCandidates: 20,
    });
  } catch {
    resolved = null;
  }

  const queue: Array<{ var_id: number; title: string; sub_name: string; unit?: string }> = [];
  const push = (candidate: { var_id: number; title: string; sub_name: string; unit?: string } | null) => {
    if (!candidate || queue.some((entry) => entry.var_id === candidate.var_id)) return;
    queue.push(candidate);
  };
  push(resolved?.varData ?? null);
  for (const candidate of resolved?.candidates ?? []) push(candidate);

  // "jumlah penduduk miskin" must not answer with a percentage just because the
  // rate table happened to rank first. Stable-sort by amount/rate fit.
  const wantsAmount = /\bjumlah\b|\btotal\b|\bjiwa\b|\borang\b/.test(query.toLowerCase());
  const wantsRate = /\bpersentase\b|\bpersen\b|%|\btingkat\b/.test(query.toLowerCase());
  const fit = (candidate: { title?: string; unit?: string }): number => {
    const title = (candidate.title ?? "").toLowerCase();
    const unit = (candidate.unit ?? "").toLowerCase();
    let score = 0;
    if (wantsAmount) {
      if (title.includes("jumlah") || title.includes("total")) score += 2;
      if (title.includes("persentase")) score -= 2;
      if (unit.includes("persen")) score -= 1;
      if (/jiwa|orang/.test(unit)) score += 1;
    }
    if (wantsRate) {
      if (title.includes("persentase") || unit.includes("persen")) score += 2;
      if (title.includes("jumlah")) score -= 1;
    }
    return score;
  };
  queue.sort((a, b) => fit(b) - fit(a));

  if (queue.length === 0) {
    notes.push(`Tidak ditemukan variabel untuk "${query}".`);
    return base;
  }

  let best: RegionSeries | null = null;
  const maxCandidates = Math.max(1, options.maxCandidates ?? 5);
  let rejectedWithoutRegionRow = 0;

  for (const candidate of queue.slice(0, maxCandidates)) {
    const title = getVariableTitle(candidate) || candidate.title;
    let periods;
    try {
      periods = await resolvePeriodsForSpec(
        client,
        domain,
        candidate.var_id,
        years.length > 0 ? years.join(",") : undefined
      );
    } catch {
      continue;
    }
    if (periods.entries.length === 0) continue;

    const periodIds = periods.entries.map((entry) => entry.id);
    let response: BpsDynamicDataResponse;
    try {
      response = await client.getDynamicData(domain, String(candidate.var_id), periodIds.join(";"));
    } catch {
      continue;
    }
    if (!response?.datacontent || Object.keys(response.datacontent).length === 0) continue;

    const vervarId = pickRegionVervarId(response, domain, domainName);
    if (!vervarId) {
      rejectedWithoutRegionRow++;
      continue;
    }
    if (!hasRegionRow(response, domain, domainName)) {
      rejectedWithoutRegionRow++;
      continue;
    }

    const turth = selectSeriesTurth(response, periodIds);
    const points: SeriesPoint[] = [];
    for (const entry of periods.entries) {
      const value = pickValueForPeriod(response, vervarId, entry.id, turth?.id ?? null);
      if (value === null) continue;
      points.push({
        id: entry.id,
        label: entry.label,
        year: entry.year ?? entry.label.match(/\d{4}/)?.[0] ?? entry.label,
        value,
      });
    }
    if (points.length === 0) continue;

    points.sort((a, b) => a.label.localeCompare(b.label, "id", { numeric: true }));
    const candidateSeries: RegionSeries = {
      region,
      domain,
      domainName,
      varId: candidate.var_id,
      varTitle: title,
      unit: getVariableUnit(candidate) ?? candidate.unit,
      seriesLabel: turth && !isNeutralPeriodLabel(turth.label) ? turth.label : undefined,
      points,
      missingYears: years.filter((year) => !points.some((point) => point.year === year)),
      availableYears: periods.availableYears,
      notes,
    };

    if (!best || candidateSeries.points.length > best.points.length) best = candidateSeries;
    if (best.points.length === years.length && years.length > 0) break;
  }

  if (!best) {
    if (rejectedWithoutRegionRow > 0) {
      notes.push(
        `Variabel yang ditemukan hanya berisi angka nasional/agregat lain, bukan baris ${region}.`
      );
    }
    return base;
  }

  if (best.missingYears.length > 0 && best.missingYears.length < years.length) {
    notes.push(`Tahun ${best.missingYears.join(", ")} tidak tersedia.`);
  }
  return best;
}

/** List all periods for a variable (used for diagnostics in error messages). */
export async function listPeriodLabels(
  client: BpsClient,
  domain: string,
  varId: number
): Promise<Array<{ id: string; label: string }>> {
  try {
    const periods = await resolvePeriodsForSpec(client, domain, varId, undefined);
    return periods.entries.map((entry) => ({ id: entry.id, label: entry.label }));
  } catch {
    return [];
  }
}

export { getPeriodId, getPeriodLabel };

/** BPS often puts the unit in the title, e.g. "Jumlah Penduduk Miskin (Ribu Jiwa)". */
function unitFromTitle(title: string): string | undefined {
  const match = title.match(/\(([^)]*(?:jiwa|orang|persen|rupiah|hektar|ton|liter)[^)]*)\)/i);
  return match?.[1]?.trim();
}

export interface NationalBreakdown {
  varId: number;
  varTitle: string;
  unit?: string;
  seriesLabel?: string;
  byRegion: Map<string, SeriesPoint[]>;
}

/**
 * One national table (e.g. "Jumlah Penduduk Miskin Menurut Provinsi", var 185)
 * already carries every province with a consistent unit and precision. Using it
 * for a province comparison costs ONE request instead of one per province and
 * avoids "Ribu Jiwa" vs "Juta Jiwa" mixes.
 */
export async function buildNationalBreakdown(
  client: BpsClient,
  query: string,
  regions: Array<{ name: string; domainName: string }>,
  years: string[]
): Promise<NationalBreakdown | null> {
  if (regions.length === 0) return null;

  let candidates;
  try {
    candidates = await searchVariables(client, "0000", query, { maxCandidates: 20 });
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  const wantsAmount = /\bjumlah\b|\btotal\b|\bjiwa\b|\borang\b/.test(query.toLowerCase());
  const wantsRate = /\bpersentase\b|\bpersen\b|%|\btingkat\b/.test(query.toLowerCase());
  const fit = (title: string, unit?: string): number => {
    const t = title.toLowerCase();
    const u = (unit ?? "").toLowerCase();
    // A province-level table is what we need here, and it is also the cheapest
    // (one request covers every region).
    let score = /provinsi/i.test(t) ? 3 : 0;
    if (wantsAmount) {
      if (t.includes("jumlah") || t.includes("total")) score += 2;
      if (t.includes("persentase")) score -= 2;
      if (u.includes("persen")) score -= 1;
      if (/jiwa|orang/.test(u)) score += 1;
    }
    if (wantsRate) {
      if (t.includes("persentase") || u.includes("persen")) score += 2;
      if (t.includes("jumlah")) score -= 1;
    }
    return score;
  };

  const ordered = [...candidates]
    .filter((candidate) => !/kabupaten|kecamatan|kelurahan|desa/i.test(candidate.title))
    .sort((a, b) => fit(b.title, b.unit) - fit(a.title, a.unit));

  for (const candidate of ordered.slice(0, 5)) {
    let periods;
    try {
      periods = await resolvePeriodsForSpec(
        client,
        "0000",
        candidate.var_id,
        years.length > 0 ? years.join(",") : undefined
      );
    } catch {
      continue;
    }
    if (periods.entries.length === 0) continue;

    const periodIds = periods.entries.map((entry) => entry.id);
    let response: BpsDynamicDataResponse;
    try {
      response = await client.getDynamicData("0000", String(candidate.var_id), periodIds.join(";"));
    } catch {
      continue;
    }

    const vervarEntries = getVervarEntries(response);
    if (vervarEntries.length === 0 || vervarEntries.length > 40) continue;

    const byRegion = new Map<string, SeriesPoint[]>();
    const turth = selectSeriesTurth(response, periodIds);
    let allMatched = true;

    for (const region of regions) {
      const target = normalizeRegionLabel(region.domainName || region.name);
      const match =
        vervarEntries.find((entry) => normalizeRegionLabel(entry.label) === target) ??
        vervarEntries.find((entry) => {
          const normalized = normalizeRegionLabel(entry.label);
          return normalized.length > 2 && (normalized.includes(target) || target.includes(normalized));
        });
      if (!match) {
        allMatched = false;
        break;
      }
      const points: SeriesPoint[] = [];
      for (const entry of periods.entries) {
        const value = pickValueForPeriod(response, match.id, entry.id, turth?.id ?? null);
        if (value === null) continue;
        points.push({
          id: entry.id,
          label: entry.label,
          year: entry.year ?? entry.label.match(/\d{4}/)?.[0] ?? entry.label,
          value,
        });
      }
      if (points.length === 0) {
        allMatched = false;
        break;
      }
      points.sort((a, b) => a.label.localeCompare(b.label, "id", { numeric: true }));
      byRegion.set(region.domainName || region.name, points);
    }

    if (!allMatched) continue;

    return {
      varId: candidate.var_id,
      varTitle: candidate.title,
      unit: candidate.unit ?? unitFromTitle(candidate.title),
      seriesLabel: turth && !isNeutralPeriodLabel(turth.label) ? turth.label : undefined,
      byRegion,
    };
  }

  return null;
}
