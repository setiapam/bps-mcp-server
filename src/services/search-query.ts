import { expandQueryTerms } from "./variable-search.js";

/**
 * BPS' search engines are literal: many abstract/derived nouns used in
 * questions return ZERO results ("kemiskinan", "pendidikan", "pengangguran")
 * while their root or the official abbreviation returns hundreds ("miskin",
 * "didik", "tpt"). Asking the model to rephrase costs another tool round-trip,
 * so the server derives the fallbacks itself.
 *
 * Verified against https://searchengine.web.bps.go.id (Nov 2026).
 */
const KNOWN_ROOT_FORMS: Record<string, string> = {
  kemiskinan: "miskin",
  kependudukan: "penduduk",
  pendidikan: "didik",
  kesehatan: "sehat",
  pertanian: "tani",
  perdagangan: "dagang",
  pengangguran: "tpt",
  ketenagakerjaan: "tenaga kerja",
  pembangunan: "bangun",
  pemerintahan: "perintah",
  keuangan: "uang",
  pertumbuhan: "tumbuh",
};

/** Prefixes that commonly wrap an Indonesian root ("ke-", "peN-", "per-"). */
const PREFIXES = ["peny", "peng", "pem", "pen", "per", "ber", "ter", "ke", "pe", "di"];

/**
 * AllStats does not always render the content-type badge, so infer it from the
 * result URL. Callers use this to pick the follow-up tool (get_publication,
 * get_static_table, ...) without opening each result.
 */
export function inferContentTypeFromUrl(url: string, fallback = ""): string {
  if (/\/statistics-table\//i.test(url)) return "Tabel";
  if (/\/publication\//i.test(url)) return "Publikasi";
  if (/\/pressrelease\//i.test(url)) return "BRS";
  if (/\/infographic/i.test(url)) return "Infografis";
  if (/\/news\//i.test(url)) return "Berita";
  if (/glosarium|glossary/i.test(url)) return "Glosarium";
  if (/\/kbli|\/kbki|klasifikasi/i.test(url)) return "Klasifikasi";
  if (/microdata/i.test(url)) return "Data Mikro";
  if (/\/regulation/i.test(url)) return "Peraturan";
  if (fallback && fallback !== "all") return fallback;
  return "Hasil";
}


function stripSuffix(word: string): string | null {
  for (const suffix of ["kannya", "annya", "nya", "kan", "an", "i"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * Returns at most three alternatives, most promising first:
 *   1. the head noun of a multi-word query ("angka kemiskinan" → "kemiskinan")
 *   2. a curated root/abbreviation BPS actually indexes
 *   3. a morphologically stripped root ("pembangunan" → "bangun")
 */
export function searchQueryFallbacks(query: string): string[] {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return [];

  const fallbacks: string[] = [];
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const cleaned = value.trim();
    if (cleaned.length < 3 || cleaned === normalized || fallbacks.includes(cleaned)) return;
    fallbacks.push(cleaned);
  };

  const words = normalized.split(" ").filter(Boolean);
  if (words.length > 1) {
    // Indonesian noun phrases put the head last ("angka kemiskinan").
    add(words[words.length - 1]);
  }

  for (const word of words) {
    add(KNOWN_ROOT_FORMS[word]);
  }

  if (words.length === 1) {
    const word = words[0];
    const base = stripSuffix(word);
    add(base);
    if (base) {
      for (const prefix of PREFIXES) {
        if (base.startsWith(prefix) && base.length - prefix.length >= 4) {
          add(base.slice(prefix.length));
          break;
        }
      }
    }
  }

  for (const term of expandQueryTerms(normalized)) {
    add(term);
  }

  return fallbacks.slice(0, 3);
}
