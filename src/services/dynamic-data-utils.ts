import type { BpsDynamicDataResponse } from "../client/types.js";
import {
  getTurvarId,
  getTurvarLabel,
  getVariableId,
  getVervarId,
  getVervarLabel,
} from "../client/fields.js";

export interface VervarEntry {
  id: string;
  label: string;
}

export function getVervarEntries(response: BpsDynamicDataResponse): VervarEntry[] {
  return (response.vervar ?? [])
    .map((vervar) => ({ id: getVervarId(vervar), label: getVervarLabel(vervar) }))
    .filter((entry) => entry.id !== "");
}

/**
 * Pick the aggregate row for a response.
 * Examples: INDONESIA (9999), Kota+Desa (poverty), or the domain's own
 * province/city when the data is a national table queried for a region.
 */
export function selectAggregateVervar(
  response: BpsDynamicDataResponse,
  domain: string,
  domainName?: string
): string | null {
  const entries = getVervarEntries(response);
  if (entries.length === 0) return null;

  const indonesia = entries.find((entry) => /\bindonesia\b/i.test(entry.label));
  if (indonesia) return indonesia.id;

  const combined = entries.find((entry) =>
    /^(kota\s*\+\s*desa|total|jumlah|nasional|semua)$/i.test(entry.label.trim())
  );
  if (combined) return combined.id;

  if (domain !== "0000") {
    const exact = entries.find(
      (entry) =>
        entry.id === domain ||
        (domainName !== undefined && entry.label.trim().toLowerCase() === domainName.trim().toLowerCase())
    );
    if (exact) return exact.id;

    const provinceLike = entries.find(
      (entry) => entry.id === `${domain.slice(0, 2)}99` || entry.id === `${domain.slice(0, 4)}0`
    );
    if (provinceLike) return provinceLike.id;

    if (entries.length === 1) return entries[0].id;
  }

  return null;
}

/**
 * Find the vervar id at the start of a datacontent key.
 * Prefer the longest known id so "3" does not swallow a "30" category.
 */
export function extractVervarId(key: string, response: BpsDynamicDataResponse): string | null {
  const ids = getVervarEntries(response).map((entry) => entry.id).sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (key.startsWith(id)) return id;
  }
  return null;
}

/**
 * Keep every category when the breakdown is small and meaningful (e.g.
 * Kota/Desa/Kota+Desa), but collapse large region breakdowns to the aggregate
 * so `find_data` does not dump hundreds of kabupaten rows.
 */
export function filterRelevantVervar(
  response: BpsDynamicDataResponse,
  domain: string,
  domainName?: string,
  maxCategories = 10
): BpsDynamicDataResponse {
  const entries = getVervarEntries(response);
  if (entries.length <= maxCategories) return response;

  const aggregate = selectAggregateVervar(response, domain, domainName);
  if (!aggregate) return response;

  const datacontent = response.datacontent ?? {};
  const filtered = Object.fromEntries(
    Object.entries(datacontent).filter(([key]) => extractVervarId(key, response) === aggregate)
  );
  if (Object.keys(filtered).length === 0) return response;

  return {
    ...response,
    datacontent: filtered,
    vervar: (response.vervar ?? []).filter((vervar) => getVervarId(vervar) === aggregate),
  };
}

function getTurvarEntries(response: BpsDynamicDataResponse): VervarEntry[] {
  return (response.turvar ?? [])
    .map((turvar) => ({ id: getTurvarId(turvar), label: getTurvarLabel(turvar) }))
    .filter((entry) => entry.id !== "");
}

/** Pick the combined derived-variable row (e.g. "Perkotaan + Perdesaan"). */
export function selectAggregateTurvar(response: BpsDynamicDataResponse): string | null {
  const entries = getTurvarEntries(response);
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].id;

  const combined = entries.find((entry) =>
    /perkotaan\s*\+\s*perdesaan|perdesaan\s*\+\s*perkotaan|^(total|jumlah|semua)$/i.test(entry.label.trim())
  );
  return combined?.id ?? null;
}

/**
 * Find the derived-variable id inside a datacontent key by stripping the
 * vervar and variable prefixes (avoids "1" matching "12").
 */
export function extractTurvarId(key: string, response: BpsDynamicDataResponse): string | null {
  const vervarId = extractVervarId(key, response);
  let rest = vervarId ? key.slice(vervarId.length) : key;

  const varIds = (response.var ?? [])
    .map((variable) => getVariableId(variable))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const varId = varIds.find((id) => rest.startsWith(id));
  if (varId) rest = rest.slice(varId.length);

  const turvarIds = getTurvarEntries(response)
    .map((entry) => entry.id)
    .sort((a, b) => b.length - a.length);
  return turvarIds.find((id) => rest.startsWith(id)) ?? null;
}

/** Extract the aggregate numeric value (or the only value) from a response. */
export function getAggregateValue(
  response: BpsDynamicDataResponse,
  domain: string,
  domainName?: string
): number | null {
  const datacontent = response.datacontent ?? {};
  const numericEntries = Object.entries(datacontent).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number"
  );
  if (numericEntries.length === 0) return null;

  const aggregateVervar = selectAggregateVervar(response, domain, domainName);
  const aggregateTurvar = selectAggregateTurvar(response);

  if (aggregateVervar || aggregateTurvar) {
    const match = numericEntries.find(([key]) => {
      if (aggregateVervar && extractVervarId(key, response) !== aggregateVervar) return false;
      if (aggregateTurvar && extractTurvarId(key, response) !== aggregateTurvar) return false;
      return true;
    });
    if (match) return match[1];
  }

  // Only safe when there is exactly one numeric value.
  if (numericEntries.length === 1) return numericEntries[0][1];
  return null;
}

/** Find a vervar label by id (for formatting ranking rows). */
export function getVervarLabelById(
  response: BpsDynamicDataResponse,
  id: string
): string | null {
  const entry = getVervarEntries(response).find((candidate) => candidate.id === id);
  return entry?.label ?? null;
}
