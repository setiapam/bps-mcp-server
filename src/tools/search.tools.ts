import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient, AllStatsSearchResponse } from "../client/allstats-client.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";
import { BpsNotFoundError } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import { stripHtml } from "../utils/html.js";
import { formatUnit } from "../client/fields.js";
import type {
  BpsPressRelease,
  BpsPublication,
  BpsStaticTable,
  BpsStrategicIndicator,
} from "../client/types.js";

/** Map WebAPI type names to AllStats content types */
const WEBAPI_TO_ALLSTATS_CONTENT: Record<string, string> = {
  statictable: "table",
  pressrelease: "pressrelease",
  publication: "publication",
  strategicindicator: "table",
};

function truncate(text: string | null | undefined, max = 220): string {
  if (!text) return "";
  const clean = stripHtml(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Format WebAPI search results without dumping huge JSON/base64 URLs. */
function formatWebApiResults(data: unknown[], keyword: string, type?: string): string {
  const lines: string[] = [`## Hasil Pencarian: "${keyword}"`, ""];
  lines.push(`**Ditemukan:** ${data.length} hasil`);
  lines.push("");

  const inferredType = type || (
    data[0] && typeof data[0] === "object" && "table_id" in (data[0] as object)
      ? "statictable"
      : data[0] && typeof data[0] === "object" && "brs_id" in (data[0] as object)
        ? "pressrelease"
        : data[0] && typeof data[0] === "object" && "pub_id" in (data[0] as object)
          ? "publication"
          : data[0] && typeof data[0] === "object" && "indicator_id" in (data[0] as object)
            ? "strategicindicator"
            : "unknown"
  );

  for (let index = 0; index < Math.min(data.length, 10); index++) {
    const item = data[index] as Record<string, unknown>;
    const number = index + 1;

    if (inferredType === "statictable") {
      const table = item as unknown as BpsStaticTable;
      lines.push(`${number}. **${stripHtml(table.title)}**`);
      lines.push(`   - ID: \`${table.table_id}\` | Subjek: ${table.subj ?? "-"}${table.updt_date ? ` | Update: ${table.updt_date}` : ""}`);
      continue;
    }

    if (inferredType === "pressrelease") {
      const release = item as unknown as BpsPressRelease;
      lines.push(`${number}. **${stripHtml(release.title)}**`);
      lines.push(`   - ID: \`${release.brs_id}\` | Tanggal: ${release.rl_date}`);
      const abstract = truncate(release.abstract);
      if (abstract) lines.push(`   - ${abstract}`);
      continue;
    }

    if (inferredType === "publication") {
      const publication = item as unknown as BpsPublication;
      lines.push(`${number}. **${stripHtml(publication.title)}**`);
      lines.push(`   - ID: \`${publication.pub_id}\` | Rilis: ${publication.rl_date}${publication.issn ? ` | ISSN: ${publication.issn}` : ""}`);
      const abstract = truncate(publication.abstract);
      if (abstract) lines.push(`   - ${abstract}`);
      continue;
    }

    if (inferredType === "strategicindicator") {
      const indicator = item as unknown as BpsStrategicIndicator;
      const unit = formatUnit(indicator.unit);
      lines.push(`${number}. **${stripHtml(indicator.title)}**`);
      lines.push(`   - ${indicator.value}${unit ? ` ${unit}` : ""} (${indicator.periode})`);
      continue;
    }

    const safe = JSON.stringify(
      item,
      (_key, value) => (typeof value === "string" && value.length > 220 ? `${value.slice(0, 220)}…` : value),
      2
    );
    lines.push(`${number}. \`\`\`json\n${safe}\n\`\`\``);
  }

  if (data.length > 10) {
    lines.push("", `_Menampilkan 10 dari ${data.length} hasil pada halaman ini._`);
  }
  return lines.join("\n");
}

function formatAllStatsFallback(res: AllStatsSearchResponse): string {
  const lines: string[] = [];
  lines.push(`### Hasil dari AllStats Search (fallback)`);
  lines.push(
    `Ditemukan **${res.totalResults.toLocaleString("id-ID")}** hasil via AllStats Search Engine`
  );
  lines.push("");

  for (let i = 0; i < res.results.length; i++) {
    const r = res.results[i];
    lines.push(`**${i + 1}. ${r.title}**`);
    if (r.description) lines.push(`> ${r.description}`);
    lines.push(`- Tipe: ${r.contentType} | Sumber: ${r.domain}`);
    if (r.url) lines.push(`- URL: ${r.url}`);
    if (r.deepSearchId) {
      lines.push(
        `- Deep Search ID: \`${r.deepSearchId}\` _(gunakan allstats_deep_search untuk cari di dalam publikasi)_`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerSearchTools(
  server: McpServer,
  client: BpsClient,
  allStatsClient?: AllStatsClient
): void {
  server.tool(
    "search",
    `Pencarian data lintas tipe di BPS (tabel statis, publikasi, BRS, indikator).

Kapan menggunakan tool ini:
- Mencari tabel statis atau publikasi berdasarkan topik
- Mencari BRS (Berita Resmi Statistik) terbaru
- Pencarian umum ketika find_data tidak menemukan hasil

Kapan TIDAK menggunakan tool ini:
- Jika user minta data angka spesifik → gunakan find_data
- Jika sudah tahu variabel ID → gunakan get_dynamic_data

Jika WebAPI tidak menemukan hasil, otomatis fallback ke AllStats Search Engine.`,
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      keywords: z.string().optional().describe("Alias untuk 'keyword'."),
      query: z.string().optional().describe("Alias untuk 'keyword'."),
      type: z
        .string()
        .optional()
        .describe(
          "Filter tipe hasil: 'statictable', 'pressrelease', 'publication', 'strategicindicator' (opsional)"
        ),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword: keywordInput, keywords, query, type, page }) => {
      const keyword = keywordInput ?? keywords ?? query;
      if (!keyword || !keyword.trim()) {
        return {
          content: [{
            type: "text",
            text: "Parameter 'keyword' wajib diisi, misal search(keyword=\"kemiskinan\").",
          }],
          isError: true,
        };
      }
      // --- Step 1: Try WebAPI ---
      let webapiError: unknown = null;

      const searchWebAPI = async (kw: string) => {
        try {
          const res = await client.search(domain, kw, type, page);
          if (res.data && res.data.length > 0) return res;
        } catch (err) {
          webapiError = err;
          logger.debug(`WebAPI search failed for "${kw}": ${err instanceof Error ? err.message : "unknown"}`);
        }
        return null;
      };

      let webapiResult = await searchWebAPI(keyword);

      // Fallback Strategy: If empty and keyword has multiple words, try splitting it
      if (!webapiResult && keyword.split(/\s+/).length > 1) {
        const words = keyword.split(/\s+/);
        // Try last 2 words
        const lastTwo = words.slice(-2).join(" ");
        logger.debug(`WebAPI search fallback: retrying with "${lastTwo}"`);
        webapiResult = await searchWebAPI(lastTwo);

        if (!webapiResult) {
          // Try first 2 words
          const firstTwo = words.slice(0, 2).join(" ");
          logger.debug(`WebAPI search fallback: retrying with "${firstTwo}"`);
          webapiResult = await searchWebAPI(firstTwo);
        }
      }

      // Check if WebAPI returned data
      const webapiHasData =
        webapiResult !== null &&
        Array.isArray(webapiResult.data) &&
        webapiResult.data.length > 0;

      if (webapiHasData && webapiResult) {
        // WebAPI returned results — format them instead of dumping raw JSON
        const lines = [formatWebApiResults(webapiResult.data, keyword, type)];
        if (webapiResult.page) {
          lines.push(
            "",
            `_Halaman ${webapiResult.page.page} dari ${webapiResult.page.pages} (total: ${webapiResult.page.total}). Gunakan parameter \`page\` untuk halaman berikutnya._`
          );
        }
        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      }

      // --- Step 2: Fallback to AllStats ---
      if (allStatsClient) {
        try {
          const allStatsContent =
            type && WEBAPI_TO_ALLSTATS_CONTENT[type]
              ? WEBAPI_TO_ALLSTATS_CONTENT[type]
              : "all";

          const allStatsResult = await allStatsClient.search({
            query: keyword,
            content: allStatsContent as "all",
            domain,
            page: page || 1,
          });

          if (allStatsResult.results.length > 0) {
            const parts: string[] = [];
            parts.push(`## Hasil Pencarian: "${keyword}"\n`);

            // Indicate fallback if WebAPI was attempted
            if (webapiError) {
              parts.push(
                `> **Catatan:** WebAPI BPS tidak tersedia (${webapiError instanceof Error ? webapiError.message : "error"}). Menampilkan hasil dari AllStats Search.\n`
              );
            } else if (webapiResult && !webapiHasData) {
              parts.push(
                `> **Catatan:** WebAPI BPS tidak menemukan hasil untuk "${keyword}". Menampilkan hasil dari AllStats Search.\n`
              );
            }

            parts.push(formatAllStatsFallback(allStatsResult));

            const text = appendAttribution(parts.join("\n"));
            return { content: [{ type: "text", text }] };
          }
        } catch (allStatsError) {
          logger.debug(
            `AllStats fallback also failed for "${keyword}": ${allStatsError instanceof Error ? allStatsError.message : "unknown"}`
          );
          // If both fail, return the original error
        }
      }

      // --- Step 3: Both failed or no results ---
      if (webapiError) {
        // WebAPI had an error and AllStats also failed or not available
        if (webapiError instanceof BpsNotFoundError) {
          return {
            content: [
              {
                type: "text",
                text: `Tidak ditemukan hasil untuk "${keyword}" di WebAPI maupun AllStats Search.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: formatErrorForUser(webapiError) }],
          isError: true,
        };
      }

      // WebAPI returned empty
      return {
        content: [
          {
            type: "text",
            text: `Tidak ditemukan hasil untuk "${keyword}".`,
          },
        ],
        isError: true,
      };
    }
  );
}
