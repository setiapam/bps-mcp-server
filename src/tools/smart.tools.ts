import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import { formatDynamicData } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { logger } from "../utils/logger.js";

import type { IPersistentStore } from "../services/persistent-store.js";
import {
  lookupVar,
  learnVar,
  invalidateVar,
  lookupPeriod,
  learnPeriod,
  invalidatePeriod,
  normalizeKeyword,
} from "../services/learning.js";

/**
 * AI-friendly shortcut tools that reduce multi-step workflows to single calls.
 */
export function registerSmartTools(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver,
  config: Config,
  store: IPersistentStore | null
): void {
  // ---------- find_variable ----------
  server.tool(
    "find_variable",
    `Cari variabel data BPS berdasarkan kata kunci. Mencari di semua subjek yang relevan.

Contoh penggunaan:
- find_variable(keyword="penduduk") → variabel terkait jumlah penduduk
- find_variable(keyword="kemiskinan", domain="3500") → variabel kemiskinan di Jawa Timur
- find_variable(keyword="inflasi") → variabel inflasi nasional

Setelah mendapat var_id dari tool ini, gunakan get_dynamic_data untuk mengambil datanya.`,
    {
      keyword: z.string().describe("Kata kunci pencarian variabel (misal: penduduk, kemiskinan, inflasi, pengangguran, PDRB)"),
      domain: z.string().default("0000").describe("Kode domain BPS. '0000'=nasional. Gunakan resolve_domain jika perlu."),
      subject: z.number().optional().describe("Filter berdasarkan ID subjek (opsional, gunakan list_subjects untuk melihat daftar)"),
    },
    async ({ keyword, domain, subject }) => {
      try {
        const allVars: Array<{ var_id: number; title: string; sub_name: string; unit?: string; def?: string }> = [];
        const kw = keyword.toLowerCase();

        if (subject) {
          // Search within specific subject
          await searchVariablesInSubject(client, domain, subject, kw, allVars);
        } else {
          // Use keyword → subject mapping + subject title matching
          const mappedIds = getSubjectIdsForKeyword(kw);
          const subjects = await client.listSubjects(domain);
          const matchedIds = subjects.data
            .filter(s => {
              const t = s.title.toLowerCase();
              return kw.split(/\s+/).some(w => w.length > 2 && t.includes(w)) || t.includes(kw);
            })
            .map(s => s.sub_id);

          const subjectIds = [...new Set([...mappedIds, ...matchedIds])];

          // Search in relevant subjects first
          for (const subId of subjectIds.slice(0, 5)) {
            await searchVariablesInSubject(client, domain, subId, kw, allVars);
            if (allVars.length >= 15) break;
          }

          // If no results from relevant subjects, try without subject filter
          if (allVars.length === 0) {
            await searchVariablesInSubject(client, domain, undefined, kw, allVars);
          }
        }

        if (allVars.length === 0) {
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ditemukan variabel yang cocok dengan "${keyword}" di domain ${domain}.\n\n` +
                `**Tips:** Coba kata kunci yang lebih umum, atau gunakan list_subjects untuk melihat subjek yang tersedia, lalu filter dengan parameter subject.`
              ),
            }],
          };
        }

        const lines: string[] = [
          `## Variabel yang cocok dengan "${keyword}"`,
          `**Domain:** ${domain} | **Ditemukan:** ${allVars.length} variabel`,
          "",
        ];

        for (const v of allVars.slice(0, 15)) {
          lines.push(`- **${v.title}** (var_id: \`${v.var_id}\`) — Subjek: ${v.sub_name}${v.unit ? ` — Satuan: ${v.unit}` : ""}`);
          if (v.def) lines.push(`  _${v.def.substring(0, 150)}_`);
        }

        lines.push("");
        lines.push("**Langkah selanjutnya:** Gunakan `get_dynamic_data(domain=\"" + domain + "\", var=\"<var_id>\")` untuk mengambil data.");

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Gagal mencari variabel";
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );

  // ---------- find_data ----------
  server.tool(
    "find_data",
    `Tool utama untuk AI: cari dan ambil data BPS dalam satu langkah.
Secara otomatis: resolve nama wilayah → cari variabel → ambil data.

Gunakan tool ini sebagai langkah PERTAMA ketika user bertanya tentang data statistik.

## Quick Reference — Topik Umum

| Topik | Metode Tercepat | var_id (nasional) |
|-------|----------------|-------------------|
| Kemiskinan (jumlah) | find_data atau get_dynamic_data | 183, 185 |
| Kemiskinan (%) | find_data atau get_dynamic_data | 184, 192 |
| Pengangguran (TPT %) | get_dynamic_data(var="543") | 543 |
| Pengangguran (jumlah) | get_dynamic_data(var="674") | 674 |
| Inflasi (YoY) | list_strategic_indicators | - |
| Pertumbuhan ekonomi | list_strategic_indicators | - |
| IPM | list_strategic_indicators atau get_dynamic_data | 1706 |
| Gini Rasio | get_dynamic_data(var="98") | 98 |
| Jumlah Penduduk | get_dynamic_data(var="1452") | 1452 |
| PDRB | list_strategic_indicators(domain=kode_prov) | - |
| Ekspor/Impor | list_strategic_indicators atau get_trade_data | - |
| Publikasi/BRS | search atau allstats_search | - |
| Teks dalam PDF | allstats_deep_search | - |

## Strategi:
1. Data angka terbaru (headline) → list_strategic_indicators
2. Data angka historis/spesifik → find_data atau get_dynamic_data + var_id di atas
3. Cari publikasi/tabel/BRS → search atau allstats_search
4. Cari teks di dalam PDF → allstats_deep_search

Contoh:
- find_data(query="penduduk miskin", region="Indonesia", year="2023")
- find_data(query="pengangguran", region="Jawa Timur", year="2023")
- find_data(query="PDRB", region="Bali", year="2023")`,
    {
      query: z.string().describe("Deskripsi data yang dicari (misal: jumlah penduduk, angka kemiskinan, inflasi, PDRB, pengangguran)"),
      region: z.string().default("Indonesia").describe("Nama wilayah (misal: Indonesia, Jawa Timur, Surabaya, DKI Jakarta). Mendukung nama resmi dan singkatan."),
      year: z.string().optional().describe("Tahun data (misal: '2023' atau '2020,2021,2022,2023' untuk multi-tahun). Kosongkan untuk data terbaru."),
    },
    async ({ query, region, year }) => {
      try {
        // Step 1: Resolve domain
        let domain = "0000";
        let domainName = "Indonesia";

        if (region.toLowerCase() !== "indonesia" && region !== "0000") {
          const resolved = await resolver.resolve(region);
          if (resolved) {
            domain = resolved.domainId;
            domainName = resolved.domainName;
          } else {
            return {
              content: [{
                type: "text",
                text: appendAttribution(
                  `Wilayah "${region}" tidak ditemukan. Gunakan resolve_domain untuk mencari kode wilayah yang benar.`
                ),
              }],
              isError: true,
            };
          }
        }

        // Step 2: Find variable via 3-layer lookup
        const kw = normalizeKeyword(query);
        // Skip cached lookup if query explicitly asks for breakdown (kab/kota)
        // because cached var is likely the aggregate, not the breakdown
        const asksBreakdown = /\b(kabupaten|kab[/\s]kota|per\s*kab)\b/.test(kw);
        let bestVar = asksBreakdown ? null : await lookupVar(query, domain, store);
        let fromLearning = !!bestVar;
        const candidates: Array<{ var_id: number; title: string; sub_name: string; unit?: string; score: number }> = [];

        if (!bestVar) {
          bestVar = await fullSearchVar(client, kw, domain, candidates);
          fromLearning = false;
        }

        if (!bestVar) {
          // Fallback: try strategic indicators
          const indResult = await tryStrategicIndicators(client, kw, domain, domainName, year);
          if (indResult) return indResult;

          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ditemukan data "${query}" untuk ${domainName}.\n\n` +
                `**Saran:**\n` +
                `1. Gunakan \`find_variable(keyword="${query}", domain="${domain}")\` untuk mencari variabel yang lebih spesifik\n` +
                `2. Gunakan \`search(keyword="${query}")\` untuk pencarian lebih luas\n` +
                `3. Gunakan \`list_strategic_indicators(domain="${domain}")\` untuk indikator utama`
              ),
            }],
          };
        }

        // Step 3: Resolve period
        logger.debug(`find_data: using var_id=${bestVar.var_id} (${bestVar.title}) for query="${query}"`);
        const periodParam = await resolvePeriod(client, store, bestVar.var_id, domain, year);

        // Step 4: Get data
        let result = await client.getDynamicData(domain, String(bestVar.var_id), periodParam);

        // Self-healing: if data empty and var came from learning, invalidate and retry full search
        if ((!result.datacontent || Object.keys(result.datacontent).length === 0) && fromLearning) {
          logger.debug(`find_data: self-healing — invalidating learned var_id=${bestVar.var_id}`);
          await invalidateVar(query, domain, store);
          if (year) {
            for (const y of year.split(",")) await invalidatePeriod(bestVar.var_id, domain, y.trim(), store);
          }

          // Retry with full search
          const retryCandidates: Array<{ var_id: number; title: string; sub_name: string; unit?: string; score: number }> = [];
          const retryVar = await fullSearchVar(client, kw, domain, retryCandidates);
          if (retryVar) {
            bestVar = retryVar;
            fromLearning = false;
            const retryPeriod = await resolvePeriod(client, store, bestVar.var_id, domain, year);
            result = await client.getDynamicData(domain, String(bestVar.var_id), retryPeriod);
            candidates.push(...retryCandidates);
          }
        }

        const formatted = formatDynamicData(result, domain, config.defaultLang);
        const header = `**Pencarian:** "${query}" di ${domainName}${year ? ` (${year})` : ""}\n**Variabel:** ${bestVar.title} (ID: ${bestVar.var_id})\n\n`;

        // Still no data after retry
        if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
          const altLines = [
            `Data untuk variabel "${bestVar.title}" tidak tersedia${year ? ` untuk tahun ${year}` : ""} di ${domainName}.`,
            "",
          ];
          if (candidates.length > 1) {
            altLines.push("**Variabel alternatif yang ditemukan:**");
            for (const c of candidates.slice(0, 5)) {
              altLines.push(`- ${c.title} (var_id: \`${c.var_id}\`)${c.unit ? ` — ${c.unit}` : ""}`);
            }
            altLines.push("");
            altLines.push("Gunakan `get_dynamic_data` dengan var_id di atas untuk mencoba variabel lain.");
          }
          return { content: [{ type: "text", text: appendAttribution(altLines.join("\n")) }] };
        }

        // Success — learn the variable mapping
        await learnVar(query, domain, bestVar, store);

        return { content: [{ type: "text", text: header + formatted }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Gagal mengambil data";
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );
}

// Common keyword → subject ID mapping (BPS subject IDs are stable across domains)
const KEYWORD_SUBJECTS: Record<string, number[]> = {
  pengangguran: [6], tenaga: [6], kerja: [6], tpak: [6], angkatan: [6],
  miskin: [23], kemiskinan: [23], gini: [23], ketimpangan: [23],
  penduduk: [12], kependudukan: [12], fertilitas: [12], migrasi: [12],
  inflasi: [3], harga: [3], ihk: [3],
  pdrb: [52], ekonomi: [52, 35], pertumbuhan: [52],
  ipm: [26], pembangunan: [26],
  ekspor: [8], impor: [8], perdagangan: [8],
  pertanian: [55], pangan: [55],
  industri: [9], manufaktur: [9],
  kesehatan: [30],
  pendidikan: [28],
  pariwisata: [16],
};

function getSubjectIdsForKeyword(kw: string): number[] {
  const ids: number[] = [];
  for (const [keyword, subIds] of Object.entries(KEYWORD_SUBJECTS)) {
    if (kw.includes(keyword)) ids.push(...subIds);
  }
  return [...new Set(ids)];
}

/** Full search flow (Layer 3): search subjects → variables → score → return best. */
async function fullSearchVar(
  client: BpsClient,
  kw: string,
  domain: string,
  candidates: Array<{ var_id: number; title: string; sub_name: string; unit?: string; score: number }>
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
  const mappedSubjectIds = getSubjectIdsForKeyword(kw);
  const subjects = await client.listSubjects(domain);
  const relevantSubjects = subjects.data.filter(s => {
    const titleLower = s.title.toLowerCase();
    return kw.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w)) || titleLower.includes(kw);
  });

  const subjectIdsToSearch = [
    ...new Set([...mappedSubjectIds, ...relevantSubjects.map(s => s.sub_id)])
  ];

  for (const subId of subjectIdsToSearch.slice(0, 5)) {
    const result = await client.listVariables(domain, subId, undefined, 1, 100);
    if (!result.data || result.data.length === 0) continue;
    for (const v of result.data) {
      const score = computeRelevanceScore(kw, v.title.toLowerCase(), v.sub_name?.toLowerCase() || "");
      if (score > 0) candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit, score });
    }
    // BPS API caps at 10 per page regardless of perpage param — fetch more pages
    const totalPages = result.page?.pages || 1;
    for (let page = 2; page <= Math.min(totalPages, 5); page++) {
      const nextPage = await client.listVariables(domain, subId, undefined, page, 100);
      if (!nextPage.data || nextPage.data.length === 0) break;
      for (const v of nextPage.data) {
        const score = computeRelevanceScore(kw, v.title.toLowerCase(), v.sub_name?.toLowerCase() || "");
        if (score > 0) candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit, score });
      }
    }
    if (candidates.length >= 10) break;
  }

  if (candidates.length === 0) {
    const domainsToSearch = domain === "0000" ? ["0000"] : [domain, "0000"];
    for (const searchDomain of domainsToSearch) {
      for (let page = 1; page <= 2; page++) {
        const result = await client.listVariables(searchDomain, undefined, undefined, page, 100);
        if (!result.data || result.data.length === 0) break;
        for (const v of result.data) {
          const score = computeRelevanceScore(kw, v.title.toLowerCase(), v.sub_name?.toLowerCase() || "");
          if (score > 0) candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit, score });
        }
        if (candidates.length >= 5) break;
        if (result.data.length < 100) break;
      }
      if (candidates.length >= 5) break;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) {
    return { var_id: candidates[0].var_id, title: candidates[0].title, sub_name: candidates[0].sub_name, unit: candidates[0].unit };
  }
  return null;
}

