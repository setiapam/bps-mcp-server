import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import { formatDynamicData, formatList, buildStructuredPayload } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { DOMAIN_ALIASES } from "../config/domain-aliases.js";
import { formatErrorForUser } from "../utils/error.js";
import {
  describeMissingYears,
  parseYearSpec,
  resolvePeriodsForSpec,
} from "../services/period-resolver.js";
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


/** Province names, derived from the alias table (codes like 3500). */
const PROVINCE_LABELS: Set<string> = new Set(
  Object.entries(DOMAIN_ALIASES)
    .filter(([, code]) => code.length === 4 && code !== "0000" && code.endsWith("00"))
    .map(([name]) => name)
);

function normalizeRegionLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(provinsi|propinsi|prov)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** When a table lists many kab/kota, point at its official aggregate row. */
function aggregateRowNote(result: { vervar?: unknown[] }): string | null {
  const entries = (result.vervar ?? [])
    .map((vervar) => ({ id: getVervarId(vervar), label: getVervarLabel(vervar) }))
    .filter((entry) => entry.label !== "");
  if (entries.length <= 10) return null;
  const hit =
    entries.find((entry) => PROVINCE_LABELS.has(normalizeRegionLabel(entry.label))) ??
    entries.find((entry) => /^(provinsi|propinsi)\b/i.test(entry.label)) ??
    entries.find((entry) => /\bindonesia\b/i.test(entry.label)) ??
    entries.find((entry) => /^(total|jumlah)$/i.test(entry.label));
  if (!hit) return null;
  return `Tabel memuat ${entries.length} kategori; baris agregat "${hit.label}" adalah angka resmi wilayah — pakai baris itu, jangan menjumlahkan kabupaten/kota.`;
}

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
Parameter 'th' menerima TAHUN (bukan hanya ID periode): '2023', '2020,2021,2022',
rentang '2021-2025', atau ID periode mentah. Server menerjemahkan tahun ke ID
periode; TIDAK perlu memanggil list_periods lebih dulu. Jika 'th' dikosongkan,
server memakai periode terbaru. Tahun yang tidak tersedia dilaporkan di catatan.

Variabel umum (nasional, domain=0000):
- 2781: Jumlah Penduduk menurut Provinsi dan Jenis Kelamin
- 185: Jumlah Penduduk Miskin menurut Provinsi (Ribu Jiwa) — pakai ini untuk angka per provinsi
- 192: Persentase Penduduk Miskin (P0) menurut Provinsi
- 183: Jumlah Penduduk Miskin menurut Wilayah (hanya Kota/Desa, bukan provinsi)
- 543: Tingkat Pengangguran Terbuka Menurut Provinsi (%)
- 413: [Metode Baru] Indeks Pembangunan Manusia (IPM)
- 98: Gini Ratio Menurut Provinsi dan Daerah
- 2263: Inflasi Tahunan (Y-on-Y) 38 Provinsi

