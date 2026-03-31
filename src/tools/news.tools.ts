import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerNewsTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_news",
    "Daftar berita dari website BPS. Berbeda dengan BRS (Berita Resmi Statistik), ini adalah berita umum BPS.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, page }) => {
      try {
        const result = await client.listNews(domain, keyword, page);
        const text = formatList(
          result.data,
          (n) => `**${n.title}** (ID: ${n.news_id}) — ${n.newscat_name} — ${n.rl_date}`,
          "Daftar Berita BPS"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_news",
    "Ambil detail satu berita dari website BPS.",
    {
      domain: z.string().describe("Kode domain BPS"),
      id: z.number().describe("ID berita"),
    },
    async ({ domain, id }) => {
      try {
        const detail = await client.getNews(domain, id);
        const cleanNews = detail.news
          .replace(/<\/?[^>]+(>|$)/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim();

        const lines = [
          `## ${detail.title}`,
          "",
          `**Kategori:** ${detail.newscat_name}`,
          `**Tanggal:** ${detail.rl_date}`,
          "",
          cleanNews,
        ];

        if (detail.related && detail.related.length > 0) {
          lines.push("", "### Berita Terkait");
          for (const r of detail.related) {
            lines.push(`- ${r.title} (ID: ${r.id})`);
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
