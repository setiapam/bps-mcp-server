import type { IPersistentStore } from "./persistent-store.js";
import { logger } from "../utils/logger.js";
import stopwords from "stopwords-iso";

/** Learned variable entry stored in persistent store. */
export interface LearnedVar {
  var_id: number;
  title: string;
  sub_name: string;
  unit?: string;
}

/** Learned period entry stored in persistent store. */
interface LearnedPeriod {
  periodId: string;
  year: string;
}

// --- KNOWN_VARS: hardcoded stable var_ids ---

const KNOWN_VARS: Record<string, LearnedVar[]> = {
  miskin: [
    { var_id: 184, title: "Persentase Penduduk Miskin", sub_name: "Kemiskinan dan Ketimpangan" },
    { var_id: 183, title: "Jumlah Penduduk Miskin (ribu jiwa)", sub_name: "Kemiskinan dan Ketimpangan" },
  ],
  garis_kemiskinan: [
    { var_id: 195, title: "Garis Kemiskinan", sub_name: "Kemiskinan dan Ketimpangan" }
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
  "garis kemiskinan": "garis_kemiskinan",
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

// --- Noise words: stopwords-iso (ID + EN) + BPS domain-specific terms ---

const BPS_SPECIFIC_NOISE = [
  "angka", "data", "statistik", "berapa", "terbaru",
  "terkait", "pemeluk", "tentang", "terhadap",
  "menurut", "berdasarkan", "terdiri", "atas",
  "secara", "yaitu", "yakni", "bahwa", "juga",
  "sudah", "telah", "masih", "lagi", "saja",
  "sangat", "cukup", "hanya", "selain", "sebagai",
  "seperti", "misalnya", "contoh", "lain", "lainnya",
  "total", "keseluruhan", "seluruh", "semua",
  "berapa", "berapaan", "tentang", "soal",
  "kabupaten", "kota", "provinsi", "kecamatan",
  "kab", "kec", "prov",
];

const ALL_STOPWORDS = new Set([
  ...(stopwords.id || []),
  ...(stopwords.en || []),
  ...BPS_SPECIFIC_NOISE,
]);

const NOISE_PATTERN = new RegExp(
  `\\b(${Array.from(ALL_STOPWORDS).sort((a, b) => b.length - a.length).join("|")})\\b`,
  "gi"
);

/**
 * Normalize a user query into a canonical lookup keyword.
 * Uses stopwords-iso for comprehensive noise removal.
 */
export function normalizeKeyword(query: string): string {
  return query
    .toLowerCase()
    .replace(NOISE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve canonical key from a normalized keyword.
 * Prefers the last matching keyword (e.g., "penduduk agama" → "agama").
 */
function resolveCanonical(normalized: string): string {
  // Direct alias match
  if (KEYWORD_ALIASES[normalized]) return KEYWORD_ALIASES[normalized];

  // Check if normalized IS a canonical key
  if (KNOWN_VARS[normalized]) return normalized;

  // Find matching alias, sorting by length descending to match more specific/longer phrases first
  const sortedAliases = Object.keys(KEYWORD_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (normalized.includes(alias)) {
      return KEYWORD_ALIASES[alias];
    }
  }

  // Find matching canonical key
  const sortedKnown = Object.keys(KNOWN_VARS).sort((a, b) => b.length - a.length);
  for (const key of sortedKnown) {
    if (normalized.includes(key)) {
      return key;
    }
  }

  // Word-level fallback
  const words = normalized.split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (KEYWORD_ALIASES[word]) {
      return KEYWORD_ALIASES[word];
    }
    if (KNOWN_VARS[word]) {
      return word;
    }
    // Substring check for individual words
    for (const alias of sortedAliases) {
      if (alias.includes(word) || word.includes(alias)) return KEYWORD_ALIASES[alias];
    }
    for (const key of sortedKnown) {
      if (key.includes(word) || word.includes(key)) return key;
    }
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
