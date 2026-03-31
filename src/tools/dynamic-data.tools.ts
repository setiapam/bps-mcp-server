import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import { formatDynamicData, formatList } from "../services/data-formatter.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerDynamicDataTools(server: McpServer, client: BpsClient, config: Config): void {
  server.tool(
    "list_subjects",
    "Daftar subjek data statistik yang tersedia di BPS untuk domain tertentu. Subjek adalah kategori utama data (misal: Kependudukan, Kemiskinan, Perdagangan).",
    {
      domain: z.string().default("0000").describe("Kode domain BPS. '0000' untuk nasional. Gunakan resolve_domain untuk mendapatkan kode."),
      subcat: z.number().optional().describe("Filter berdasarkan kategori subjek (opsional)"),
    },
    async ({ domain, subcat }) => {
      try {
        const result = await client.listSubjects(domain, subcat);
        const text = formatList(
          result.data,
          (s) => `**${s.title}** (ID: ${s.sub_id}) — ${s.ntabel ?? 0} tabel, ${s.nvar ?? 0} variabel`,
          "Daftar Subjek Statistik"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_subject_categories",
    "Daftar kategori subjek statistik BPS. Kategori mengelompokkan subjek-subjek terkait.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
    },
    async ({ domain }) => {
      try {
        const result = await client.listSubjectCategories(domain);
        const text = formatList(
          result,
          (c) => `**${c.title}** (ID: ${c.subcat_id})`,
          "Daftar Kategori Subjek"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_variables",
    "Daftar variabel data di tabel dinamis BPS. Variabel menentukan data spesifik yang bisa diambil (misal: Jumlah Penduduk, Angka Kemiskinan).",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      subject: z.number().optional().describe("Filter berdasarkan ID subjek"),
      year: z.number().optional().describe("Filter berdasarkan tahun"),
      page: z.number().optional().describe("Nomor halaman (default: 1)"),
    },
    async ({ domain, subject, year, page }) => {
      try {
        const result = await client.listVariables(domain, subject, year, page);
        const text = formatList(
          result.data,
          (v) => {
            let desc = `**${v.title}** (ID: ${v.var_id})`;
            if (v.sub_name) desc += ` — Subjek: ${v.sub_name}`;
            if (v.unit) desc += ` — Satuan: ${v.unit}`;
            if (v.def) desc += `\n   ${v.def}`;
            return desc;
          },
          "Daftar Variabel"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_vertical_variables",
    "Daftar variabel vertikal (breakdown/disaggregasi) untuk variabel tertentu. Contoh: jenis kelamin, kelompok umur.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      var: z.number().optional().describe("ID variabel untuk melihat vertikal variabelnya"),
    },
    async ({ domain, var: varId }) => {
      try {
        const result = await client.listVerticalVariables(domain, varId);
        const text = formatList(
          result,
          (v) => `**${v.label_vervar}** (ID: ${v.kode_vervar}) — Grup: ${v.name_group_vervar}`,
          "Daftar Variabel Vertikal"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_derived_variables",
    "Daftar turunan variabel (derived/aggregated categories). Contoh: total, rata-rata.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      var: z.number().optional().describe("ID variabel"),
    },
    async ({ domain, var: varId }) => {
      try {
        const result = await client.listDerivedVariables(domain, varId);
        const text = formatList(
          result,
          (v) => `**${v.label_turvar}** (ID: ${v.kode_turvar}) — Grup: ${v.name_group_turvar}`,
          "Daftar Turunan Variabel"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_periods",
    "Daftar periode data yang tersedia untuk variabel tertentu. Periode bisa berupa tahun, semester, triwulan, atau bulan.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      var: z.number().optional().describe("ID variabel"),
    },
    async ({ domain, var: varId }) => {
      try {
        const result = await client.listPeriods(domain, varId);
        const text = formatList(
          result,
          (p) => `**${p.th_name}** (ID: ${p.th_id})`,
          "Daftar Periode Data"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_derived_periods",
    "Daftar turunan periode untuk variabel tertentu.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      var: z.number().optional().describe("ID variabel"),
    },
    async ({ domain, var: varId }) => {
      try {
        const result = await client.listDerivedPeriods(domain, varId);
        const text = formatList(
          result,
          (p) => `**${p.turth_name}** (ID: ${p.turth_id})`,
          "Daftar Turunan Periode"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_units",
    "Daftar satuan data yang digunakan di domain tertentu. Contoh: Jiwa, Persen, Rupiah.",
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
    },
    async ({ domain }) => {
      try {
        const result = await client.listUnits(domain);
        const text = formatList(
          result,
          (u) => `**${u.unit}** (ID: ${u.unit_id})`,
          "Daftar Satuan Data"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "get_dynamic_data",
    "Ambil data dari tabel dinamis BPS. Ini adalah tool utama untuk mendapatkan data statistik. Gunakan list_variables untuk menemukan ID variabel, dan list_periods untuk menemukan kode periode.",
    {
      domain: z.string().describe("Kode domain BPS. '0000' untuk nasional."),
      var: z.string().describe("ID variabel (bisa beberapa, pisahkan dengan koma). Contoh: '1452' atau '1452,1453'"),
      th: z.string().optional().describe("Kode periode/tahun (bisa beberapa). Contoh: '2023' atau '2020,2021,2022,2023'"),
      turvar: z.string().optional().describe("Kode turunan variabel"),
      vervar: z.string().optional().describe("Kode variabel vertikal"),
      turth: z.string().optional().describe("Kode turunan periode"),
    },
    async ({ domain, var: varId, th, turvar, vervar, turth }) => {
      try {
        const result = await client.getDynamicData(domain, varId, th, turvar, vervar, turth);
        const text = formatDynamicData(result, domain, config.defaultLang);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
