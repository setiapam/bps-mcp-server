import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerReferenceTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_strategic_indicators",
    "Daftar indikator strategis BPS. Indikator ini mencakup data-data utama seperti pertumbuhan ekonomi, inflasi, pengangguran, dan kemiskinan.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      var: z.number().optional().describe("Filter berdasarkan ID variabel"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, var: varId, page }) => {
      try {
        const result = await client.listStrategicIndicators(domain, varId, page);
        const text = formatList(
          result.data,
          (ind) => `**${ind.title}** (ID: ${ind.indicator_id}) — Subjek: ${ind.sub_name}`,
          "Daftar Indikator Strategis"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
