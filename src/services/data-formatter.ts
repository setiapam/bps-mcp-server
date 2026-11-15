import type { BpsDynamicDataResponse, BpsVariable, BpsVerticalVariable, BpsDerivedVariable, BpsPeriod, BpsDerivedPeriod } from "../client/types.js";
import {
  getPeriodId,
  getPeriodLabel,
  getTurthId,
  getTurthLabel,
  getTurvarId,
  getTurvarLabel,
  getVariableId,
  getVariableTitle,
  getVariableUnit,
  getVervarId,
  getVervarLabel,
  isNeutralPeriodLabel,
} from "../client/fields.js";
import { appendAttribution } from "./attribution.js";

interface FormattedRow {
  variable: string;
  verticalVariable?: string;
  derivedVariable?: string;
  period: string;
  derivedPeriod?: string;
  value: number | string;
  unit?: string;
}

/** One row of dynamic data, with every dimension named (JSON output). */
export interface StructuredRow {
  /** Indicator name, e.g. "Tingkat Pengangguran Terbuka (TPT) menurut Kabupaten/Kota". */
  indicator: string;
  /** Vertical variable label (region, sex, ...). */
  category?: string;
  /** Derived variable label (the series inside the table, e.g. "TPT"). */
  series?: string;
  /** Period label as published, e.g. "2026". */
  period: string;
  /** Derived period label, e.g. "Agustus" or "Semester 1". */
  subperiod?: string;
  value: number | string;
  unit?: string;
}

/**
 * Format BPS dynamic data response into human/LLM-readable text.
 *
 * BPS datacontent keys are concatenated IDs: {vervar}{var}{turvar}{th}
 * We resolve them using the metadata arrays in the response.
 */
export interface FormatDynamicDataOptions {
  /** Set false when the caller appends attribution once at the end. */
  includeAttribution?: boolean;
}

