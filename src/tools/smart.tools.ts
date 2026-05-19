import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import { formatDynamicData } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { logger } from "../utils/logger.js";

/**
 * AI-friendly shortcut tools that reduce multi-step workflows to single calls.
 */
export function registerSmartTools(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver,
  config: Config
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
          // Find relevant subjects first, then search within them
          const subjects = await client.listSubjects(domain);
          const relevantSubjects = subjects.data.filter(s => {
            const titleLower = s.title.toLowerCase();
            return kw.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w)) || titleLower.includes(kw);
          });

          // Search in relevant subjects first
          for (const sub of relevantSubjects.slice(0, 5)) {
            await searchVariablesInSubject(client, domain, sub.sub_id, kw, allVars);
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

Contoh:
- find_data(query="jumlah penduduk", region="Jawa Timur", year="2023")
- find_data(query="angka kemiskinan", region="Indonesia", year="2020,2021,2022,2023")
- find_data(query="tingkat pengangguran", region="DKI Jakarta")
- find_data(query="PDRB", region="Bali", year="2023")
- find_data(query="inflasi", region="Indonesia", year="2024")

Jika hasilnya tidak sesuai, gunakan find_variable untuk mencari variabel yang lebih spesifik, lalu get_dynamic_data.`,
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

        // Step 2: Find matching variable by searching relevant subjects
        const kw = query.toLowerCase();
        let bestVar: { var_id: number; title: string; sub_name: string; unit?: string } | null = null;
        const candidates: Array<{ var_id: number; title: string; sub_name: string; unit?: string; score: number }> = [];

        // Find relevant subjects
        const subjects = await client.listSubjects(domain);
        const relevantSubjects = subjects.data.filter(s => {
          const titleLower = s.title.toLowerCase();
          return kw.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w)) || titleLower.includes(kw);
        });

        // Search in relevant subjects
        for (const sub of relevantSubjects.slice(0, 5)) {
          const result = await client.listVariables(domain, sub.sub_id, undefined, 1, 100);
          if (!result.data || result.data.length === 0) continue;

          for (const v of result.data) {
            const titleLower = v.title.toLowerCase();
            const score = computeRelevanceScore(kw, titleLower, v.sub_name?.toLowerCase() || "");
            if (score > 0) {
              candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit, score });
            }
          }
          if (candidates.length >= 10) break;
        }

        // If no results from subject-based search, try without subject filter
        if (candidates.length === 0) {
          const domainsToSearch = domain === "0000" ? ["0000"] : [domain, "0000"];
          for (const searchDomain of domainsToSearch) {
            for (let page = 1; page <= 2; page++) {
              const result = await client.listVariables(searchDomain, undefined, undefined, page, 100);
              if (!result.data || result.data.length === 0) break;
              for (const v of result.data) {
                const titleLower = v.title.toLowerCase();
                const score = computeRelevanceScore(kw, titleLower, v.sub_name?.toLowerCase() || "");
                if (score > 0) {
                  candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit, score });
                }
              }
              if (candidates.length >= 5) break;
              if (result.data.length < 100) break;
            }
            if (candidates.length >= 5) break;
          }
        }

        // Sort by relevance score
        candidates.sort((a, b) => b.score - a.score);
        bestVar = candidates[0] || null;

        if (!bestVar) {
          // Fallback: try strategic indicators
          const indicators = await client.listStrategicIndicators(domain);
          if (indicators.data && indicators.data.length > 0) {
            for (const ind of indicators.data) {
              const titleLower = ind.title.toLowerCase();
              if (titleLower.includes(kw) || kw.split(/\s+/).some(w => titleLower.includes(w))) {
                // Return strategic indicator data directly
                const lines = [
                  `## ${ind.title}`,
                  `**Wilayah:** ${domainName} (${domain})`,
                  "",
                ];
                if (ind.data) {
                  lines.push("| Periode | Nilai |");
                  lines.push("| --- | --- |");
                  const entries = Object.entries(ind.data);
                  // Filter by year if specified
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
          }

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

        // Step 3: Get data
        logger.debug(`find_data: using var_id=${bestVar.var_id} (${bestVar.title}) for query="${query}"`);

        // Resolve year to period IDs if needed
        let periodParam = year;
        if (year) {
          try {
            const periods = await client.listPeriods(domain, bestVar.var_id);
            if (periods.length > 0) {
              const yearNums = year.split(",").map(y => y.trim());
              // BPS API returns periods with various field names: th_name, th, val
              const matchingPeriods = periods.filter(p => {
                const pAny = p as unknown as Record<string, unknown>;
                const thName = String(pAny.th_name || pAny.th || "");
                const thVal = String(pAny.val || "");
                const thId = String(p.th_id);
                return yearNums.some(y => thName.includes(y) || thVal.includes(y) || thId === y);
              });
              if (matchingPeriods.length > 0) {
                periodParam = matchingPeriods.map(p => String(p.th_id)).join(",");
              }
            }
          } catch {
            // If period lookup fails, try with raw year value
          }
        }

        const result = await client.getDynamicData(domain, String(bestVar.var_id), periodParam);
        const formatted = formatDynamicData(result, domain, config.defaultLang);

        // Prepend context
        const header = `**Pencarian:** "${query}" di ${domainName}${year ? ` (${year})` : ""}\n**Variabel:** ${bestVar.title} (ID: ${bestVar.var_id})\n\n`;

        // If no datacontent, show alternatives
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

        return { content: [{ type: "text", text: header + formatted }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Gagal mengambil data";
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );
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

  // Penalize very long titles (likely too specific/composite)
  if (title.length > 100) score -= 10;

  return score;
}