/** Resolve year to period IDs, using learning store first. */
async function resolvePeriod(
  client: BpsClient,
  store: IPersistentStore | null,
  varId: number,
  domain: string,
  year: string | undefined
): Promise<string | undefined> {
  if (!year) {
    // No year specified — get latest available period
    try {
      const periods = await client.listPeriods(domain, varId);
      if (periods.length > 0) {
        // periods are typically sorted descending; take the first (latest)
        const latest = periods[0];
        return String(latest.th_id);
      }
    } catch { /* fall through */ }
    return undefined;
  }

  const yearNums = year.split(",").map(y => y.trim());
  const learnedPeriods: string[] = [];
  for (const y of yearNums) {
    const learned = await lookupPeriod(varId, domain, y, store);
    if (learned) learnedPeriods.push(learned);
  }

  if (learnedPeriods.length === yearNums.length) {
    return learnedPeriods.join(",");
  }

  // Fallback: call list_periods API
  try {
    const periods = await client.listPeriods(domain, varId);
    if (periods.length > 0) {
      const matchingPeriods = periods.filter(p => {
        const pAny = p as unknown as Record<string, unknown>;
        const thName = String(pAny.th_name || pAny.th || "");
        const thVal = String(pAny.val || "");
        const thId = String(p.th_id);
        return yearNums.some(y => thName.includes(y) || thVal.includes(y) || thId === y);
      });
      if (matchingPeriods.length > 0) {
        // Learn period mappings
        for (const p of matchingPeriods) {
          const pAny = p as unknown as Record<string, unknown>;
          const thName = String(pAny.th_name || pAny.th || pAny.val || "");
          const matchedYear = yearNums.find(y => thName.includes(y));
          if (matchedYear) {
            await learnPeriod(varId, domain, matchedYear, String(p.th_id), store);
          }
        }
        return matchingPeriods.map(p => String(p.th_id)).join(",");
      }
    }
  } catch {
    // If period lookup fails, use raw year value
  }
  return year;
}

