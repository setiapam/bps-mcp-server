import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { BpsStaticTable } from "../client/types.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import { formatDynamicData } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { logger } from "../utils/logger.js";
import { htmlTableToMarkdown } from "../utils/html.js";

import type { IPersistentStore } from "../services/persistent-store.js";
import type { BpsDynamicDataResponse } from "../client/types.js";
import { hasRegionRow } from "../services/region-series.js";
import { resolvePeriodsForSpec } from "../services/period-resolver.js";
import {
  lookupVar,
  learnVar,
  invalidateVar,
  learnPeriod,
  invalidatePeriod,
  normalizeKeyword,
} from "../services/learning.js";
import { detectIntent, generateResultHints } from "../services/intent-detector.js";
import {
  computeRelevanceScore,
  expandQueryTerms,
  resolveVariableForYears,
  searchVariables,
} from "../services/variable-search.js";
import { filterRelevantVervar } from "../services/dynamic-data-utils.js";
import {
  formatUnit,
  getPeriodId,
  getPeriodLabel,
} from "../client/fields.js";

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

Bukan untuk ranking: bila user minta "10 kabupaten/kota ... tertinggi", panggil
\`get_ranking(level="kabkota")\` — tool itu sudah tahu var_id tiap provinsi.

Contoh penggunaan:
- find_variable(keyword="penduduk") → variabel terkait jumlah penduduk
- find_variable(keyword="kemiskinan", domain="3500") → variabel kemiskinan di Jawa Timur
- find_variable(keyword="inflasi") → variabel inflasi nasional

Setelah mendapat var_id dari tool ini, gunakan get_dynamic_data untuk mengambil datanya.`,
    {
      keyword: z.string().optional().describe("Kata kunci pencarian variabel (misal: penduduk, kemiskinan, inflasi, pengangguran, PDRB)"),
      keywords: z.string().optional().describe("Alias untuk 'keyword'."),
      query: z.string().optional().describe("Alias untuk 'keyword'."),
      domain: z.string().default("0000").describe("Kode domain BPS. '0000'=nasional. Gunakan resolve_domain jika perlu."),
      subject: z.number().optional().describe("Filter berdasarkan ID subjek (opsional, gunakan list_subjects untuk melihat daftar)"),
    },
    async ({ keyword: keywordInput, keywords, query, domain, subject }) => {
      const keyword = keywordInput ?? keywords ?? query;
      if (!keyword || !keyword.trim()) {
        return {
          content: [{
            type: "text",
            text: "Parameter 'keyword' wajib diisi, misal find_variable(keyword=\"penduduk miskin\", domain=\"3500\").",
          }],
          isError: true,
        };
      }
      try {
        const allVars: Array<{ var_id: number; title: string; sub_name: string; unit?: string; def?: string }> = [];

        if (subject) {
          await searchVariablesInSubject(client, domain, subject, keyword, allVars);
        } else {
          const candidates = await searchVariables(client, domain, keyword, {
            maxSubjects: 8,
            maxPagesPerSubject: 6,
            maxCandidates: 20,
          });
          for (const candidate of candidates) {
            if (allVars.some((item) => item.var_id === candidate.var_id)) continue;
            allVars.push({
              var_id: candidate.var_id,
              title: candidate.title,
              sub_name: candidate.sub_name,
              unit: candidate.unit,
              def: candidate.def,
            });
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
          const unit = formatUnit(v.unit);
          lines.push(`- **${v.title}** (var_id: \`${v.var_id}\`) — Subjek: ${v.sub_name}${unit ? ` — Satuan: ${unit}` : ""}`);
          if (v.def) lines.push(`  _${v.def.replace(/\s+/g, " ").substring(0, 200)}_`);
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
Secara otomatis: detect intent → resolve wilayah → cari variabel → ambil data.

⚠️ JANGAN pakai tool ini untuk PERINGKAT/top-N wilayah ("10 kabupaten/kota
tertinggi", "5 provinsi termiskin", "daerah dengan ... terbesar"). Panggil
\`get_ranking\` langsung — untuk kabupaten/kota pakai level="kabkota". Menyapu
sendiri daftar provinsi + variabel akan memakan 100+ panggilan dan tetap
kehilangan sebagian wilayah. find_data hanya untuk SATU wilayah.

## Intent Detection (otomatis):
- **Single value** (angka spesifik) → find_data
- **Comparison** ("bandingkan X dan Y") → delegate ke compare_data
- **Trend** ("tren 2019-2024") → delegate ke get_trend
- **Ranking** ("10 provinsi termiskin") → delegate ke get_ranking
- **Table/Breakdown** ("pemeluk agama per kecamatan") → find_data + static table fallback
- **Publication** ("cari publikasi") → delegate ke search

## Quick Reference — Topik Umum

| Topik | Metode Tercepat | var_id (nasional) |
|-------|----------------|-------------------|
| Kemiskinan (jumlah) | find_data atau get_dynamic_data | 183, 185 |
| Kemiskinan (%) | find_data atau get_dynamic_data | 184, 192 |
| Pengangguran (TPT %) | get_dynamic_data(var="543") | 543 |
| Inflasi (YoY) | list_strategic_indicators atau get_dynamic_data | 2263 |
| Pertumbuhan ekonomi | list_strategic_indicators | - |
| IPM | list_strategic_indicators atau get_dynamic_data | 413 |
| Gini Rasio | get_dynamic_data(var="98") | 98 |
| Jumlah Penduduk | get_dynamic_data(var="2781") | 2781 |
| PDRB | list_strategic_indicators(domain=kode_prov) | - |
| Ekspor/Impor | list_strategic_indicators atau get_trade_data | - |
| Agama/Religi | find_data atau list_static_tables | - |
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
- find_data(query="PDRB", region="Bali", year="2023")
- find_data(query="pemeluk agama", region="Kabupaten Jombang")`,
    {
      query: z.string().describe("Deskripsi data yang dicari (misal: jumlah penduduk, angka kemiskinan, inflasi, PDRB, pengangguran, pemeluk agama)"),
      region: z.string().default("Indonesia").describe("Nama wilayah (misal: Indonesia, Jawa Timur, Surabaya, DKI Jakarta). Mendukung nama resmi dan singkatan."),
      year: z.string().optional().describe("Tahun data (misal: '2023' atau '2020,2021,2022,2023' untuk multi-tahun). Kosongkan untuk data terbaru."),
    },
    async ({ query, region, year }) => {
      try {
        // Step 0: Detect intent
        const intent = detectIntent(query, region, year);
        logger.debug(`find_data: detected intent="${intent.intent}" confidence=${intent.confidence.toFixed(2)} tool="${intent.suggestedTool}"`);

        // Prompt Redirection for specialized intents
        const compareRegion1 = intent.extractedParams.region1;
        const compareRegion2 = intent.extractedParams.region2;
        const canRedirect =
          intent.intent !== "comparison" || (!!compareRegion1 && !!compareRegion2);
        if (canRedirect && intent.intent !== "single_value" && intent.intent !== "table" && intent.intent !== "unknown" && intent.confidence >= 0.6) {
          let redirectionText = "";
          if (intent.intent === "comparison") {
            const regions = `${compareRegion1}, ${compareRegion2}`;
            redirectionText = `**Menyalin intensi pencarian: Perbandingan Wilayah**\n` +
              `Query Anda tampaknya merupakan perbandingan data antar wilayah. Silakan panggil tool \`compare_data\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "compare_data",\n` +
              `  "arguments": {\n` +
              `    "query": "${query}",\n` +
              `    "regions": "${regions}"\n` +
              (year ? `    ,"year": "${year}"\n` : "") +
              `  }\n` +
              `}\n` +
              `\`\`\``;
          } else if (intent.intent === "trend") {
            redirectionText = `**Menyalin intensi pencarian: Tren Multi-Tahun**\n` +
              `Query Anda tampaknya menanyakan perkembangan/tren data dari tahun ke tahun. Silakan panggil tool \`get_trend\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "get_trend",\n` +
              `  "arguments": {\n` +
              `    "query": "${query}",\n` +
              `    "region": "${region}"\n` +
              `  }\n` +
              `}\n` +
              `\`\`\``;
          } else if (intent.intent === "ranking") {
            const kabkotaLevel = /\b(kabupaten|kabkota|kab\/kota|kabupaten\/kota)\b/i.test(query);
            redirectionText = `**Menyalin intensi pencarian: Peringkat/Ranking**\n` +
              `Query Anda tampaknya meminta peringkat data wilayah. Silakan panggil tool \`get_ranking\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "get_ranking",\n` +
              `  "arguments": {\n` +
              `    "query": "${query}",\n` +
              `    "top_n": 10,\n` +
              `    "order": "highest",\n    "level": "${kabkotaLevel ? "kabkota" : "provinsi"}"` +
              `\n  }\n` +
              `}\n` +
              `\`\`\``;
          } else if (intent.intent === "publication") {
            redirectionText = `**Menyalin intensi pencarian: Publikasi/Dokumen**\n` +
              `Query Anda tampaknya mencari publikasi atau dokumen statistik. Silakan panggil tool \`search\` atau \`allstats_search\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "search",\n` +
              `  "arguments": {\n` +
              `    "keyword": "${query}",\n` +
              `    "type": "publication"\n` +
              `  }\n` +
              `}\n` +
              `\`\`\``;
          }

          if (redirectionText) {
            return {
              content: [{
                type: "text",
                text: appendAttribution(redirectionText + `\n\n_Catatan: Penggunaan tool spesifik di atas jauh lebih efisien dan akurat daripada find_data untuk query jenis ini._`)
              }]
            };
          }
        }

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

        // Headline topics without a year are best answered by strategic indicators
        // (e.g. "inflasi" → the latest national YoY figure, not 150 kabupaten rows).
        const kw = normalizeKeyword(query);
        if (!year && isHeadlineQuery(kw)) {
          const headline = await tryStrategicIndicators(client, kw, domain, domainName, undefined, true);
          if (headline) return headline;
        }

        // Step 2: Find variable via learned mapping → relevance search.
        // When a year is requested, only accept a variable that actually has
        // that year (otherwise BPS may silently return an older series).
        const asksBreakdown = /\b(kabupaten|kebupaten|kab[/\s]kota|kecamatan|per\s*kab|per\s*kec|desa|kelurahan)\b/.test(query.toLowerCase());
        const yearList = year
          ? year.split(/[,;]/).map((value) => value.trim()).filter(Boolean)
          : [];
        const learned = asksBreakdown ? null : await lookupVar(query, domain, store);
        const resolved = await resolveVariableForYears(client, store, query, domain, yearList, {
          skipLearned: asksBreakdown,
          maxCandidates: 20,
        });
        let bestVar = resolved?.varData ?? null;
        let resolvedPeriods = resolved?.periods ?? [];
        const candidates = resolved?.candidates ?? [];
        let fromLearning = !!learned && !!bestVar && learned.var_id === bestVar.var_id;
        const matchedYears = resolved?.matchedYears ?? [];
        const missingYears = yearList.filter((value) => !matchedYears.includes(value));

        if (yearList.length > 0 && matchedYears.length === 0) {
          bestVar = null;
          resolvedPeriods = [];
        }

        if (!bestVar) {
          // Fallback: try strategic indicators
          const indResult = await tryStrategicIndicators(client, kw, domain, domainName, year);
          if (indResult) return indResult;

          // Fallback: try static tables with keyword strategies
          try {
            const staticText = await staticTableFallback(client, domain, domainName, kw, query);
            if (staticText) {
              return { content: [{ type: "text", text: appendAttribution(staticText) }] };
            }
          } catch (staticTableError) {
            logger.debug(`find_data: static table fallback failed: ${staticTableError instanceof Error ? staticTableError.message : "unknown"}`);
          }

          const allStatsQuery = `${query} ${domainName}`.trim();
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ditemukan data "${query}" untuk ${domainName}.\n\n` +
                `**Saran:**\n` +
                `1. Gunakan \`find_variable(keyword="${query}", domain="${domain}")\` untuk mencari variabel yang lebih spesifik\n` +
                `2. Gunakan \`search(keyword="${query}")\` untuk pencarian lebih luas\n` +
                `3. Gunakan \`list_strategic_indicators(domain="${domain}")\` untuk indikator utama\n` +
                `4. Gunakan \`allstats_search(query="${allStatsQuery}", content="table")\` untuk mencari tabel di AllStats\n` +
                `5. Gunakan \`allstats_deep_search(query="${allStatsQuery}")\` untuk mencari teks di dalam PDF publikasi\n\n` +
                `**Catatan:** Beberapa data (seperti agama) hanya tersedia di website BPS daerah, tidak di WebAPI.`
              ),
            }],
          };
        }

        // Step 3: Resolve period
        logger.debug(`find_data: using var_id=${bestVar.var_id} (${bestVar.title}) for query="${query}"`);
        const periodParam = await resolvePeriod(client, store, bestVar.var_id, domain, year, resolvedPeriods);

        // Step 4: Get data
        let result = await client.getDynamicData(domain, String(bestVar.var_id), periodParam);

        // A provincial domain can expose a national table whose only row is
        // "Indonesia" — that is not the region's figure. Treat it as no data so
        // the candidate fallback below can find a table with a real region row.
        const usable = (response: BpsDynamicDataResponse | undefined): boolean =>
          !!response?.datacontent &&
          Object.keys(response.datacontent).length > 0 &&
          (domain === "0000" || hasRegionRow(response, domain, domainName));

        // Self-healing: if data empty and var came from learning, invalidate and retry search
        if (!usable(result) && fromLearning) {
          logger.debug(`find_data: self-healing — invalidating learned var_id=${bestVar.var_id}`);
          await invalidateVar(query, domain, store);
          if (year) {
            for (const y of year.split(",")) await invalidatePeriod(bestVar.var_id, domain, y.trim(), store);
          }

          const retryCandidates = await searchVariables(client, domain, kw, {
            maxSubjects: 6,
            maxPagesPerSubject: 6,
            maxCandidates: 20,
          });
          const retryVar = retryCandidates[0];
          if (retryVar) {
            bestVar = {
              var_id: retryVar.var_id,
              title: retryVar.title,
              sub_name: retryVar.sub_name,
              unit: retryVar.unit,
            };
            fromLearning = false;
            const retryPeriod = await resolvePeriod(client, store, bestVar.var_id, domain, year);
            result = await client.getDynamicData(domain, String(bestVar.var_id), retryPeriod);
            candidates.push(...retryCandidates);
          }
        }

        // If the best variable has no data, try the next candidates before
        // falling back to static tables.
        if (!usable(result) && candidates.length > 1) {
          for (const candidate of candidates.slice(1, 4)) {
            if (candidate.var_id === bestVar.var_id) continue;
            try {
              let candidatePeriod = await resolvePeriod(client, store, candidate.var_id, domain, year);
              // Never fall back to a year the caller did not ask for.
              if (yearList.length > 0) {
                const resolvedYears = await resolvePeriodsForSpec(
                  client,
                  domain,
                  candidate.var_id,
                  yearList.join(",")
                );
                if (resolvedYears.entries.length === 0) continue;
                candidatePeriod = resolvedYears.entries.map((entry) => entry.id).join(";");
              }
              const candidateResult = await client.getDynamicData(domain, String(candidate.var_id), candidatePeriod);
              if (usable(candidateResult)) {
                bestVar = {
                  var_id: candidate.var_id,
                  title: candidate.title,
                  sub_name: candidate.sub_name,
                  unit: candidate.unit,
                };
                result = candidateResult;
                fromLearning = false;
                logger.debug(`find_data: candidate fallback → var_id=${bestVar.var_id}`);
                break;
              }
            } catch (candidateError) {
              logger.debug(
                `find_data: candidate var_id=${candidate.var_id} failed: ${
                  candidateError instanceof Error ? candidateError.message : "unknown"
                }`
              );
            }
          }
        }

        // Fallback for kab/kota domains: try parent province if no data
        if (!usable(result) &&
            domain !== "0000" && domain.length === 4 && !domain.endsWith("00")) {
          const parentDomain = domain.slice(0, 2) + "00";
          const parentCandidates = await searchVariables(client, parentDomain, kw, {
            maxSubjects: 6,
            maxPagesPerSubject: 6,
            maxCandidates: 10,
          });
          const parentVar = (await lookupVar(query, parentDomain, store)) || parentCandidates[0] || null;
          if (parentVar) {
            const parentPeriod = await resolvePeriod(client, store, parentVar.var_id, parentDomain, year);
            const parentResult = await client.getDynamicData(parentDomain, String(parentVar.var_id), parentPeriod);
            if (parentResult.datacontent && Object.keys(parentResult.datacontent).length > 0 &&
                (parentDomain === "0000" || hasRegionRow(parentResult, parentDomain, undefined))) {
              const relevantParent = filterRelevantVervar(parentResult, parentDomain);
              const parentFormatted = formatDynamicData(relevantParent, parentDomain, config.defaultLang, {
                includeAttribution: false,
              });
              const parentHeader = `**Pencarian:** "${query}" di ${domainName}${year ? ` (${year})` : ""}\n**Variabel:** ${parentVar.title} (ID: ${parentVar.var_id})\n_Data diambil dari domain provinsi induk (${parentDomain})_\n\n`;
              return { content: [{ type: "text", text: appendAttribution(parentHeader + parentFormatted) }] };
            }
          }
        }

        // Still no data after retry — try static tables as fallback
        if (!usable(result)) {
          try {
            const staticText = await staticTableFallback(client, domain, domainName, kw, query);
            if (staticText) {
              return { content: [{ type: "text", text: appendAttribution(staticText) }] };
            }
          } catch (staticTableError) {
            logger.debug(`find_data: static table fallback failed: ${staticTableError instanceof Error ? staticTableError.message : "unknown"}`);
          }

          const altLines = [
            `Data untuk variabel "${bestVar.title}" tidak tersedia${year ? ` untuk tahun ${year}` : ""} di ${domainName}.`,
            "",
          ];
          const alternatives = candidates.filter((candidate) => candidate.var_id !== bestVar.var_id);
          if (alternatives.length > 0) {
            altLines.push("**Variabel alternatif yang ditemukan:**");
            for (const c of alternatives.slice(0, 5)) {
              const unit = formatUnit(c.unit);
              altLines.push(`- ${c.title} (var_id: \`${c.var_id}\`)${unit ? ` — ${unit}` : ""}`);
            }
            altLines.push("");
            altLines.push("Gunakan `get_dynamic_data` dengan var_id di atas untuk mencoba variabel lain.");
          }
          return { content: [{ type: "text", text: appendAttribution(altLines.join("\n")) }] };
        }

        // Success — learn the variable mapping and show the aggregate for large
        // region breakdowns so the output stays useful for an LLM.
        await learnVar(query, domain, bestVar, store);

        const relevantResult = filterRelevantVervar(
          result,
          domain,
          domainName,
          asksBreakdown ? 10_000 : 10
        );
        const filteredNote = relevantResult === result
          ? ""
          : "\n_Menampilkan agregat wilayah. Gunakan get_dynamic_data untuk rincian lengkap._\n";
        const formatted = formatDynamicData(relevantResult, domain, config.defaultLang, {
          includeAttribution: false,
        });
        const missingNote =
          missingYears.length > 0 && matchedYears.length > 0
            ? `\n_Catatan: tahun ${missingYears.join(", ")} tidak tersedia untuk variabel ini; data yang ditampilkan hanya tahun ${matchedYears.join(", ")}._\n`
            : "";
        const header = `**Pencarian:** "${query}" di ${domainName}${year ? ` (${year})` : ""}\n**Variabel:** ${bestVar.title} (ID: ${bestVar.var_id})\n${filteredNote}${missingNote}\n`;

        const hints = generateResultHints(query, domain, domainName, bestVar.var_id, bestVar.title);
        const hintsText = hints.length > 0 ? "\n\n**💡 Tips Lanjutan:**\n" + hints.join("\n") : "";

        return { content: [{ type: "text", text: appendAttribution(header + formatted + hintsText) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Gagal mengambil data";
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );
}

/** Headline topics that are best answered by strategic indicators when no year is given. */
const HEADLINE_PATTERNS = [
  /\binflasi\b/,
  /\bpertumbuhan ekonomi\b/,
  /\bpengangguran\b/,
  /\bkemiskinan\b/,
  /\bmiskin\b/,
  /\bgini\b/,
  /\bketimpangan\b/,
  /\bipm\b/,
  /\bindeks pembangunan manusia\b/,
  /\bekspor\b/,
  /\bimpor\b/,
  /\bneraca perdagangan\b/,
];

function isHeadlineQuery(normalizedQuery: string): boolean {
  return HEADLINE_PATTERNS.some((pattern) => pattern.test(normalizedQuery));
}

/** Resolve year to period IDs, using learning store first. */
async function resolvePeriod(
  client: BpsClient,
  store: IPersistentStore | null,
  varId: number,
  domain: string,
  year: string | undefined,
  knownPeriods?: unknown[]
): Promise<string | undefined> {
  if (!year) {
    // No year specified — get latest available period
    try {
      const periods = knownPeriods && knownPeriods.length > 0
        ? knownPeriods
        : await client.listPeriods(domain, varId, 1);
      if (periods.length > 0) {
        // periods are typically sorted descending; take the first (latest)
        return getPeriodId(periods[0]) || undefined;
      }
    } catch { /* fall through */ }
    return undefined;
  }

  const yearNums = year.split(/[,;]/).map(y => y.trim()).filter(Boolean);

  try {
    const periods = knownPeriods && knownPeriods.length > 0
      ? knownPeriods
      : await listAllPeriodsSafe(client, domain, varId);
    if (periods.length > 0) {
      const matchingPeriods = periods.filter(p => {
        const label = getPeriodLabel(p);
        return yearNums.some(y => label.includes(y));
      });
      if (matchingPeriods.length > 0) {
        for (const p of matchingPeriods) {
          const label = getPeriodLabel(p);
          const id = getPeriodId(p);
          const matchedYear = yearNums.find(y => label.includes(y));
          if (matchedYear && id) {
            await learnPeriod(varId, domain, matchedYear, id, store);
          }
        }
        return matchingPeriods.map(p => getPeriodId(p)).filter(Boolean).join(",");
      }
    }
  } catch {
    // If period lookup fails, no usable period.
  }
  return undefined;
}

async function listAllPeriodsSafe(client: BpsClient, domain: string, varId: number): Promise<unknown[]> {
  const maybeAll = (client as BpsClient & {
    listAllPeriods?: (domain?: string, varId?: number) => Promise<unknown[]>;
  }).listAllPeriods;
  if (typeof maybeAll === "function") {
    return maybeAll.call(client, domain, varId);
  }
  return client.listPeriods(domain, varId);
}

/** Try strategic indicators as fallback (also used as a headline shortcut). */
async function tryStrategicIndicators(
  client: BpsClient,
  kw: string,
  domain: string,
  domainName: string,
  year: string | undefined,
  headlineNote = false
): Promise<{ content: Array<{ type: "text"; text: string }> } | null> {
  const indicators = await client.listStrategicIndicators(domain);
  if (!indicators.data || indicators.data.length === 0) return null;

  const terms = expandQueryTerms(kw);
  let best: { indicator: (typeof indicators.data)[number]; score: number } | null = null;

  for (const indicator of indicators.data) {
    const titleLower = indicator.title.toLowerCase();
    let score = 0;
    if (titleLower.includes(kw)) score += 40;
    for (const term of terms) {
      if (term.length > 2 && titleLower.includes(term)) score += 10;
    }
    if (score === 0) continue;
    if (year && !indicator.periode.includes(year)) continue;
    if (!best || score > best.score) best = { indicator, score };
  }

  if (!best) return null;

  const indicator = best.indicator;
  const val = typeof indicator.value === "number"
    ? indicator.value.toLocaleString("id-ID")
    : String(indicator.value);
  const unit = formatUnit(indicator.unit);
  const lines = [
    `## ${indicator.title}`,
    `**Wilayah:** ${domainName} (${domain})`,
    "",
    `| Periode | Nilai |`,
    `| --- | --- |`,
    `| ${indicator.periode} | ${val}${unit ? ` ${unit}` : ""} |`,
  ];
  if (indicator.name) {
    lines.push("", `_${indicator.name}_`);
  }
  if (headlineNote) {
    lines.push("", "_Data headline terbaru. Untuk data historis, gunakan `get_trend` atau `find_data` dengan parameter `year`._");
  }
  return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
}

/**
 * Search variables within a subject (or all if undefined) and add matches to results array.
 */
async function searchVariablesInSubject(
  client: BpsClient,
  domain: string,
  subject: number | undefined,
  keyword: string,
  results: Array<{ var_id: number; title: string; sub_name: string; unit?: string; def?: string }>
): Promise<void> {
  let firstPage;
  try {
    firstPage = await client.listVariables(domain, subject, undefined, 1, 100);
  } catch (error) {
    logger.debug(`searchVariablesInSubject failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!firstPage.data || firstPage.data.length === 0) return;

  const pages = Math.min(firstPage.page?.pages ?? 1, 6);
  const scored: Array<{ variable: (typeof firstPage.data)[number]; score: number }> = [];

  for (let page = 1; page <= pages; page++) {
    const result = page === 1
      ? firstPage
      : await client.listVariables(domain, subject, undefined, page, 100);
    if (!result.data || result.data.length === 0) break;

    for (const variable of result.data) {
      // Raw keyword: "jumlah"/"persentase" carry the measure and are stopwords.
      const score = computeRelevanceScore(keyword, variable.title, variable.sub_name, variable.def);
      if (score > 0) scored.push({ variable, score });
    }
    if (scored.length >= 30) break;
  }

  scored.sort((a, b) => b.score - a.score);
  for (const { variable } of scored.slice(0, 15)) {
    if (results.some((existing) => existing.var_id === variable.var_id)) continue;
    results.push({
      var_id: variable.var_id,
      title: variable.title,
      sub_name: variable.sub_name,
      unit: variable.unit,
      def: variable.def,
    });
  }
}

/**
 * Search static tables, prefer a title match, and return a compact markdown
 * table. Returns null when no relevant table is found (rather than showing an
 * unrelated first result).
 */
async function staticTableFallback(
  client: BpsClient,
  domain: string,
  domainName: string,
  kw: string,
  query: string
): Promise<string | null> {
  const words = kw.split(/\s+/).filter(Boolean);
  let tableDomain = domain;
  let tables = await safeListStaticTables(client, domain, kw);

  if (tables.length === 0 && words.length > 1) {
    const lastTwo = words.slice(-2).join(" ");
    tables = await safeListStaticTables(client, domain, lastTwo);
    if (tables.length === 0) {
      const firstTwo = words.slice(0, 2).join(" ");
      tables = await safeListStaticTables(client, domain, firstTwo);
    }
  }

  if (tables.length === 0 && words.length <= 2 && kw !== "penduduk") {
    tables = await safeListStaticTables(client, domain, "penduduk");
  }

  if (tables.length === 0) {
    tables = await safeListStaticTables(client, domain, undefined);
  }

  if (tables.length === 0 && domain.length === 4 && !domain.endsWith("00")) {
    const parentDomain = `${domain.slice(0, 2)}00`;
    tableDomain = parentDomain;
    tables = await safeListStaticTables(client, parentDomain, kw);
    if (tables.length === 0 && words.length > 1) {
      tables = await safeListStaticTables(client, parentDomain, words.slice(-2).join(" "));
    }
    if (tables.length === 0) {
      tables = await safeListStaticTables(client, parentDomain, "penduduk");
    }
  }

  const asksBreakdown = /\b(kabupaten|kecamatan|desa|kelurahan|per\s*kab|per\s*kec)\b/i.test(query);
  const searchTerms = [kw, ...words.filter((word) => word.length > 2)];
  const queryText = query.toLowerCase();
  const scoredTables = tables
    .map((table) => {
      const title = table.title.toLowerCase();
      const subject = (table.subj ?? "").toLowerCase();
      const topicHits = searchTerms.filter((term) => title.includes(term)).length;
      if (topicHits === 0) return { table, score: 0 };
      // Topic first, region second: the table already comes from the region's
      // domain, so a region name in the title says little about the topic.
      let score = 20 + topicHits * 15;
      if (title.includes(kw)) score += 15;
      if (domainName && title.includes(domainName.toLowerCase())) score += 10;
      if (title.includes("kabupaten")) score += 5;
      if (title.includes("jumlah") || title.includes("penduduk")) score += 5;
      // "<population> menurut <topic>" is usually the table the caller means.
      if (title.includes("menurut") && searchTerms.some((term) => title.includes(term))) score += 10;
      if (searchTerms.some((term) => term.length > 3 && subject.includes(term))) score += 15;
      // Kabupaten domains publish court statistics ("pengadilan agama") that
      // match religion keywords by institution name, not by topic.
      if (
        /\bpengadilan\b|\bperkara\b|\bperceraian\b/.test(title) &&
        !/\bpengadilan\b|\bperkara\b|\bperceraian\b/.test(queryText)
      ) {
        score -= 40;
      }
      if (/desa|kelurahan|kecamatan/.test(title)) {
        score += asksBreakdown ? 15 : -25;
      }
      return { table, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredTables.length === 0) return null;

  let framesetFallback: string | null = null;
  for (const { table } of scoredTables.slice(0, 5)) {
    let detail;
    try {
      detail = await client.getStaticTable(tableDomain, table.table_id);
    } catch {
      continue;
    }
    const tableText = htmlTableToMarkdown(detail.table);
    const lines = [
      `**Pencarian:** "${query}" di ${domainName}`,
      `**Sumber:** Tabel Statis — ${detail.title}`,
    ];
    if (tableDomain !== domain) {
      lines.push(`_Tabel berasal dari domain provinsi induk (${tableDomain})._`);
    }
    lines.push("", tableText);
    lines.push(
      "",
      `**Detail/Excel:** get_static_table(domain="${tableDomain}", id=${detail.table_id})`
    );

    if (tableText.startsWith("_Tabel ini disajikan BPS sebagai file Excel")) {
      framesetFallback = framesetFallback ?? lines.join("\n");
      continue;
    }
    return lines.join("\n");
  }

  return framesetFallback;
}

/**
 * Safely lists static tables without throwing on BpsNotFoundError.
 */
async function safeListStaticTables(
  client: BpsClient,
  domain: string,
  keyword?: string,
  maxPages = 3
): Promise<BpsStaticTable[]> {
  const results: BpsStaticTable[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await client.listStaticTables(domain, keyword, undefined, undefined, page);
      for (const table of res.data || []) {
        if (seen.has(table.table_id)) continue;
        seen.add(table.table_id);
        results.push(table);
      }
      const pages = res.page?.pages ?? 1;
      if (page >= Math.min(pages, maxPages) || (res.data?.length ?? 0) === 0) break;
    } catch (err) {
      logger.debug(`safeListStaticTables failed for keyword="${keyword}" page=${page}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  return results;
}

