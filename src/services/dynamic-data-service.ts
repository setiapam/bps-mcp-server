import type { BpsClient } from "../client/bps-client.js";
import type { BpsDynamicDataResponse } from "../client/types.js";
import { DOMAIN_ALIASES } from "../config/domain-aliases.js";
import { getVervarId, getVervarLabel } from "../client/fields.js";
import { buildStructuredPayload, type StructuredRow } from "./data-formatter.js";
import {
  describeMissingYears,
  parseYearSpec,
  resolvePeriodsForSpec,
} from "./period-resolver.js";

/** Province names, derived from the alias table (codes like 3500). */
const PROVINCE_LABELS: Set<string> = new Set(
  Object.entries(DOMAIN_ALIASES)
    .filter(([, code]) => code.length === 4 && code !== "0000" && code.endsWith("00"))
    .map(([name]) => name)
);

function normalizeRegionLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(provinsi|propinsi|prov)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** When a table lists many kab/kota, point at its official aggregate row. */
export function aggregateRowNote(result: { vervar?: unknown[] }): string | null {
  const entries = (result.vervar ?? [])
    .map((vervar) => ({ id: getVervarId(vervar), label: getVervarLabel(vervar) }))
    .filter((entry) => entry.label !== "");
  if (entries.length <= 10) return null;
  const hit =
    entries.find((entry) => PROVINCE_LABELS.has(normalizeRegionLabel(entry.label))) ??
    entries.find((entry) => /^(provinsi|propinsi)\b/i.test(entry.label)) ??
    entries.find((entry) => /\bindonesia\b/i.test(entry.label)) ??
    entries.find((entry) => /^(total|jumlah)$/i.test(entry.label));
  if (!hit) return null;
  return `Tabel memuat ${entries.length} kategori; baris agregat "${hit.label}" adalah angka resmi wilayah — pakai baris itu, jangan menjumlahkan kabupaten/kota.`;
}

export interface GetDynamicDataInput {
  domain?: string;
  var: string | number;
  th?: string;
  turvar?: string;
  vervar?: string;
  turth?: string;
}

export type GetDynamicDataOutcome =
  | {
      status: "ok";
      domain: string;
      varId: string;
      period: string | null;
      periodsUsed: Array<{ id: string; label: string }>;
      missingYears: string[];
      availableYears: string[];
      periodNote?: string;
      aggregateNote?: string;
      indicator?: string;
      unit?: string;
      units: string[];
      rows: StructuredRow[];
      note?: string;
      raw: BpsDynamicDataResponse;
    }
  | {
      status: "period_not_found";
      domain: string;
      varId: string;
      requestedText: string;
      availableLabels: string[];
    }
  | {
      status: "empty";
      domain: string;
      varId: string;
      availableYears: string[];
    };

export async function getDynamicDataService(
  client: BpsClient,
  input: GetDynamicDataInput
): Promise<GetDynamicDataOutcome> {
  const domain = input.domain || "0000";
  const varId = String(input.var).trim();
  const firstVar = varId.split(/[,;]/)[0]?.trim();
  const numericVar = Number(firstVar);
  const hasNumericVar = Number.isFinite(numericVar) && numericVar > 0;

  let period = input.th;
  let periodNote = "";
  let periodsUsed: Array<{ id: string; label: string }> = [];
  let missingYears: string[] = [];
  let availableYears: string[] = [];

  if (hasNumericVar) {
    const spec = parseYearSpec(input.th);
    if (spec.hasSpec || !period) {
      const resolved = await resolvePeriodsForSpec(client, domain, numericVar, input.th);
      if (resolved.entries.length === 0) {
        const requestedText = spec.years.length > 0 ? spec.years.join(", ") : String(input.th);
        return {
          status: "period_not_found",
          domain,
          varId,
          requestedText,
          availableLabels: resolved.availableLabels,
        };
      }
      period = resolved.entries.map((entry) => entry.id).join(";");
      periodsUsed = resolved.entries.map((entry) => ({ id: entry.id, label: entry.label }));
      missingYears = resolved.missingYears;
      availableYears = resolved.availableYears;

      const notes: string[] = [];
      const missing = describeMissingYears(resolved.missingYears, resolved.availableYears);
      if (missing) notes.push(missing);
      if (!spec.hasSpec) {
        notes.push(`Periode terbaru dipilih otomatis: ${resolved.entries[0].label} (ID: ${resolved.entries[0].id}).`);
      }
      periodNote = notes.join(" ");
    }
  }

  let result: BpsDynamicDataResponse;
  try {
    result = await client.getDynamicData(
      domain,
      varId,
      period,
      input.turvar,
      input.vervar,
      input.turth
    );
  } catch (error) {
    if (hasNumericVar) {
      const resolved = await resolvePeriodsForSpec(client, domain, numericVar, undefined).catch(() => null);
      const available = resolved?.availableLabels.length
        ? ` Periode tersedia: ${resolved.availableLabels.join(", ")}.`
        : "";
      throw new Error(
        `${error instanceof Error ? error.message : "Gagal mengambil data"}${available}`,
        { cause: error }
      );
    }
    throw error;
  }

  const rowCount = Object.keys(result.datacontent ?? {}).length;
  if (rowCount === 0) {
    let availYears: string[] = [];
    if (hasNumericVar) {
      const resolved = await resolvePeriodsForSpec(client, domain, numericVar, undefined).catch(() => null);
      if (resolved?.availableYears.length) {
        availYears = resolved.availableYears;
      }
    }
    return {
      status: "empty",
      domain,
      varId,
      availableYears: availYears,
    };
  }

  const payload = buildStructuredPayload(result, domain);
  const aggNote = aggregateRowNote(result) || undefined;

  return {
    status: "ok",
    domain,
    varId,
    period: period ?? null,
    periodsUsed,
    missingYears,
    availableYears,
    periodNote: periodNote || undefined,
    aggregateNote: aggNote,
    indicator: payload.rows[0]?.indicator,
    unit: payload.units[0],
    units: payload.units,
    rows: payload.rows,
    note: payload.note,
    raw: result,
  };
}