Gunakan find_variable untuk mencari ID variabel lainnya.`,
    {
      domain: z.string().default("0000").describe("Kode domain BPS. '0000' untuk nasional."),
      var: z.union([z.string(), z.number()]).optional().describe("ID variabel (string atau angka; bisa beberapa, pisahkan dengan koma). Contoh: '1452' atau 421."),
      var_id: z.union([z.string(), z.number()]).optional().describe("Alias untuk 'var'."),
      th: z.string().optional().describe("Tahun atau ID periode. Contoh: '2023', '2020,2021,2022', '2021-2025'. Jika kosong, server memakai periode terbaru."),
      turvar: z.string().optional().describe("Kode turunan variabel"),
      vervar: z.string().optional().describe("Kode variabel vertikal"),
      turth: z.string().optional().describe("Kode turunan periode"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("'markdown' untuk dibaca, 'json' untuk baris terstruktur {indicator, category, series, period, subperiod, value, unit}"),
    },
    async ({ domain, var: rawVar, var_id, th, turvar, vervar, turth, format }) => {
      try {
        const varArg = rawVar ?? var_id;
        if (varArg === undefined || varArg === null || String(varArg).trim() === "") {
          return {
            content: [{
              type: "text",
              text: "Parameter 'var' wajib diisi dengan ID variabel, misal get_dynamic_data(domain=\"3500\", var=\"421\", th=\"2021-2025\"). Cari ID dengan find_variable.",
            }],
            isError: true,
          };
        }
        const varId = String(varArg);
        const firstVar = varId.split(/[,;]/)[0]?.trim();
        const numericVar = Number(firstVar);
        const hasNumericVar = Number.isFinite(numericVar) && numericVar > 0;

        let period = th;
        let periodNote = "";
        let periodsUsed: Array<{ id: string; label: string }> = [];

        // Years → period IDs. BPS only accepts IDs, and answering an unknown
        // year with an empty dataset wastes the caller's next few calls.
        if (hasNumericVar) {
          const spec = parseYearSpec(th);
          if (spec.hasSpec || !period) {
            const resolved = await resolvePeriodsForSpec(client, domain, numericVar, th);
            if (resolved.entries.length === 0) {
              const yearText = spec.years.length > 0 ? spec.years.join(", ") : String(th);
              const available = resolved.availableLabels.length > 0
                ? `Periode tersedia: ${resolved.availableLabels.join(", ")}`
                : "Variabel ini tidak memiliki daftar periode yang bisa dibaca.";
              return {
                content: [{
                  type: "text",
                  text: appendAttribution(
                    `Tidak ada data untuk periode ${yearText} pada variabel ${numericVar} (domain ${domain}).\n\n${available}\n\n` +
                    `**Saran:** pakai tahun lain, atau panggil find_variable(keyword="...", domain="${domain}") untuk variabel dengan cakupan tahun yang diinginkan.`
                  ),
                }],
                isError: true,
              };
            }
            period = resolved.entries.map((entry) => entry.id).join(";");
            periodsUsed = resolved.entries.map((entry) => ({ id: entry.id, label: entry.label }));

            const notes: string[] = [];
            const missing = describeMissingYears(resolved.missingYears, resolved.availableYears);
            if (missing) notes.push(missing);
            if (!spec.hasSpec) {
              notes.push(`Periode terbaru dipilih otomatis: ${resolved.entries[0].label} (ID: ${resolved.entries[0].id}).`);
            }
            periodNote = notes.join(" ");
          }
        }

        let result;
        try {
          result = await client.getDynamicData(domain, varId, period, turvar, vervar, turth);
        } catch (error) {
          if (hasNumericVar) {
            const resolved = await resolvePeriodsForSpec(client, domain, numericVar, undefined).catch(() => null);
            const available = resolved?.availableLabels.length
              ? ` Periode tersedia: ${resolved.availableLabels.join(", ")}.`
              : "";
            throw new Error(
              `${error instanceof Error ? error.message : "Gagal mengambil data"}${available}`,
              { cause: error }
            );
          }
          throw error;
        }

        const rowCount = Object.keys(result.datacontent ?? {}).length;
        if (rowCount === 0) {
          // Never return a silent empty payload: say which periods do have data.
          let available = "";
          if (hasNumericVar) {
            const resolved = await resolvePeriodsForSpec(client, domain, numericVar, undefined).catch(() => null);
            if (resolved?.availableYears.length) {
              available = ` Tahun tersedia: ${resolved.availableYears.join(", ")}.`;
            }
          }
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Data kosong untuk var ${varId} (domain ${domain}) pada periode yang diminta.${available}\n\n` +
                `**Saran:** cek kombinasi turvar/vervar, atau pakai get_ranking/find_data.`
              ),
            }],
            isError: true,
          };
        }

        if (format === "json") {
          const payload = buildStructuredPayload(result, domain);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(
                {
                  ...payload,
                  period: period ?? null,
                  periodsUsed,
                  autoPeriodNote: periodNote || undefined,
                  aggregateNote: aggregateRowNote(result) || undefined,
                },
                null,
                2
              ),
            }],
          };
        }

        const text = formatDynamicData(result, domain, config.defaultLang, { includeAttribution: false });
        const aggregateNote = aggregateRowNote(result);
        const notes = [periodNote, aggregateNote].filter(Boolean).join(" ");
        const suffix = notes ? `\n\n_${notes}_` : "";
        return { content: [{ type: "text", text: appendAttribution(text + suffix) }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
