/**
 * Normalizes region labels so "Provinsi Jawa Timur", "JAWA TIMUR" and
 * "Jawa Timur " compare equal. Shared by region-series (row picking) and
 * dynamic-data-utils (aggregate row selection): both must agree on which row
 * belongs to the requested region, otherwise one picks Jawa Timur and the
 * other falls back to the Indonesia row.
 */
export function normalizeRegionLabel(label: string): string {
  return (label ?? "")
    .toLowerCase()
    .replace(/\b(provinsi|propinsi|prov|kabupaten|kab|kota|administrasi)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
