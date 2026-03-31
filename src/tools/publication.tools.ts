import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerPublicationTools(server: McpServer, client: BpsClient): void {
  // Press Releases (BRS)
  server.tool(
    "list_press_releases",
    "Daftar Berita Resmi Statistik (BRS) dari BPS. BRS berisi rilis data resmi terbaru.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      year: z.number().optional().describe("Filter tahun"),
      month: z.number().optional().describe("Filter bulan (1-12)"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, year, month, page }) => {
      try {
        const result = await client.listPressReleases(domain, keyword, year, month, page);
        const text = formatList(
          result.data,
          (pr) => {
            let desc = `**${pr.title}** (ID: ${pr.brs_id}) — ${pr.rl_date}`;
            if (pr.abstract) desc += `\n   ${pr.abstract.substring(0, 200)}...`;
            return desc;
          },
          "Daftar Berita Resmi Statistik (BRS)"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_press_release",
    "Ambil detail satu Berita Resmi Statistik (BRS) dari BPS.",
    {
      domain: z.string().describe("Kode domain BPS"),
      id: z.number().describe("ID BRS"),
    },
    async ({ domain, id }) => {
      try {
        const pr = await client.getPressRelease(domain, id);
        const lines = [
          `## ${pr.title}`,
          "",
          `**Tanggal Rilis:** ${pr.rl_date}`,
        ];
        if (pr.abstract) {
          lines.push("", "### Abstrak", pr.abstract);
        }
        if (pr.pdf) {
          lines.push("", `**Download PDF:** ${pr.pdf}`);
        }
        const text = appendAttribution(lines.join("\n"));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  // Publications
  server.tool(
    "list_publications",
    "Daftar publikasi BPS. Publikasi berisi analisis mendalam dan laporan statistik.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      year: z.number().optional().describe("Filter tahun"),
      month: z.number().optional().describe("Filter bulan (1-12)"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, keyword, year, month, page }) => {
      try {
        const result = await client.listPublications(domain, keyword, year, month, page);
        const text = formatList(
          result.data,
          (pub) => {
            let desc = `**${pub.title}** (ID: ${pub.pub_id}) — ${pub.rl_date}`;
            if (pub.issn) desc += ` — ISSN: ${pub.issn}`;
            return desc;
          },
          "Daftar Publikasi"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_publication",
    "Ambil detail satu publikasi BPS.",
    {
      domain: z.string().describe("Kode domain BPS"),
      id: z.string().describe("ID publikasi"),
    },
    async ({ domain, id }) => {
      try {
        const pub = await client.getPublication(domain, id);
        const lines = [
          `## ${pub.title}`,
          "",
          `**Tanggal Rilis:** ${pub.rl_date}`,
        ];
        if (pub.issn) lines.push(`**ISSN:** ${pub.issn}`);
        if (pub.abstract) {
          lines.push("", "### Abstrak", pub.abstract);
        }
        if (pub.pdf) {
          lines.push("", `**Download PDF:** ${pub.pdf}`);
        }
        const text = appendAttribution(lines.join("\n"));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
