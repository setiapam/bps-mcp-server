import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient } from "../client/allstats-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { listGlossaryService } from "../services/glossary-service.js";

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
      const result = await listGlossaryService(client, allStatsClient, { domain, keyword, page });

      if (result.source === "glossary") {
        const text = formatList(
          result.items,
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
      }

      if (result.source === "variables") {
        const lines = [
          `## Definisi: "${result.keyword}"`,
          `_Glosarium WebAPI BPS sedang tidak tersedia; definisi di bawah diambil dari metadata variabel BPS._`,
          "",
        ];
        for (const variable of result.items) {
          lines.push(`### ${variable.title}`);
          lines.push(variable.definition);
          lines.push("");
          if (variable.var_id) {
            lines.push(`_Variabel: \`${variable.var_id}\` (domain ${domain})_`);
            lines.push("");
          }
        }
        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      }

      if (result.source === "documents") {
        const lines = [
          `## Glosarium: "${result.keyword}"`,
          `_Endpoint glosarium BPS sedang tidak tersedia. Berikut dokumen yang memuat istilah ini${result.effectiveKeyword !== result.keyword ? ` (kata kunci "${result.effectiveKeyword}")` : ""}:_`,
          "",
        ];
        for (const item of result.items) {
          lines.push(`- **${item.title}**${item.url ? ` — ${item.url}` : ""}`);
        }
        lines.push("");
        lines.push(
          `_Untuk definisi variabel, gunakan find_variable(keyword="${result.keyword}", domain="${domain}")._`
        );
        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
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
  );
}
