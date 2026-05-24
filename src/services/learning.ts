import type { IPersistentStore } from "./persistent-store.js";
import { logger } from "../utils/logger.js";

/** Learned variable entry stored in persistent store. */
export interface LearnedVar {
  var_id: number;
  title: string;
  sub_name: string;
  unit?: string;
}

/** Learned period entry stored in persistent store. */
export interface LearnedPeriod {
  periodId: string;
  year: string;
}

// --- KNOWN_VARS: hardcoded stable var_ids ---

const KNOWN_VARS: Record<string, LearnedVar[]> = {
  miskin: [
    { var_id: 184, title: "Persentase Penduduk Miskin", sub_name: "Kemiskinan dan Ketimpangan" },
    { var_id: 183, title: "Jumlah Penduduk Miskin (ribu jiwa)", sub_name: "Kemiskinan dan Ketimpangan" },
  ],
  pengangguran: [
    { var_id: 543, title: "Tingkat Pengangguran Terbuka (%)", sub_name: "Tenaga Kerja" },
    { var_id: 674, title: "Jumlah Pengangguran (jiwa)", sub_name: "Tenaga Kerja" },
  ],
  ipm: [
    { var_id: 413, title: "[Metode Baru] Indeks Pembangunan Manusia (IPM)", sub_name: "IPM" },
  ],
  gini: [
    { var_id: 98, title: "Gini Rasio", sub_name: "Kemiskinan dan Ketimpangan" },
  ],
  penduduk: [
    { var_id: 1452, title: "Jumlah Penduduk (ribu jiwa)", sub_name: "Kependudukan" },
  ],
};

// --- KEYWORD_ALIASES: map variations to canonical key ---

const KEYWORD_ALIASES: Record<string, string> = {
  // Kemiskinan
  kemiskinan: "miskin",
  "penduduk miskin": "miskin",
  "warga miskin": "miskin",
  "orang miskin": "miskin",
  poverty: "miskin",
  // Pengangguran
  nganggur: "pengangguran",
  tpt: "pengangguran",
  "pengangguran terbuka": "pengangguran",
  unemployment: "pengangguran",
  // IPM
  "pembangunan manusia": "ipm",
  hdi: "ipm",
  // Gini
  ketimpangan: "gini",
  inequality: "gini",
  // Penduduk
  populasi: "penduduk",
  population: "penduduk",
  "jumlah penduduk": "penduduk",
  // Agama
  agama: "agama",
  religi: "agama",
  keagamaan: "agama",
  religion: "agama",
  "pemeluk agama": "agama",
};

// --- Noise words to strip during normalization ---

const NOISE_WORDS = /\b(angka|data|statistik|berapa|tahun|terbaru|di|dan|atau|yang|untuk|dari|terkait|pemeluk|tentang|terhadap)\b/g;

/**
 * Normalize a user query into a canonical lookup keyword.
 */
export function normalizeKeyword(query: string): string {
  return query
    .toLowerCase()
    .replace(NOISE_WORDS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve canonical key from a normalized keyword.
 * Checks alias table, then tries substring match against alias keys.
 */
function resolveCanonical(normalized: string): string {
  // Direct alias match
  if (KEYWORD_ALIASES[normalized]) return KEYWORD_ALIASES[normalized];

  // Check if normalized IS a canonical key
  if (KNOWN_VARS[normalized]) return normalized;

  // Substring: alias key contained in normalized, or vice versa
  for (const [alias, canonical] of Object.entries(KEYWORD_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) return canonical;
  }

  // Check KNOWN_VARS keys as substring
  for (const key of Object.keys(KNOWN_VARS)) {
    if (normalized.includes(key) || key.includes(normalized)) return key;
  }

  return normalized;
}

/**
 * 3-layer lookup: KNOWN_VARS → PersistentStore → null (caller does full search).
 */
export async function lookupVar(
  query: string,
  domain: string,
  store: IPersistentStore | null
): Promise<LearnedVar | null> {
  const normalized = normalizeKeyword(query);
  const canonical = resolveCanonical(normalized);

  // Layer 1: KNOWN_VARS — only for national domain (var_ids differ per domain)
  if (domain === "0000") {
    const known = KNOWN_VARS[canonical];
    if (known && known.length > 0) {
      logger.debug(`lookupVar: KNOWN_VARS hit "${canonical}" → var_id=${known[0].var_id}`);
      return known[0];
    }
  }

  if (!store) return null;

  // Layer 2: Persistent store — try canonical key first, then normalized
  const storeKey = `${canonical}:${domain}`;
  let stored = await store.get(storeKey);
  if (!stored && canonical !== normalized) {
    stored = await store.get(`${normalized}:${domain}`);
  }

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as LearnedVar;
      logger.debug(`lookupVar: store hit "${storeKey}" → var_id=${parsed.var_id}`);
      return parsed;
    } catch { /* ignore corrupt entry */ }
  }

  return null;
}

/**
 * Save a successful variable lookup to persistent store.
 */
export async function learnVar(
  query: string,
  domain: string,
  varData: LearnedVar,
  store: IPersistentStore | null
): Promise<void> {
  if (!store) return;
  const normalized = normalizeKeyword(query);
  const canonical = resolveCanonical(normalized);
  const key = `${canonical}:${domain}`;
  await store.set(key, JSON.stringify(varData));
  logger.debug(`learnVar: saved "${key}" → var_id=${varData.var_id}`);
}

/**
 * Invalidate a learned variable mapping (when data comes back empty).
 */
export async function invalidateVar(
  query: string,
  domain: string,
  store: IPersistentStore | null
): Promise<void> {
  if (!store) return;
  const normalized = normalizeKeyword(query);
  const canonical = resolveCanonical(normalized);
  await store.delete(`${canonical}:${domain}`);
  logger.debug(`invalidateVar: deleted "${canonical}:${domain}"`);
}

/**
 * Lookup a learned period mapping.
 */
export async function lookupPeriod(
  varId: number,
  domain: string,
  year: string,
  store: IPersistentStore | null
): Promise<string | null> {
  if (!store) return null;
  const key = `period:${varId}:${domain}:${year}`;
  const stored = await store.get(key);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as LearnedPeriod;
      logger.debug(`lookupPeriod: hit "${key}" → ${parsed.periodId}`);
      return parsed.periodId;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Save a period mapping.
 */
export async function learnPeriod(
  varId: number,
  domain: string,
  year: string,
  periodId: string,
  store: IPersistentStore | null
): Promise<void> {
  if (!store) return;
  const key = `period:${varId}:${domain}:${year}`;
  await store.set(key, JSON.stringify({ periodId, year } satisfies LearnedPeriod));
  logger.debug(`learnPeriod: saved "${key}" → ${periodId}`);
}

/**
 * Invalidate a period mapping.
 */
export async function invalidatePeriod(
  varId: number,
  domain: string,
  year: string,
  store: IPersistentStore | null
): Promise<void> {
  if (!store) return;
  await store.delete(`period:${varId}:${domain}:${year}`);
}
