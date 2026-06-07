import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient, AllStatsSearchResponse } from "../client/allstats-client.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";
import { BpsNotFoundError } from "../utils/error.js";
import { logger } from "../utils/logger.js";

/** Map WebAPI type names to AllStats content types */
const WEBAPI_TO_ALLSTATS_CONTENT: Record<string, string> = {
  statictable: "table",
  pressrelease: "pressrelease",
  publication: "publication",
  strategicindicator: "table",
};

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
      keyword: z.string().describe("Kata kunci pencarian"),
      type: z
        .string()
        .optional()
        .describe(
          "Filter tipe hasil: 'statictable', 'pressrelease', 'publication', 'strategicindicator' (opsional)"
        ),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, type, page }) => {
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

      if (webapiHasData) {
        // WebAPI returned results — use them
        const text = appendAttribution(
          `## Hasil Pencarian: "${keyword}"\n\n` +
            "```json\n" +
            JSON.stringify(webapiResult, null, 2) +
            "\n```"
        );
        return { content: [{ type: "text", text }] };
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
