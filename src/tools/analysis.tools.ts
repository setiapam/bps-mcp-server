import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { appendAttribution } from "../services/attribution.js";
import { formatKabkotaRanking } from "../services/kabkota-ranking.js";
import type { RegionSeries } from "../services/region-series.js";
import { formatUnit } from "../client/fields.js";
import {
  compareDataService,
  getRankingService,
  getTrendService,
} from "../services/analysis-service.js";

/**
 * Multi-region comparison, trend, and ranking tools.
 * Each handles a common multi-step query pattern in a single tool call.
 */
export function registerAnalysisTools(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver,
  _config: Config,
  store: IPersistentStore | null
): void {
  // ---------- compare_data ----------
  server.tool(
    "compare_data",
    `Bandingkan data statistik antar wilayah dalam 1 langkah — termasuk multi-tahun.

Untuk 1 tahun: isi \`year\` (atau kosongkan untuk data terbaru).
Untuk beberapa tahun sekaligus (mis. "5 tahun terakhir"): isi \`years\`
("2021-2025", "2021,2022,2023") atau \`start_year\`/\`end_year\`. Hasilnya berupa
tabel wilayah × tahun + selisih + tren, dalam SATU panggilan. Tidak perlu
memanggil get_trend per wilayah.

Contoh query user yang cocok untuk tool ini:
- "bandingkan kemiskinan Jawa Timur dan Jawa Barat"
- "perbandingan jumlah penduduk miskin Jatim vs Jabar 5 tahun terakhir"
- "IPM DKI Jakarta vs Banten vs Jawa Barat 2020-2024"
- "mana yang lebih tinggi kemiskinan Jatim atau Jabar?"`,
    {
      query: z.string().describe("Indikator yang dibandingkan (misal: kemiskinan, pengangguran, IPM, penduduk)"),
      regions: z.string().optional().describe("Nama wilayah dipisah koma (misal: 'Jawa Timur, Jawa Barat, Jawa Tengah')"),
      wilayah: z.string().optional().describe("Alias untuk 'regions'."),
      provinces: z.string().optional().describe("Alias untuk 'regions'."),
      year: z.string().optional().describe("Satu tahun (misal: '2023'). Kosongkan untuk data terbaru."),
      years: z.string().optional().describe("Beberapa tahun: '2021-2025' atau '2021,2022,2023'. Mengalahkan parameter year."),
      start_year: z.string().optional().describe("Tahun awal untuk perbandingan multi-tahun"),
      end_year: z.string().optional().describe("Tahun akhir untuk perbandingan multi-tahun"),
    },
    async ({ query, regions, wilayah, provinces, year, years, start_year, end_year }) => {
      try {
        const result = await compareDataService(client, resolver, store, {
          query,
          regions,
          wilayah,
          provinces,
          year,
          years,
          start_year,
          end_year,
        });

        const seriesList = result.series;
        const withData = seriesList.filter((series) => series.points.length > 0);

        if (!result.hasData || withData.length === 0) {
          const detail = seriesList.map(
            (series) => `- ${series.region}: ${series.notes.join(" ") || "tidak ada data"}`
          );
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ada data "${query}"${result.spec ? ` untuk ${result.spec}` : ""} di ${result.regionsRequested.join(", ")}.\n\n${detail.join("\n")}\n\n` +
                `**Saran:** pakai find_variable(keyword="${query}", domain="<kode provinsi>") untuk melihat variabel yang tersedia, atau get_ranking untuk membandingkan seluruh provinsi.`
              ),
            }],
          };
        }

        const unitLabel = result.unit ?? "";
        const formatValue = (series: RegionSeries, value: number) => {
          const unit = formatUnit(series.unit);
          return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
        };

        const unitInTitle = unitLabel
          ? new RegExp(`\\(${unitLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "i").test(result.displayTitle)
          : true;
        const lines: string[] = [
          `## Perbandingan: ${result.displayTitle}${unitLabel && !unitInTitle ? ` (${unitLabel})` : ""}`,
          `**Wilayah:** ${withData.map((series) => series.domainName).join(", ")}`,
        ];

        if (!result.multiYear) {
          const first = withData[0];
          const periodLabel = first.points[0]?.label ?? "";
          lines.push(
            `**Periode:** ${periodLabel || "Terbaru"}${result.seriesLabel ? ` | **Seri:** ${result.seriesLabel}` : ""}`,
            ""
          );
          lines.push("| Wilayah | Nilai | Periode |", "| --- | --- | --- |");
          for (const series of seriesList) {
            const point = series.points[0];
            lines.push(
              point
                ? `| ${series.region} | ${formatValue(series, point.value)} | ${point.label} |`
                : `| ${series.region} | N/A | - |`
            );
          }

          const numeric = seriesList
            .filter((series) => series.points.length > 0)
            .map((series) => ({
              region: series.region,
              value: series.points[0].value,
              text: formatValue(series, series.points[0].value),
            }));
          if (numeric.length >= 2) {
            const sorted = [...numeric].sort((a, b) => b.value - a.value);
            lines.push("");
            lines.push(`**Tertinggi:** ${sorted[0].region} (${sorted[0].text})`);
            lines.push(`**Terendah:** ${sorted[sorted.length - 1].region} (${sorted[sorted.length - 1].text})`);
          }
          if (result.units.length > 1) {
            lines.push(
              "",
              `_Catatan: satuan berbeda antar wilayah (${result.units.join(", ")}); bandingkan dengan hati-hati._`
            );
          }
        } else {
          const yearKeys = result.summary?.yearKeys ?? [];
          const yearRange = result.summary?.yearRange ?? "";
          lines.push(
            `**Periode:** ${yearRange}${result.seriesLabel ? ` | **Seri:** ${result.seriesLabel}` : ""}`,
            ""
          );

          const header = ["Tahun", ...withData.map((series) => series.region)];
          if (withData.length === 2) header.push("Selisih");
          lines.push(`| ${header.join(" | ")} |`);
          lines.push(`| ${header.map(() => "---").join(" | ")} |`);

          for (const key of yearKeys) {
            const cells = withData.map((series) => {
              const point = series.points.find((candidate) => candidate.year === key);
              return point ? formatValue(series, point.value) : "-";
            });
            const row = [key, ...cells];
            if (withData.length === 2) {
              const left = withData[0].points.find((point) => point.year === key)?.value;
              const right = withData[1].points.find((point) => point.year === key)?.value;
              const diff =
                left !== undefined && right !== undefined
                  ? (left - right).toLocaleString("id-ID", { maximumFractionDigits: 2 })
                  : "-";
              row.push(diff);
            }
            lines.push(`| ${row.join(" | ")} |`);
          }

          lines.push("");
          for (const series of withData) {
            const points = series.points;
            if (points.length < 2) {
              lines.push(`**${series.region}:** hanya 1 tahun data (${points[0]?.year}).`);
              continue;
            }
            const first = points[0];
            const last = points[points.length - 1];
            const diff = last.value - first.value;
            const pct = first.value !== 0 ? ((diff / first.value) * 100).toFixed(1) : null;
            const direction = diff > 0 ? "naik" : diff < 0 ? "turun" : "stabil";
            lines.push(
              `**${series.region}:** ${direction} ${pct !== null ? `${pct}% ` : ""}dari ` +
              `${first.value.toLocaleString("id-ID")} (${first.year}) ke ${last.value.toLocaleString("id-ID")} (${last.year})`
            );
          }
        }

        if (result.notes.length > 0) {
          lines.push("", "_Catatan:_");
          for (const note of result.notes) lines.push(`- ${note}`);
        }

        if (result.sources.length > 0) {
          const sourceText = result.sources
            .map((s) => `${s.who}: ${s.varTitle} (var ${s.varId}, domain ${s.domain})`)
            .join("; ");
          lines.push("", `_Sumber variabel — ${sourceText}._`);
          lines.push(
            "_Angka di atas diambil dari baris agregat resmi tiap tabel; jangan menjumlahkan baris kabupaten/kota._"
          );
        }

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Gagal membandingkan data" }],
          isError: true,
        };
      }
    }
  );

  // ---------- get_trend ----------
  server.tool(
    "get_trend",
    `Ambil data time-series (tren multi-tahun) dalam 1 langkah.
Gunakan tool ini ketika user ingin melihat perkembangan/tren data dari SATU wilayah.
Untuk membandingkan beberapa wilayah sekaligus (termasuk multi-tahun), pakai
compare_data dengan \`years\`/\`start_year\`/\`end_year\` — satu panggilan untuk semuanya.

Contoh query user yang cocok untuk tool ini:
- "tren kemiskinan Indonesia 2019-2023"
- "perkembangan IPM Jawa Timur 5 tahun terakhir"
- "bagaimana pengangguran dari 2020 sampai 2024?"
- "data kemiskinan Jawa Barat dari tahun ke tahun"`,
    {
      query: z.string().describe("Indikator yang dianalisis (misal: kemiskinan, pengangguran, IPM)"),
      region: z.string().default("Indonesia").describe("Nama wilayah"),
      wilayah: z.string().optional().describe("Alias untuk 'region'."),
      start_year: z.string().default("2019").describe("Tahun awal"),
      end_year: z.string().default("2024").describe("Tahun akhir"),
      years: z.string().optional().describe("Alternatif rentang: '2021-2025' atau '2021,2022,2023' (mengalahkan start/end)."),
    },
    async ({ query, region, wilayah, start_year, end_year, years }) => {
      try {
        const result = await getTrendService(client, resolver, store, {
          query,
          region,
          wilayah,
          start_year,
          end_year,
          years,
        });

        if (result.points.length === 0) {
          if (result.headlineFallback) {
            const ind = result.headlineFallback;
            const val = typeof ind.value === "number" ? ind.value.toLocaleString("id-ID") : ind.value;
            const headline = [
              `## Tren/Headline ${ind.title}`,
              `**Wilayah:** ${result.domainName} (${result.domain})`,
              "",
              "*Catatan: menggunakan data headline indikator strategis karena variabel time-series tidak ditemukan.*",
              "",
              "| Periode | Nilai |",
              "| --- | --- |",
              `| ${ind.periode} | ${val}${ind.unit ? ` ${ind.unit}` : ""} |`,
            ];
            if (ind.name) headline.push("", `_${ind.name}_`);
            return { content: [{ type: "text", text: appendAttribution(headline.join("\n")) }] };
          }

          const notes = result.notes.length > 0 ? `\n\n${result.notes.join("\n")}` : "";
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ada data "${query}" untuk ${result.domainName} pada ${result.spec}.${notes}\n\n` +
                `**Saran:** find_variable(keyword="${query}", domain="${result.domain}") untuk melihat variabel dan cakupan tahunnya.`
              ),
            }],
          };
        }

        const unit = result.unit ?? "";
        const lines = [
          `## Tren ${result.varTitle}${unit ? ` (${unit})` : ""}`,
          `**Wilayah:** ${result.domainName} | **Periode:** ${result.yearList[0]}–${result.yearList[result.yearList.length - 1]}`,
        ];
        if (result.seriesLabel) {
          lines.push(`**Seri:** ${result.seriesLabel}`);
          if (/januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|semester/i.test(result.seriesLabel)) {
            lines.push(
              `_Catatan: variabel ini punya beberapa sub-periode; nilai yang ditampilkan adalah seri ${result.seriesLabel} pada setiap tahun._`
            );
          }
        }
        if (result.missingYears.length > 0 && result.points.length > 0) {
          lines.push(`**Catatan:** tahun ${result.missingYears.join(", ")} tidak tersedia untuk variabel ini.`);
        }
        lines.push("", "| Periode | Nilai | Perubahan |", "| --- | --- | --- |");

        for (let i = 0; i < result.points.length; i++) {
          const point = result.points[i];
          let change = "-";
          if (i > 0) {
            const previous = result.points[i - 1].value;
            const diff = point.value - previous;
            if (previous !== 0) {
              const pct = ((diff / previous) * 100).toFixed(1);
              change = `${diff > 0 ? "+" : ""}${pct}%`;
            }
          }
          lines.push(`| ${point.year} | ${point.value.toLocaleString("id-ID")} | ${change} |`);
        }

        if (result.points.length >= 2) {
          const first = result.points[0];
          const last = result.points[result.points.length - 1];
          if (first.value !== 0) {
            const totalChange = (((last.value - first.value) / first.value) * 100).toFixed(1);
            const trend = last.value > first.value ? "naik" : last.value < first.value ? "turun" : "stabil";
            lines.push("");
            lines.push(`**Tren:** ${trend} ${totalChange}% dari ${first.year} ke ${last.year}`);
          }
        }

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Gagal mengambil data tren" }],
          isError: true,
        };
      }
    }
  );

  // ---------- get_ranking ----------
  server.tool(
    "get_ranking",
    `Ambil peringkat/ranking wilayah berdasarkan indikator tertentu dalam 1 langkah.

Mendukung dua level wilayah:
- **level="kabkota"** — semua kabupaten/kota se-Indonesia (BPS tidak punya tabel
  nasional untuk ini; server menyapu tabel tiap provinsi sekaligus).
- **level="provinsi"** — 34–38 provinsi dari tabel nasional.

level="auto" (default) memilih kabkota bila query menyebut kabupaten/kota/daerah,
selain itu provinsi. Untuk ranking kabupaten/kota, sebutkan level secara eksplisit
agar tidak ambigu.

Contoh query user yang cocok:
- "10 kabupaten/kota dengan tingkat pengangguran tertinggi" → level="kabkota"
- "10 provinsi termiskin di Indonesia"
- "peringkat IPM seluruh provinsi"
- "provinsi dengan pengangguran tertinggi"
- "5 kota dengan pengangguran tertinggi di Jawa Timur" → level="kabkota", provinces="Jawa Timur"`,
    {
      query: z.string().describe("Indikator untuk ranking (misal: kemiskinan, pengangguran/TPT, IPM, penduduk)"),
      top_n: z.number().int().min(1).max(200).default(10).describe("Jumlah data yang ditampilkan (default 10, max 200 untuk kabupaten/kota, 40 untuk provinsi)"),
      order: z.enum(["highest", "lowest"]).default("highest").describe("Urutan: 'highest' (tertinggi dulu) atau 'lowest' (terendah dulu)"),
      year: z.string().optional().describe("Tahun data. Kosongkan untuk tahun bersama terbaru (default) agar semua wilayah sebanding."),
      period_mode: z.enum(["common", "latest"]).default("common").describe("'common' (default): seragamkan ke tahun bersama terbaru; 'latest': pakai periode terbaru tiap provinsi (tahun bisa campur)"),
      level: z.enum(["provinsi", "kabkota"]).describe("WAJIB dipilih. 'kabkota' bila jawaban perlu kabupaten/kota (satu panggilan, ~380 wilayah, tahun diseragamkan); 'provinsi' untuk peringkat 34-38 provinsi"),
      provinces: z.string().optional().describe("Batasi ke provinsi tertentu (nama dipisah koma, misal 'Jawa Timur, Jawa Tengah'). Hanya untuk level=kabkota."),
      format: z.enum(["markdown", "json"]).default("markdown").describe("Format keluaran: 'markdown' untuk dibaca, 'json' untuk diproses lebih lanjut"),
    },
    async ({ query, top_n, order, year, level, provinces, format, period_mode }) => {
      try {
        const result = await getRankingService(client, resolver, store, {
          query,
          level,
          top_n,
          order,
          year,
          period_mode,
          provinces,
        });

        if (result.level === "kabkota") {
          if (result.rows.length === 0) {
            return {
              content: [{
                type: "text",
                text: appendAttribution(
                  `Tidak ada data kabupaten/kota untuk "${query}".\n\n` +
                  `**Saran:**\n` +
                  `1. Panggil get_ranking(level="provinsi") untuk angka provinsi\n` +
                  `2. Gunakan find_variable(keyword="${query}", domain="<kode provinsi>") lalu get_dynamic_data\n` +
                  `3. Gunakan allstats_search(query="${query} kabupaten", content="table")`
                ),
              }],
            };
          }

          if (format === "json") {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  level: "kabkota",
                  indicator: result.indicator,
                  order: result.order,
                  rows: result.rows,
                  totalRegions: result.totalRegions,
                  provincesCovered: result.provincesCovered,
                  periods: result.periods,
                  targetYear: result.targetYear,
                  missingProvinces: result.missingProvinces,
                }, null, 2),
              }],
            };
          }

          return {
            content: [{
              type: "text",
              text: appendAttribution(formatKabkotaRanking(result.rawKabkotaResult, { order, query })),
            }],
          };
        }

        // level === "provinsi"
        if (result.errorReason === "no_variable") {
          return {
            content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ranking nasional.`) }],
          };
        }
        if (result.errorReason === "no_data") {
          return {
            content: [{ type: "text", text: appendAttribution(`Data ranking tidak tersedia.`) }],
          };
        }
        if (result.errorReason === "too_many_categories") {
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Variabel "${result.indicator}" memiliki ${result.categoryCount} kategori (bukan level provinsi). ` +
                `Gunakan find_data untuk wilayah tertentu atau find_variable untuk memilih variabel provinsi.`
              ),
            }],
          };
        }
        if (result.errorReason === "unparseable" || result.rows.length === 0) {
          return {
            content: [{
              type: "text",
              text: appendAttribution(`Data ranking tidak dapat di-parse. Coba gunakan find_data untuk masing-masing wilayah.`),
            }],
          };
        }

        if (format === "json") {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                level: "provinsi",
                indicator: result.indicator,
                unit: result.unit,
                order: result.order,
                targetYear: result.targetYear,
                periods: result.periods,
                totalRegions: result.totalRegions,
                rows: result.rows,
              }, null, 2),
            }],
          };
        }

        const unit = result.unit ?? "";
        const lines = [
          `## Ranking: ${result.indicator}${unit ? ` (${unit})` : ""}`,
          `**Urutan:** ${order === "highest" ? "Tertinggi" : "Terendah"} | **Periode:** ${result.periodLabel || year || "Terbaru"}`,
          "",
          "| # | Wilayah | Nilai |",
          "| --- | --- | --- |",
        ];

        for (const row of result.rows) {
          lines.push(`| ${row.rank} | ${row.province} | ${row.value.toLocaleString("id-ID")} |`);
        }

        if (result.totalRegions > result.rows.length) {
          lines.push("");
          lines.push(`_Menampilkan ${result.rows.length} dari ${result.totalRegions} wilayah._`);
        }

        if (result.hasKabkotaAlternative) {
          lines.push("");
          lines.push(
            `_Butuh level kabupaten/kota? Panggil \`get_ranking(query="${query}", level="kabkota")\` — ` +
              `satu panggilan, semua kab/kota se-Indonesia, tahun diseragamkan._`
          );
        }

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Gagal mengambil data ranking" }],
          isError: true,
        };
      }
    }
  );
}
