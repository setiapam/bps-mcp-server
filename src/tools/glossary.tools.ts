import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient } from "../client/allstats-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";
import { logger } from "../utils/logger.js";

export function registerGlossaryTools(
  server: McpServer,
  client: BpsClient,
  allStatsClient?: AllStatsClient
): void {
  server.tool(
    "list_glossary",
    "Cari istilah di glosarium statistik BPS. Berguna untuk memahami definisi dan pengertian indikator statistik.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian istilah"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, page }) => {
      try {
        const result = await client.listGlossary(domain, keyword, page);
        const text = formatList(
          result.data,
          (g) => {
            const src = g._source;
            let desc = `**${src.judulIndikator}**`;
            const definisi = src.definisi?.trim();
            if (definisi && definisi !== "." && definisi !== ". Produsen data oleh") {
              desc += `\n   ${definisi.substring(0, 300)}`;
            }
            if (src.satuan && src.satuan !== "-") desc += ` (satuan: ${src.satuan})`;
            if (src.sumberData) desc += `\n   _Sumber: ${src.sumberData}_`;
            return desc;
          },
          "Glosarium Statistik BPS"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        // The WebAPI glossary endpoint currently sometimes returns HTTP 500.
        // Fall back to AllStats' glossary index when available.
        if (allStatsClient) {
          try {
            const fallback = await allStatsClient.search({
              query: keyword || "statistik",
              content: "glosarium",
              domain,
              page: page || 1,
            });
            if (fallback.results.length > 0) {
              const lines = [`## Glosarium (AllStats fallback): "${keyword || "statistik"}"`, ""];
              for (const item of fallback.results.slice(0, 10)) {
                lines.push(`### ${item.title}`);
                if (item.description) lines.push(`> ${item.description}`);
                if (item.url) lines.push(`- ${item.url}`);
                lines.push("");
              }
              return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
            }
          } catch (fallbackError) {
            logger.debug(
              `Glossary AllStats fallback failed: ${fallbackError instanceof Error ? fallbackError.message : "unknown"}`
            );
          }
        }
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