/** Try strategic indicators as fallback. */
async function tryStrategicIndicators(
  client: BpsClient,
  kw: string,
  domain: string,
  domainName: string,
  year: string | undefined
): Promise<{ content: Array<{ type: "text"; text: string }> } | null> {
  const indicators = await client.listStrategicIndicators(domain);
  if (!indicators.data || indicators.data.length === 0) return null;

  for (const ind of indicators.data) {
    const titleLower = ind.title.toLowerCase();
    if (titleLower.includes(kw) || kw.split(/\s+/).some(w => titleLower.includes(w))) {
      const lines = [
        `## ${ind.title}`,
        `**Wilayah:** ${domainName} (${domain})`,
        "",
      ];
      if (ind.data) {
        lines.push("| Periode | Nilai |");
        lines.push("| --- | --- |");
        const entries = Object.entries(ind.data);
        const filtered = year
          ? entries.filter(([k]) => year.split(",").some(y => k.includes(y)))
          : entries.slice(-10);
        for (const [period, value] of filtered) {
          lines.push(`| ${period} | ${typeof value === "number" ? value.toLocaleString("id-ID") : value} |`);
        }
      }
      return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
    }
  }
  return null;
}

/**
 * Search variables within a subject (or all if undefined) and add matches to results array.
 */
