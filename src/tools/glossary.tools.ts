import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient } from "../client/allstats-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { logger } from "../utils/logger.js";
import { searchVariables } from "../services/variable-search.js";
import { searchQueryFallbacks } from "../services/search-query.js";

export function registerGlossaryTools(
  server: McpServer,
  client: BpsClient,
  allStatsClient?: AllStatsClient
): void {
  server.tool(
    "list_glossary",
    `Cari istilah di glosarium statistik BPS (definisi indikator seperti kemiskinan, TPK, IPM).

Bila endpoint glosarium WebAPI sedang tidak tersedia (BPS cukup sering mengembalikan
HTTP 500), tool ini otomatis mengambil definisi dari metadata variabel BPS, sehingga
tetap memberi jawaban dalam satu panggilan.`,
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
        logger.debug(
          `Glossary WebAPI failed: ${error instanceof Error ? error.message : "unknown"}`
        );

        // The WebAPI glossary endpoint currently returns HTTP 500 for every
        // request. Variable metadata carries the same definitions, so answer
        // from there instead of returning an error the caller cannot act on.
        if (keyword && keyword.trim()) {
          try {
            const variables = await searchVariables(client, domain, keyword, {
              maxSubjects: 4,
              maxPagesPerSubject: 2,
              maxCandidates: 8,
            });
            const defined = variables
              .filter((variable) => (variable.def ?? "").trim().length > 20)
              .slice(0, 5);

            if (defined.length > 0) {
              const lines = [
                `## Definisi: "${keyword}"`,
                `_Glosarium WebAPI BPS sedang tidak tersedia; definisi di bawah diambil dari metadata variabel BPS._`,
                "",
              ];
              for (const variable of defined) {
                lines.push(`### ${variable.title}`);
                lines.push(variable.def!.trim().slice(0, 600));
                lines.push("");
                if (variable.var_id) {
                  lines.push(`_Variabel: \`${variable.var_id}\` (domain ${domain})_`);
                  lines.push("");
                }
              }
              return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
            }
          } catch (fallbackError) {
            logger.debug(
              `Glossary variable-definition fallback failed: ${
                fallbackError instanceof Error ? fallbackError.message : "unknown"
              }`
            );
          }

          // Last resort: related documents (works even while the glossary
          // filters are down). One request, no retries, plus the root-word
          // fallback the search engine needs for derived words.
          if (allStatsClient) {
            try {
              let related = await allStatsClient.search({
                query: keyword,
                content: "all",
                domain,
                page: page || 1,
                sort: "relevansi",
              });
              let effectiveKeyword = keyword;
              if (related.results.length === 0) {
                for (const fallback of searchQueryFallbacks(keyword)) {
                  related = await allStatsClient.search({
                    query: fallback,
                    content: "all",
                    domain,
                    page: page || 1,
                    sort: "relevansi",
                  });
                  if (related.results.length > 0) {
                    effectiveKeyword = fallback;
                    break;
                  }
                }
              }
              if (related.results.length > 0) {
                const lines = [
                  `## Glosarium: "${keyword}"`,
                  `_Endpoint glosarium BPS sedang tidak tersedia. Berikut dokumen yang memuat istilah ini${effectiveKeyword !== keyword ? ` (kata kunci "${effectiveKeyword}")` : ""}:_`,
                  "",
                ];
                for (const item of related.results.slice(0, 5)) {
                  lines.push(`- **${item.title}**${item.url ? ` — ${item.url}` : ""}`);
                }
                lines.push("");
                lines.push(
                  `_Untuk definisi variabel, gunakan find_variable(keyword="${keyword}", domain="${domain}")._`
                );
                return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
              }
            } catch (relatedError) {
              logger.debug(
                `Glossary AllStats fallback failed: ${
                  relatedError instanceof Error ? relatedError.message : "unknown"
                }`
              );
            }
          }
        }

        return {
          content: [{
            type: "text",
            text: appendAttribution(
              `Glosarium BPS sedang tidak tersedia (endpoint WebAPI mengembalikan error).\n\n` +
              `**Alternatif:**\n` +
              `- \`find_variable(keyword="${keyword ?? "<istilah>"}")\` — daftar variabel + definisinya\n` +
              `- \`allstats_search(query="${keyword ?? "<istilah>"}")\` — cari istilah di publikasi/BRS`
            ),
          }],
          isError: true,
        };
      }
    }
  );
}
