import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerStaticTableTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_static_tables",
    "Daftar tabel statis BPS. Tabel statis berisi data yang sudah di-format dalam bentuk tabel HTML.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      year: z.number().optional().describe("Filter tahun"),
      month: z.number().optional().describe("Filter bulan (1-12)"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, year, month, page }) => {
      try {
        const result = await client.listStaticTables(domain, keyword, year, month, page);
        const text = formatList(
          result.data,
          (t) => `**${t.title}** (ID: ${t.table_id}) — Update: ${t.updt_date}`,
          "Daftar Tabel Statis"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_static_table",
    "Ambil detail satu tabel statis BPS (termasuk konten tabel dalam format HTML).",
    {
      domain: z.string().describe("Kode domain BPS"),
      id: z.number().describe("ID tabel statis"),
    },
    async ({ domain, id }) => {
      try {
        const detail = await client.getStaticTable(domain, id);
        const lines = [
          `## ${detail.title}`,
          "",
          `**ID:** ${detail.table_id}`,
          `**Update:** ${detail.updt_date}`,
          "",
          detail.table, // HTML table content
        ];
        if (detail.excel) {
          lines.push("", `**Download Excel:** ${detail.excel}`);
        }
        const text = appendAttribution(lines.join("\n"));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