async function searchVariablesInSubject(
  client: BpsClient,
  domain: string,
  subject: number | undefined,
  kw: string,
  results: Array<{ var_id: number; title: string; sub_name: string; unit?: string; def?: string }>
): Promise<void> {
  const kwWords = kw.split(/\s+/).filter(w => w.length > 2);

  for (let page = 1; page <= 3; page++) {
    const result = await client.listVariables(domain, subject, undefined, page, 100);
    if (!result.data || result.data.length === 0) break;

    for (const v of result.data) {
      const titleLower = v.title.toLowerCase();
      const defLower = (v.def || "").toLowerCase();

      // Match if full keyword or any word matches
      const matches = titleLower.includes(kw) || defLower.includes(kw) ||
        kwWords.some(w => titleLower.includes(w));

      if (matches) {
        // Avoid duplicates
        if (!results.some(r => r.var_id === v.var_id)) {
          results.push({
            var_id: v.var_id,
            title: v.title,
            sub_name: v.sub_name,
            unit: v.unit,
            def: v.def,
          });
        }
      }
    }

    if (results.length >= 15) break;
    if (result.data.length < 100) break;
  }
}

/**
 * Compute relevance score for a variable title against a search query.
 * Higher score = more relevant.
 */
function computeRelevanceScore(query: string, title: string, subName: string): number {
  let score = 0;
  const queryWords = query.split(/\s+/).filter(w => w.length > 2);

  // Exact phrase match in title
  if (title.includes(query)) score += 100;

  // Word-level matches in title
  let wordMatches = 0;
  for (const word of queryWords) {
    if (title.includes(word)) {
      score += 30;
      wordMatches++;
    }
    if (subName.includes(word)) score += 15;
  }

  // Bonus for matching all query words
  if (queryWords.length > 1 && wordMatches === queryWords.length) score += 40;

  // Title starts with query
  if (title.startsWith(query)) score += 50;

  // Prefer "tingkat" or "persentase" variants (main indicators)
  if (title.includes("tingkat") || title.includes("persentase") || title.includes("jumlah")) score += 20;

  // Prefer shorter titles (more general/main indicators)
  if (title.length < 60) score += 15;
  if (title.length > 100) score -= 20;

  // Penalize titles with "menurut" (breakdowns are less useful as primary)
  // UNLESS query explicitly asks for breakdown (kabupaten, kab, kota)
  const queryAsksBreakdown = query.includes("kabupaten") || query.includes("kab") ||
    (query.includes("kota") && !query.includes("perkotaan"));
  const menurutCount = (title.match(/menurut/g) || []).length;
  if (menurutCount > 1 && !queryAsksBreakdown) score -= 15;

  // Boost if query asks for kab/kota breakdown and title has it
  if (queryAsksBreakdown && (title.includes("kabupaten") || title.includes("kab/"))) {
    score += 60;
  }

  // Prefer "persentase" or "jumlah penduduk miskin" over "garis kemiskinan" or "indeks"
  if (query.includes("miskin") || query.includes("kemiskinan")) {
    if (title.includes("persentase")) score += 40;
    else if (title.includes("jumlah penduduk miskin") || title.includes("jumlah penduduk miskin")) score += 20;
    if (title.includes("garis kemiskinan")) score -= 30;
    if (title.includes("indeks kedalaman") || title.includes("indeks keparahan")) score -= 20;
  }

  return score;
}
