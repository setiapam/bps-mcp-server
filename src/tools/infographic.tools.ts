import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerInfographicTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_infographics",
    "Daftar infografis dari BPS. Infografis berisi visualisasi data statistik yang mudah dipahami.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, page }) => {
      try {
        const result = await client.listInfographics(domain, keyword, page);
        const pageInfo = result.page ? `\n\n*Halaman ${result.page.page} dari ${result.page.pages} (total: ${result.page.total})*` : "";
        const text = formatList(
          result.data,
          (inf) => `**${inf.title.replace(/\(\d\)\d{4}-\d{2}-\d{2}$/, "").trim()}** (ID: ${inf.inf_id}) — ${inf.date}`,
          "Daftar Infografis BPS"
        ) + pageInfo;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_infographic",
    "Ambil detail satu infografis BPS termasuk deskripsi lengkap dan link download.",
    {
      domain: z.string().describe("Kode domain BPS"),
      id: z.number().describe("ID infografis"),
    },
    async ({ domain, id }) => {
      try {
        const inf = await client.getInfographic(domain, id);
        const cleanTitle = inf.title.replace(/\(\d\)\d{4}-\d{2}-\d{2}$/, "").trim();

        // Strip HTML tags from description
        const cleanDesc = inf.desc
          .replace(/<\/?[^>]+(>|$)/g, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim();

        const lines = [
          `## ${cleanTitle}`,
          "",
          `**Tanggal:** ${inf.date}`,
          "",
          "### Deskripsi",
          cleanDesc,
          "",
          `**Gambar:** ${inf.img}`,
          `**Download:** ${inf.dl}`,
        ];

        if (inf.related && inf.related.length > 0) {
          lines.push("", "### Infografis Terkait");
          for (const r of inf.related) {
            lines.push(`- ${r.title.replace(/\(\d\)\d{4}-\d{2}-\d{2}$/, "").trim()} (ID: ${r.id})`);
          }
        }

        const text = appendAttribution(lines.join("\n"));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
