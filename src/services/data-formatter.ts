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

  const rows: FormattedRow[] = [];

  for (const [key, value] of Object.entries(datacontent)) {
    const row = resolveDatacontentKey(key, value, varMap, vervarMap, turvarMap, periodMap, turthMap);
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
 */
function resolveDatacontentKey(
  key: string,
  value: number | string,
  varMap: Map<string, BpsVariable>,
  vervarMap: Map<string, BpsVerticalVariable>,
  turvarMap: Map<string, BpsDerivedVariable>,
  periodMap: Map<string, BpsPeriod>,
  turthMap: Map<string, BpsDerivedPeriod>
): FormattedRow | null {
  // Strategy: try to match known IDs from the metadata maps
  // The key is a concatenation, so we iterate possible splits

  let matchedVar: BpsVariable | undefined;
  let matchedVervar: BpsVerticalVariable | undefined;
  let matchedTurvar: BpsDerivedVariable | undefined;
  let matchedPeriod: BpsPeriod | undefined;
  let matchedTurth: BpsDerivedPeriod | undefined;

  // Try matching against known IDs
  for (const [id, v] of varMap) {
    if (key.includes(id)) {
      matchedVar = v;
      break;
    }
  }

  for (const [id, v] of vervarMap) {
    if (key.includes(id)) {
      matchedVervar = v;
      break;
    }
  }

  for (const [id, v] of turvarMap) {
    if (key.includes(id)) {
      matchedTurvar = v;
      break;
    }
  }

  for (const [id, v] of periodMap) {
    if (key.includes(id)) {
      matchedPeriod = v;
      break;
    }
  }

  for (const [id, v] of turthMap) {
    if (key.includes(id)) {
      matchedTurth = v;
      break;
    }
  }

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
