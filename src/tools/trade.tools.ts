import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerTradeTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "get_trade_data",
    "Ambil data perdagangan luar negeri (ekspor/impor) berdasarkan kode HS. Data mencakup nilai dan volume perdagangan Indonesia.",
    {
      source: z.enum(["1", "2"]).describe("Sumber data: '1' untuk ekspor, '2' untuk impor"),
      hs_code: z.string().describe("Kode HS (Harmonized System). Contoh: '0901' untuk kopi"),
      hs_type: z.string().describe("Tipe HS: '2' untuk 2-digit, '4' untuk 4-digit, '6' untuk 6-digit"),
      year: z.string().describe("Tahun data. Contoh: '2024'"),
      period: z.string().describe("Periode: '0' untuk tahunan, '1'-'12' untuk bulanan"),
    },
    async ({ source, hs_code, hs_type, year, period }) => {
      try {
        const result = await client.getTradeData(
          Number(source) as 1 | 2,
          hs_code,
          hs_type,
          year,
          period
        );
        const sourceLabel = source === "1" ? "Ekspor" : "Impor";
        const text = appendAttribution(
          `## Data ${sourceLabel} — HS ${hs_code}\n\n` +
          `**Tahun:** ${year} | **Periode:** ${period === "0" ? "Tahunan" : `Bulan ${period}`}\n\n` +
          "```json\n" + JSON.stringify(result, null, 2) + "\n```"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