export function formatDynamicData(
  response: BpsDynamicDataResponse,
  domain: string,
  lang: "ind" | "eng" = "ind",
  options: FormatDynamicDataOptions = {}
): string {
  const finalize = (text: string): string =>
    options.includeAttribution === false ? text : appendAttribution(text, lang);

  const datacontent = response.datacontent;
  if (!datacontent || Object.keys(datacontent).length === 0) {
    return finalize(
      lang === "ind"
        ? "Tidak ada data yang ditemukan untuk parameter yang diberikan."
        : "No data found for the given parameters."
    );
  }

  // Build lookup maps (handles both list-style and data-style field names)
  const varMap = buildMap(response.var, (v) => [getVariableId(v), v]);
  const vervarMap = buildMap(response.vervar, (v) => [getVervarId(v), v]);
  const turvarMap = buildMap(response.turvar, (v) => [getTurvarId(v), v]);
  const periodMap = buildMap(response.tahun, (v) => [getPeriodId(v), v]);
  const turthMap = buildMap(response.turtahun, (v) => [getTurthId(v), v]);

  // Pre-sort keys longest-first (once) for efficient matching across all datacontent entries
  const varKeys = sortedKeys(varMap);
  const vervarKeys = sortedKeys(vervarMap);
  const turvarKeys = sortedKeys(turvarMap);
  const periodKeys = sortedKeys(periodMap);
  const turthKeys = sortedKeys(turthMap);

  const rows: FormattedRow[] = [];

  for (const [key, value] of Object.entries(datacontent)) {
    const row = resolveDatacontentKey(key, value, varMap, varKeys, vervarMap, vervarKeys, turvarMap, turvarKeys, periodMap, periodKeys, turthMap, turthKeys);
    if (row) rows.push(row);
  }

  if (rows.length === 0) {
    return finalize("Data tersedia tetapi tidak dapat di-parse.");
  }

  // Format as text table
  const lines: string[] = [];

  // Title from variables
  const varNames = [...new Set(rows.map((r) => r.variable))];
  if (varNames.length > 0) {
    lines.push(`## ${varNames.join(", ")}`);
    lines.push(`**Domain:** ${domain}`);
    lines.push("");
  }

  // Group by variable
  const grouped = new Map<string, FormattedRow[]>();
  for (const row of rows) {
    const key = row.variable;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  for (const [varName, varRows] of grouped) {
    if (grouped.size > 1) {
      lines.push(`### ${varName}`);
    }

    // Build a readable table
    const hasVervar = varRows.some((r) => r.verticalVariable && r.verticalVariable !== "Tidak ada");
    const hasTurvar = varRows.some((r) => r.derivedVariable && r.derivedVariable !== "Tidak ada");
    // Header
    const headers: string[] = [];
    if (hasVervar) headers.push("Kategori");
    headers.push("Periode");
    if (hasTurvar) headers.push("Turunan");
    headers.push("Nilai");

    lines.push("| " + headers.join(" | ") + " |");
    lines.push("| " + headers.map(() => "---").join(" | ") + " |");

    // Sort by year, preserving the API's order within a year (months/semesters).
    varRows.sort((a, b) => {
      const yearA = Number(a.period.match(/\d{4}/)?.[0] ?? 0);
      const yearB = Number(b.period.match(/\d{4}/)?.[0] ?? 0);
      if (yearA && yearB && yearA !== yearB) return yearA - yearB;
      return a.period.localeCompare(b.period);
    });

    const MAX_TABLE_ROWS = 150;
    const totalRows = varRows.length;
    let rowsToRender = varRows;
    let isTruncated = false;

    if (totalRows > MAX_TABLE_ROWS) {
      rowsToRender = varRows.slice(0, MAX_TABLE_ROWS);
      isTruncated = true;
    }

    for (const row of rowsToRender) {
      const cols: string[] = [];
      if (hasVervar) cols.push(row.verticalVariable ?? "-");
      const period = row.derivedPeriod && !isNeutralPeriodLabel(row.derivedPeriod)
        ? `${row.period} (${row.derivedPeriod})`
        : row.period;
      cols.push(period);
      if (hasTurvar) cols.push(row.derivedVariable ?? "-");
      cols.push(formatValue(row.value));
      lines.push("| " + cols.join(" | ") + " |");
    }

    if (isTruncated) {
      lines.push("");
      lines.push(
        lang === "ind"
          ? `_... [Menampilkan ${MAX_TABLE_ROWS} dari ${totalRows} baris. Data dipotong karena terlalu besar. Gunakan parameter 'year' atau filter wilayah/variabel lebih spesifik.]_`
          : `_... [Showing ${MAX_TABLE_ROWS} of ${totalRows} rows. Data truncated for size. Use 'year' parameter or more specific region/variable filters.]_`
      );
    }

    lines.push("");
  }

  // Unit info
  const units = [...new Set(rows.map((r) => r.unit).filter(Boolean))];
  if (units.length > 0) {
    lines.push(`**Satuan:** ${units.join(", ")}`);
  }

  // Freshness: agents otherwise present 4-year-old data as if it were current.
  const freshness = describeFreshness(rows);
  if (freshness) {
    lines.push("");
    lines.push(freshness);
  }

  return finalize(lines.join("\n"));
}

/** Latest period in the payload, with a warning when it is stale. */
function describeFreshness(rows: FormattedRow[]): string | null {
  const years = rows
    .map((row) => Number(row.period.match(/\d{4}/)?.[0] ?? 0))
    .filter((year) => year > 1900);
  if (years.length === 0) return null;

  const latest = Math.max(...years);
  const currentYear = new Date().getFullYear();
  const age = currentYear - latest;
  if (age <= 2) return null;

  return `_⚠️ Data terbaru untuk tabel ini adalah ${latest} (${age} tahun lalu); jangan disajikan sebagai data terkini._`;
}

/**
 * Flatten a dynamic-data response into named rows so consumers do not have to
 * parse markdown. Dimensions (category/series/subperiod) are resolved with the
 * same logic used by the markdown renderer.
 */
export function toStructuredRows(
  response: BpsDynamicDataResponse,
  _domain?: string
): StructuredRow[] {
  const varMap = buildMap(response.var, (v) => [getVariableId(v), v]);
  const vervarMap = buildMap(response.vervar, (v) => [getVervarId(v), v]);
  const turvarMap = buildMap(response.turvar, (v) => [getTurvarId(v), v]);
  const periodMap = buildMap(response.tahun, (v) => [getPeriodId(v), v]);
  const turthMap = buildMap(response.turtahun, (v) => [getTurthId(v), v]);

  const varKeys = sortedKeys(varMap);
  const vervarKeys = sortedKeys(vervarMap);
  const turvarKeys = sortedKeys(turvarMap);
  const periodKeys = sortedKeys(periodMap);
  const turthKeys = sortedKeys(turthMap);

  const rows: StructuredRow[] = [];
  for (const [key, value] of Object.entries(response.datacontent ?? {})) {
    const row = resolveDatacontentKey(
      key,
      value,
      varMap,
      varKeys,
      vervarMap,
      vervarKeys,
      turvarMap,
      turvarKeys,
      periodMap,
      periodKeys,
      turthMap,
      turthKeys
    );
    if (!row) continue;
    const series = row.derivedVariable && !/^tidak ada$/i.test(row.derivedVariable.trim())
      ? row.derivedVariable
      : undefined;
    const subperiod = isNeutralPeriodLabel(row.derivedPeriod) ? undefined : row.derivedPeriod;
    rows.push({
      indicator: row.variable,
      category: row.verticalVariable,
      series,
      period: row.period,
      subperiod,
      value: row.value,
      unit: row.unit,
    });
  }
  return rows;
}

/** Attach the domain to structured rows for JSON responses. */
export function buildStructuredPayload(
  response: BpsDynamicDataResponse,
  domain: string
): {
  domain: string;
  rows: StructuredRow[];
  units: string[];
  note?: string;
} {
  const rows = toStructuredRows(response, domain);
  const units = [...new Set(rows.map((row) => row.unit).filter((unit): unit is string => !!unit))];
  const freshness = describeFreshness(
    rows.map((row) => ({
      variable: row.indicator,
      period: row.period,
      value: row.value,
      unit: row.unit,
    }))
  );
  return {
    domain,
    rows,
    units,
    note: freshness ? freshness.replace(/^_|_$/g, "") : undefined,
  };
}

/**
 * Try to resolve a datacontent key into labeled row.
 * BPS key format: {vervar}{var_id}{turvar}{period}{trailing}
 * We use positional stripping: remove known var/period/turvar IDs to isolate vervar.
 */
function resolveDatacontentKey(
  key: string,
  value: number | string,
  varMap: Map<string, BpsVariable>,
  varKeys: string[],
  vervarMap: Map<string, BpsVerticalVariable>,
  vervarKeys: string[],
  turvarMap: Map<string, BpsDerivedVariable>,
  turvarKeys: string[],
  periodMap: Map<string, BpsPeriod>,
  periodKeys: string[],
  turthMap: Map<string, BpsDerivedPeriod>,
  turthKeys: string[]
): FormattedRow | null {
  // Strategy: strip known IDs from key to isolate vervar
  // Key format: {vervar}{var_id}{turvar?}{period}{trailing?}
  const remaining = key;
  let matchedVar: BpsVariable | undefined;
  let matchedPeriod: BpsPeriod | undefined;
  let matchedTurvar: BpsDerivedVariable | undefined;
  let matchedVervar: BpsVerticalVariable | undefined;
  let matchedTurth: BpsDerivedPeriod | undefined;

  // 1. Find and remove var_id (usually in the middle)
  for (const vid of varKeys) {
    const idx = remaining.indexOf(vid);
    if (idx > 0) { // vervar is before var_id, so idx must be > 0
      matchedVar = varMap.get(vid);
      const beforeVar = remaining.slice(0, idx);
      const afterVar = remaining.slice(idx + vid.length);

      // 2. Match vervar from the prefix (before var_id)
      matchedVervar = vervarMap.get(beforeVar);
      if (!matchedVervar) {
        // Try longest match in prefix
        for (const vk of vervarKeys) {
          if (beforeVar === vk || beforeVar.endsWith(vk) || beforeVar.startsWith(vk)) {
            matchedVervar = vervarMap.get(vk);
            if (matchedVervar) break;
          }
        }
      }

      // 3. Match period, turvar, and turth from the suffix (after var_id).
      // The key is {vervar}{var}{turvar}{period}{turth}; matching by
      // `includes()` is ambiguous (e.g. month "1" vs "12"), so split at the
      // period and read the trailing turth exactly.
      let periodKey = "";
      let periodIndex = -1;
      for (const pk of periodKeys) {
        const idx = afterVar.lastIndexOf(pk);
        if (idx >= 0) {
          periodKey = pk;
          periodIndex = idx;
          matchedPeriod = periodMap.get(pk);
          break;
        }
      }

      if (matchedPeriod) {
        const turvarPart = afterVar.slice(0, periodIndex);
        const turthPart = afterVar.slice(periodIndex + periodKey.length);
        matchedTurvar =
          turvarMap.get(turvarPart) ??
          findLongestMatch(turvarPart, turvarMap, turvarKeys);
        matchedTurth =
          turthMap.get(turthPart) ??
          findLongestMatch(turthPart, turthMap, turthKeys);
      } else {
        matchedTurvar = findLongestMatch(afterVar, turvarMap, turvarKeys);
        matchedTurth = findLongestMatch(afterVar, turthMap, turthKeys);
      }
      break;
    }
  }

  // Fallback: if positional matching failed, use original substring matching
  if (!matchedVar) matchedVar = findLongestMatch(key, varMap, varKeys);
  if (!matchedVervar) matchedVervar = findLongestMatch(key, vervarMap, vervarKeys);
  if (!matchedPeriod) matchedPeriod = findLongestMatch(key, periodMap, periodKeys);
  if (!matchedTurvar) matchedTurvar = findLongestMatch(key, turvarMap, turvarKeys);
  if (!matchedTurth) matchedTurth = findLongestMatch(key, turthMap, turthKeys);

  return {
    variable: getVariableTitle(matchedVar) || "Data",
    verticalVariable: getVervarLabel(matchedVervar) || undefined,
    derivedVariable: getTurvarLabel(matchedTurvar) || undefined,
    period: getPeriodLabel(matchedPeriod) || "N/A",
    derivedPeriod: getTurthLabel(matchedTurth) || undefined,
    value,
    unit: getVariableUnit(matchedVar),
  };
}

/**
 * Get map keys sorted by length (longest first).
 * Longer IDs are checked first to avoid false matches with shorter IDs.
 */
function sortedKeys<T>(map: Map<string, T>): string[] {
  return [...map.keys()].sort((a, b) => b.length - a.length);
}

/**
 * Find the longest key in the map that is a substring of the target,
 * using a pre-sorted key array for efficiency.
 */
function findLongestMatch<T>(target: string, map: Map<string, T>, keys: string[]): T | undefined {
  for (const id of keys) {
    if (target.includes(id)) {
      return map.get(id);
    }
  }
  return undefined;
}

function buildMap<T, K extends string>(
  items: T[] | undefined,
  keyFn: (item: T) => [K, T]
): Map<K, T> {
  const map = new Map<K, T>();
  if (items) {
    for (const item of items) {
      const [key, val] = keyFn(item);
      if (!key) continue;
      map.set(key, val);
    }
  }
  return map;
}

function formatValue(value: number | string): string {
  if (typeof value === "number") {
    return value.toLocaleString("id-ID");
  }
  return String(value);
}

/**
 * Format a simple list of items into readable text.
 */
export function formatList<T>(
  items: T[],
  formatter: (item: T) => string,
  title: string,
  lang: "ind" | "eng" = "ind"
): string {
  if (items.length === 0) {
    return appendAttribution(
      lang === "ind"
        ? `Tidak ada ${title.toLowerCase()} yang ditemukan.`
        : `No ${title.toLowerCase()} found.`,
      lang
    );
  }

  const lines = [`## ${title}`, "", ...items.map((item, i) => `${i + 1}. ${formatter(item)}`), ""];
  return appendAttribution(lines.join("\n"), lang);
}
