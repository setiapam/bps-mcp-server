import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerSearchTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "search",
    "Pencarian data lintas tipe di BPS. Bisa mencari tabel statis, publikasi, BRS, indikator, dan data lainnya.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().describe("Kata kunci pencarian"),
      type: z.string().optional().describe("Filter tipe hasil: 'statictable', 'pressrelease', 'publication', 'strategicindicator' (opsional)"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, type, page }) => {
      try {
        const result = await client.search(domain, keyword, type, page);
        const text = appendAttribution(
          `## Hasil Pencarian: "${keyword}"\n\n` +
          "```json\n" + JSON.stringify(result, null, 2) + "\n```"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
