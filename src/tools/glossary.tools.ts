import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerGlossaryTools(server: McpServer, client: BpsClient): void {
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
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
