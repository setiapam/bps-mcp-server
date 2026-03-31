import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerCsaTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_csa_categories",
    "Daftar kategori CSA (Classification of Statistical Activities) BPS. CSA adalah klasifikasi aktivitas statistik internasional.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
    },
    async ({ domain }) => {
      try {
        const result = await client.listCsaSubjectCategories(domain);
        const text = formatList(
          result,
          (c) => `**${c.title}** (ID: ${c.subcat_id})`,
          "Daftar Kategori CSA"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_csa_subjects",
    "Daftar subjek CSA untuk domain dan kategori tertentu.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      subcat: z.number().optional().describe("Filter berdasarkan ID kategori CSA"),
    },
    async ({ domain, subcat }) => {
      try {
        const result = await client.listCsaSubjects(domain, subcat);
        const text = formatList(
          result.data,
          (s) => `**${s.title}** (ID: ${s.sub_id}) — Kategori: ${s.subcat} — ${s.ntabel} tabel`,
          "Daftar Subjek CSA"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_csa_tables",
    "Daftar tabel CSA untuk domain dan subjek tertentu.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      subject: z.number().optional().describe("Filter berdasarkan ID subjek CSA"),
      page: z.number().optional().describe("Nomor halaman"),
    },
    async ({ domain, subject, page }) => {
      try {
        const result = await client.listCsaTables(domain, subject, page);
        const text = formatList(
          result.data,
          (t) => {
            let desc = `**${t.title}** (ID: ${t.id})`;
            if (t.latest_period) desc += ` — Periode terbaru: ${t.latest_period}`;
            desc += ` — Update: ${t.last_update}`;
            return desc;
          },
          "Daftar Tabel CSA"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_csa_table",
    "Ambil detail satu tabel CSA (termasuk konten tabel dalam format HTML).",
    {
      domain: z.string().describe("Kode domain BPS"),
      id: z.string().describe("ID tabel CSA"),
    },
    async ({ domain, id }) => {
      try {
        const detail = await client.getCsaTable(domain, id);
        const lines = [
          `## ${detail.title}`,
          "",
          `**ID:** ${detail.table_id}`,
          `**Kategori CSA:** ${detail.subcsa}`,
          `**Update:** ${detail.updt_date}`,
          "",
          detail.table,
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
