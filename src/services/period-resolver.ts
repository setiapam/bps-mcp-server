import type { BpsClient } from "../client/bps-client.js";
import type { BpsPeriod } from "../client/types.js";
import { getPeriodId, getPeriodLabel, isNeutralPeriodLabel } from "../client/fields.js";

/**
 * BPS' WebAPI only accepts period *IDs* (`th`) — never years. Agents naturally
 * pass "2021,2022" or "2021-2025", which the API silently answers with an empty
 * dataset. This module maps human year specs to period IDs so no caller has to
 * call `list_periods` first.
 */

const YEAR_PATTERN = /^(19|20)\d{2}$/;

export interface YearSpec {
  /** True when the caller supplied anything at all. */
  hasSpec: boolean;
  /** Years requested, ascending. */
  years: string[];
  /** Tokens that are not years (assumed to be raw period IDs). */
  periodIds: string[];
}

/** Parse "2021,2022", "2021;2022", "2021-2025", "2021 s.d. 2025" or raw IDs. */
export function parseYearSpec(spec?: string | null): YearSpec {
  if (!spec || !spec.trim()) return { hasSpec: false, years: [], periodIds: [] };

  // Normalize word-based ranges ("2021 s.d. 2023", "2021 sampai 2023") so the
  // whitespace split below does not separate the endpoints.
  const normalizedSpec = spec.replace(
    /((?:19|20)\d{2})\s*(?:s\.?\s*d\.?|sampai|hingga|to)\s*((?:19|20)\d{2})/gi,
    "$1-$2"
  );

  const tokens = normalizedSpec
    .split(/[,;|]+|\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const years = new Set<string>();
  const periodIds = new Set<string>();

  for (const token of tokens) {
    const range = token.match(
      /^((?:19|20)\d{2})\s*(?:-|–|—|s\.?\s*d\.?|sampai|hingga|to)\s*((?:19|20)\d{2})$/i
    );
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 60) {
        for (let year = start; year <= end; year++) years.add(String(year));
      }
      continue;
    }
    if (YEAR_PATTERN.test(token)) {
      years.add(token);
      continue;
    }
    periodIds.add(token);
  }

  return { hasSpec: true, years: [...years].sort(), periodIds: [...periodIds] };
}

/**
 * Prefer a comparable series across years: annual > first semester (Maret) >
 * second semester (September) > anything else.
 */
function periodPreference(label: string): number {
  // A bare year (or "Tahunan") is the annual series — the best comparable one.
  if (/^\s*(19|20)\d{2}\s*$/.test(label)) return 5;
  if (isNeutralPeriodLabel(label)) return 4;
  if (/semester\s*1|maret|triwulan\s*(i{1}|1)\b|kwartal\s*1/i.test(label)) return 3;
  if (/semester\s*2|september/i.test(label)) return 2;
  if (/desember|desember|december/i.test(label)) return 1.5;
  return 1;
}

export interface ResolvedPeriodEntry {
  id: string;
  label: string;
  year?: string;
}

export interface ResolvedPeriodsForSpec {
  hasSpec: boolean;
  entries: ResolvedPeriodEntry[];
  missingYears: string[];
  /** Years the variable actually has data for, ascending. */
  availableYears: string[];
  /** Up to 12 recent period labels, for error messages. */
  availableLabels: string[];
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

export async function resolvePeriodsForSpec(
  client: BpsClient,
  domain: string,
  varId: number,
  spec?: string | null
): Promise<ResolvedPeriodsForSpec> {
  const parsed = parseYearSpec(spec);
  const periods = await listAllPeriodsSafe(client, domain, varId);
  const labels = periods
    .map((period) => ({ id: getPeriodId(period), label: getPeriodLabel(period) }))
    .filter((entry) => entry.id !== "");

  const availableYears = [
    ...new Set(
      labels
        .map((entry) => entry.label.match(/\d{4}/)?.[0])
        .filter((year): year is string => Boolean(year))
    ),
  ].sort();

  const availableLabels = [...labels]
    .sort((a, b) => a.label.localeCompare(b.label, "id", { numeric: true }))
    .reverse()
    .slice(0, 12)
    .map((entry) => entry.label);

  if (!parsed.hasSpec) {
    const latest = [...labels].sort((a, b) =>
      a.label.localeCompare(b.label, "id", { numeric: true })
    ).pop();
    return {
      hasSpec: false,
      entries: latest ? [{ id: latest.id, label: latest.label, year: latest.label.match(/\d{4}/)?.[0] }] : [],
      missingYears: [],
      availableYears,
      availableLabels,
    };
  }

  const entries: ResolvedPeriodEntry[] = [];
  const seen = new Set<string>();

  for (const id of parsed.periodIds) {
    const match = labels.find((entry) => entry.id === id);
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      entries.push({ id: match.id, label: match.label, year: match.label.match(/\d{4}/)?.[0] });
    }
  }

  const missingYears: string[] = [];
  for (const year of parsed.years) {
    const candidates = labels.filter((entry) => entry.label.includes(year));
    if (candidates.length === 0) {
      missingYears.push(year);
      continue;
    }
    const best = [...candidates].sort(
      (a, b) =>
        periodPreference(b.label) - periodPreference(a.label) ||
        a.label.localeCompare(b.label, "id", { numeric: true })
    )[0];
    if (seen.has(best.id)) continue;
    seen.add(best.id);
    entries.push({ id: best.id, label: best.label, year });
  }

  return {
    hasSpec: true,
    entries,
    missingYears,
    availableYears,
    availableLabels,
  };
}

/** Human readable note about years that had no data. */
export function describeMissingYears(missing: string[], available: string[]): string {
  if (missing.length === 0) return "";
  const availableNote = available.length > 0
    ? ` Tahun yang tersedia: ${available.join(", ")}.`
    : "";
  return `Tahun ${missing.join(", ")} tidak tersedia untuk variabel ini.${availableNote}`;
}
