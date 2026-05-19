import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerReferenceTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_strategic_indicators",
    `Daftar indikator strategis BPS — data headline terbaru (inflasi, pertumbuhan ekonomi, kemiskinan, pengangguran, IPM, ekspor/impor, dll).

Gunakan tool ini untuk mendapatkan ringkasan cepat indikator utama suatu wilayah. Data sudah termasuk nilai terbaru.
Untuk data historis multi-tahun, gunakan find_data atau get_dynamic_data.`,
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
