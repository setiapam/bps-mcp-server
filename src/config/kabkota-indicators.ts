/**
 * Crosswalk for indicators that BPS publishes **per kabupaten/kota**, but only
 * inside each provincial domain (there is no national kab/kota table).
 *
 * Without this map a client has to sweep 34 provincial domains, guess a
 * variable name in each one, and still get the wrong table half the time.
 * The var_ids below were verified against BPS WebAPI; when BPS revises a
 * table the sweep falls back to keyword discovery (`searchVariables`).
 *
 * Add new indicators here as they are verified — one entry replaces dozens of
 * discovery calls.
 */
export interface KabkotaIndicatorHint {
  /** Stable identifier used in logs/tests. */
  id: string;
  /** Human label for the indicator. */
  label: string;
  /** Query pattern that should use this crosswalk. */
  pattern: RegExp;
  /** Province domain → var_id of the kabupaten/kota table. */
  variables: Record<string, string>;
  /**
   * Province domains that publish the indicator only as province totals
   * (no kab/kota breakdown in WebAPI). They are reported as "not covered".
   */
  unavailable: Record<string, string>;
}

export const KABKOTA_INDICATORS: KabkotaIndicatorHint[] = [
  {
    id: "tpt",
    label: "Tingkat Pengangguran Terbuka (TPT) menurut Kabupaten/Kota",
    pattern: /\b(tpt|pengangguran|penganggur|unemployment)\b/i,
    variables: {
      "1100": "206",
      "1200": "44",
      "1300": "139",
      "1400": "42",
      "1500": "844",
      "1800": "47",
      "1900": "95",
      "2100": "224",
      "3200": "73",
      "3300": "64",
      "3500": "54",
      "3600": "157",
      "6100": "51",
      "6200": "389",
      "6300": "37",
      "6400": "59",
      "6500": "115",
      "7200": "92",
      "7300": "466",
      "7400": "395",
      "7500": "184",
      "7600": "520",
      "8100": "108",
      "8200": "250",
      "9100": "270",
    },
    unavailable: {
      "1600": "Hanya tersedia angka provinsi (TPT Sumatera Selatan)",
      "1700": "Hanya tersedia angka provinsi + tabel statis 2022",
      "3100": "DKI Jakarta hanya satu level kota administrasi",
      "3400": "Hanya tersedia angka provinsi (TPT D.I. Yogyakarta)",
      "5100": "Tabel 'Persentase Pengangguran' memakai denominasi berbeda",
      "5200": "Hanya tersedia angka provinsi (TPT NTB)",
      "5300": "Hanya tersedia angka provinsi (TPT NTT)",
      "7100": "Tidak ada tabel TPT kab/kota; hanya jumlah pengangguran (jiwa)",
      "9400": "Tabel TPT kab/kota tersedia sebagai tabel statis, bukan WebAPI",
    },
  },
];

export function findKabkotaIndicator(query: string): KabkotaIndicatorHint | null {
  return KABKOTA_INDICATORS.find((indicator) => indicator.pattern.test(query)) ?? null;
}
