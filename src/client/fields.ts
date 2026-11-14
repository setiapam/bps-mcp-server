/**
 * BPS WebAPI returns two different metadata shapes:
 *
 * - List endpoints (var, vervar, th, turth, ...) use fields such as
 *   `th_id`/`th`, `kode_ver_id`/`vervar`, `turth_id`/`turth`.
 * - The dynamic-data endpoint returns the same metadata as `{ val, label }`.
 *
 * These helpers normalize both shapes so tools and formatters don't have to
 * guess (and don't print "undefined" when the schema differs).
 */

type FieldBag = Record<string, unknown>;

function firstDefined(bag: FieldBag | undefined | null, ...keys: string[]): unknown {
  if (!bag) return undefined;
  for (const key of keys) {
    const value = bag[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function getVariableId(variable: unknown): string {
  const bag = variable as FieldBag;
  return asString(firstDefined(bag, "var_id", "val", "id"));
}

export function getVariableTitle(variable: unknown): string {
  const bag = variable as FieldBag;
  return asString(firstDefined(bag, "title", "label", "var_name"));
}

export function getVariableUnit(variable: unknown): string | undefined {
  const bag = variable as FieldBag;
  const unit = asString(firstDefined(bag, "unit", "satuan"));
  if (!unit) return undefined;
  const normalized = unit.trim();
  if (!normalized || normalized.toLowerCase() === "null") return undefined;
  if (normalized.toLowerCase() === "tidak ada satuan") return undefined;
  if (normalized === "-") return undefined;
  return normalized;
}

export function getVervarId(vervar: unknown): string {
  const bag = vervar as FieldBag;
  return asString(firstDefined(bag, "kode_vervar", "kode_ver_id", "val", "id"));
}

export function getVervarLabel(vervar: unknown): string {
  const bag = vervar as FieldBag;
  return asString(firstDefined(bag, "label_vervar", "vervar", "label"));
}

export function getVervarGroup(vervar: unknown): string {
  const bag = vervar as FieldBag;
  return asString(firstDefined(bag, "name_group_vervar", "name_group_ver_id"));
}

export function getTurvarId(turvar: unknown): string {
  const bag = turvar as FieldBag;
  return asString(firstDefined(bag, "kode_turvar", "kode_tur_id", "turvar_id", "val", "id"));
}

export function getTurvarLabel(turvar: unknown): string {
  const bag = turvar as FieldBag;
  return asString(firstDefined(bag, "label_turvar", "turvar", "label"));
}

export function getTurvarGroup(turvar: unknown): string {
  const bag = turvar as FieldBag;
  return asString(firstDefined(bag, "name_group_turvar", "name_group_tur_id"));
}

export function getPeriodId(period: unknown): string {
  const bag = period as FieldBag;
  return asString(firstDefined(bag, "th_id", "val", "id"));
}

export function getPeriodLabel(period: unknown): string {
  const bag = period as FieldBag;
  return asString(firstDefined(bag, "th_name", "th", "label"));
}

export function getTurthId(turth: unknown): string {
  const bag = turth as FieldBag;
  return asString(firstDefined(bag, "turth_id", "val", "id"));
}

export function getTurthLabel(turth: unknown): string {
  const bag = turth as FieldBag;
  return asString(firstDefined(bag, "turth_name", "turth", "label"));
}

export function isNeutralPeriodLabel(label: string | undefined): boolean {
  if (!label) return true;
  const normalized = label.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized.includes("tahunan") ||
    normalized === "tahun" ||
    normalized === "tidak ada" ||
    normalized === "total"
  );
}

/** Format an indicator unit for display, hiding BPS' literal "null". */
export function formatUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const normalized = String(unit).trim();
  if (!normalized || normalized.toLowerCase() === "null" || normalized === "-") return "";
  return normalized;
}
