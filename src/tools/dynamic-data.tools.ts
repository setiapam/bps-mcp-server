import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import { formatDynamicData, formatList, buildStructuredPayload } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";
import {
  formatUnit,
  getPeriodId,
  getPeriodLabel,
  getTurthId,
  getTurthLabel,
  getTurvarGroup,
  getTurvarId,
  getTurvarLabel,
  getVariableTitle,
  getVariableUnit,
  getVervarGroup,
  getVervarId,
  getVervarLabel,
} from "../client/fields.js";

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
        const subjects = await client.listAllSubjects(domain, subcat);
        const text = formatList(
          subjects,
          (s) => {
            const counts: string[] = [];
            if (s.ntabel && s.ntabel > 0) counts.push(`${s.ntabel} tabel`);
            if (s.nvar && s.nvar > 0) counts.push(`${s.nvar} variabel`);
            return `**${s.title}** (ID: ${s.sub_id})${counts.length > 0 ? ` — ${counts.join(", ")}` : ""}`;
          },
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
            const title = getVariableTitle(v) || v.title;
            const unit = formatUnit(getVariableUnit(v));
            let desc = `**${title}** (ID: ${v.var_id})`;
            if (v.sub_name) desc += ` — Subjek: ${v.sub_name}`;
            if (unit) desc += ` — Satuan: ${unit}`;
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
    `Daftar variabel vertikal (breakdown/disaggregasi) untuk variabel tertentu. Contoh: jenis kelamin, kelompok umur, kabupaten/kota.

Semua baris diambil (BPS membatasi 10 per halaman, server menggabungkan seluruh halaman) agar daftar kabupaten/kota tidak terpotong.`,
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      var: z.number().optional().describe("ID variabel untuk melihat vertikal variabelnya"),
    },
    async ({ domain, var: varId }) => {
      try {
        const result = await client.listAllVerticalVariables(domain, varId);
        const text = formatList(
          result,
          (v) => {
            const label = getVervarLabel(v) || "(tanpa label)";
            const group = getVervarGroup(v);
            return `**${label}** (ID: ${getVervarId(v) || "-"})${group ? ` — Grup: ${group}` : ""}`;
          },
          `Daftar Variabel Vertikal (${result.length} kategori)`
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
        const result = await client.listAllDerivedVariables(domain, varId);
        const text = formatList(
          result,
          (v) => {
            const label = getTurvarLabel(v) || "(tanpa label)";
            const group = getTurvarGroup(v);
            return `**${label}** (ID: ${getTurvarId(v) || "-"})${group ? ` — Grup: ${group}` : ""}`;
          },
          `Daftar Turunan Variabel (${result.length} kategori)`
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
        const result = await client.listAllPeriods(domain, varId);
        const text = formatList(
          result,
          (p) => `**${getPeriodLabel(p) || "(tanpa label)"}** (ID: ${getPeriodId(p) || "-"})`,
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
          (p) => `**${getTurthLabel(p) || "(tanpa label)"}** (ID: ${getTurthId(p) || "-"})`,
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
      page: z.number().int().min(1).optional().describe("Nomor halaman (10 satuan per halaman)"),
    },
    async ({ domain, page }) => {
      try {
        const result = await client.listUnits(domain, page);
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
    `Ambil data dari tabel dinamis BPS. Tool ini membutuhkan ID variabel yang spesifik.

PENTING: Gunakan find_data terlebih dahulu untuk pencarian otomatis. Gunakan tool ini hanya jika sudah tahu var_id.
Jika parameter th dikosongkan, server otomatis memilih periode terbaru yang tersedia. Untuk beberapa tahun, pisahkan dengan koma (contoh: '2020,2021,2022,2023'); server akan memecahnya karena BPS membatasi maksimal 3 periode per request.

Variabel umum (nasional, domain=0000):
- 2781: Jumlah Penduduk menurut Provinsi dan Jenis Kelamin
- 184: Persentase Penduduk Miskin (P0)
- 183: Jumlah Penduduk Miskin Menurut Wilayah
- 543: Tingkat Pengangguran Terbuka Menurut Provinsi (%)
- 413: [Metode Baru] Indeks Pembangunan Manusia (IPM)
- 98: Gini Ratio Menurut Provinsi dan Daerah
- 2263: Inflasi Tahunan (Y-on-Y) 38 Provinsi

Gunakan find_variable untuk mencari ID variabel lainnya.`,
    {
      domain: z.string().describe("Kode domain BPS. '0000' untuk nasional."),
      var: z.string().describe("ID variabel (bisa beberapa, pisahkan dengan koma). Contoh: '1452' atau '1452,1453'"),
      th: z.string().optional().describe("Kode periode/tahun (bisa beberapa, pisahkan koma, contoh: '2023' atau '2020,2021,2022'). Jika kosong, server memakai periode terbaru."),
      turvar: z.string().optional().describe("Kode turunan variabel"),
      vervar: z.string().optional().describe("Kode variabel vertikal"),
      turth: z.string().optional().describe("Kode turunan periode"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("'markdown' untuk dibaca, 'json' untuk baris terstruktur {indicator, category, series, period, subperiod, value, unit}"),
    },
    async ({ domain, var: varId, th, turvar, vervar, turth, format }) => {
      try {
        let period = th;
        let autoPeriodNote = "";

        // BPS requires `th` for many variables. If the caller omitted it, resolve
        // the latest available period instead of letting the API return 400.
        if (!period) {
          const firstVar = varId.split(/[,;]/)[0]?.trim();
          const numericVar = Number(firstVar);
          if (Number.isFinite(numericVar) && numericVar > 0) {
            try {
              const periods = await client.listPeriods(domain, numericVar, 1);
              const latest = periods[0];
              const latestId = latest ? getPeriodId(latest) : "";
              if (latestId) {
                period = latestId;
                autoPeriodNote = `\n\n_Periode terbaru dipilih otomatis: ${getPeriodLabel(latest)} (ID: ${latestId})._`;
              }
            } catch {
              // Fall through and let the API report the missing period.
            }
          }
        }

        const result = await client.getDynamicData(domain, varId, period, turvar, vervar, turth);

        if (format === "json") {
          const payload = buildStructuredPayload(result, domain);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(
                { ...payload, period: period ?? null, autoPeriodNote: autoPeriodNote.trim() || undefined },
                null,
                2
              ),
            }],
          };
        }

        const text = formatDynamicData(result, domain, config.defaultLang, { includeAttribution: false });
        return { content: [{ type: "text", text: appendAttribution(text + autoPeriodNote) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
