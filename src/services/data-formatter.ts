import type { BpsDynamicDataResponse, BpsVariable, BpsVerticalVariable, BpsDerivedVariable, BpsPeriod, BpsDerivedPeriod } from "../client/types.js";
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

/**
 * Format BPS dynamic data response into human/LLM-readable text.
 *
 * BPS datacontent keys are concatenated IDs: {vervar}{var}{turvar}{th}
 * We resolve them using the metadata arrays in the response.
 */
export function formatDynamicData(
  response: BpsDynamicDataResponse,
  domain: string,
  lang: "ind" | "eng" = "ind"
): string {
  const datacontent = response.datacontent;
  if (!datacontent || Object.keys(datacontent).length === 0) {
    return appendAttribution(
      lang === "ind"
        ? "Tidak ada data yang ditemukan untuk parameter yang diberikan."
        : "No data found for the given parameters.",
      lang
    );
  }

  // Build lookup maps
  const varMap = buildMap(response.var, (v) => [String(v.var_id), v]);
  const vervarMap = buildMap(response.vervar, (v) => [String(v.kode_vervar), v]);
  const turvarMap = buildMap(response.turvar, (v) => [String(v.kode_turvar), v]);
  const periodMap = buildMap(response.tahun, (v) => [String(v.th_id), v]);
  const turthMap = buildMap(response.turtahun, (v) => [String(v.turth_id), v]);

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
    return appendAttribution("Data tersedia tetapi tidak dapat di-parse.", lang);
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
    const hasVervar = varRows.some((r) => r.verticalVariable);
    const hasTurvar = varRows.some((r) => r.derivedVariable);

    // Header
    const headers: string[] = [];
    if (hasVervar) headers.push("Kategori");
    headers.push("Periode");
    if (hasTurvar) headers.push("Turunan");
    headers.push("Nilai");

    lines.push("| " + headers.join(" | ") + " |");
    lines.push("| " + headers.map(() => "---").join(" | ") + " |");

    // Sort rows by period
    varRows.sort((a, b) => a.period.localeCompare(b.period));

    for (const row of varRows) {
      const cols: string[] = [];
      if (hasVervar) cols.push(row.verticalVariable ?? "-");
      cols.push(row.period);
      if (hasTurvar) cols.push(row.derivedVariable ?? "-");
      cols.push(formatValue(row.value));
      lines.push("| " + cols.join(" | ") + " |");
    }

    lines.push("");
  }

  // Unit info
  const units = [...new Set(rows.map((r) => r.unit).filter(Boolean))];
  if (units.length > 0) {
    lines.push(`**Satuan:** ${units.join(", ")}`);
  }

  return appendAttribution(lines.join("\n"), lang);
}

/**
 * Try to resolve a datacontent key into labeled row.
 * BPS key format is typically concatenated numeric IDs.
 * IDs are matched longest-first to avoid partial matches of shorter IDs.
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
  // Match using pre-sorted (longest-first) keys for each map
  const matchedVar = findLongestMatch(key, varMap, varKeys);
  const matchedVervar = findLongestMatch(key, vervarMap, vervarKeys);
  const matchedTurvar = findLongestMatch(key, turvarMap, turvarKeys);
  const matchedPeriod = findLongestMatch(key, periodMap, periodKeys);
  const matchedTurth = findLongestMatch(key, turthMap, turthKeys);

  return {
    variable: matchedVar?.title ?? "Data",
    verticalVariable: matchedVervar?.label_vervar,
    derivedVariable: matchedTurvar?.label_turvar,
    period: matchedPeriod?.th_name ?? "N/A",
    derivedPeriod: matchedTurth?.turth_name,
    value,
    unit: matchedVar?.unit,
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
