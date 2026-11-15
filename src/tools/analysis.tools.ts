import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { appendAttribution } from "../services/attribution.js";
import { lookupVar, normalizeKeyword } from "../services/learning.js";
import { resolveVariable as resolveVariableShared, searchVariables } from "../services/variable-search.js";
import { formatKabkotaRanking, rankKabkota } from "../services/kabkota-ranking.js";
import { findKabkotaIndicator } from "../config/kabkota-indicators.js";
import { buildNationalBreakdown, buildRegionSeries, type RegionSeries } from "../services/region-series.js";
import { parseYearSpec } from "../services/period-resolver.js";
import { extractVervarId, getVervarEntries } from "../services/dynamic-data-utils.js";
import {
  formatUnit,
  getPeriodId,
  getPeriodLabel,
  getVariableTitle,
  getVariableUnit,
} from "../client/fields.js";

/**
 * Multi-region comparison, trend, and ranking tools.
 * Each handles a common multi-step query pattern in a single tool call.
 */
export function registerAnalysisTools(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver,
  config: Config,
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
    async ({ query, regions: regionsInput, wilayah, provinces, year, years, start_year, end_year }) => {
      try {
        const regions = regionsInput ?? wilayah ?? provinces ?? "";
        if (!regions.trim()) {
          return { content: [{ type: "text", text: "Parameter 'regions' wajib diisi, misal regions=\"Jawa Timur, Jawa Barat\"." }], isError: true };
        }
        const regionList = regions.split(",").map(r => r.trim()).filter(Boolean);
        if (regionList.length < 2) {
          return { content: [{ type: "text", text: "Minimal 2 wilayah untuk perbandingan." }], isError: true };
        }

        const spec = years ?? (start_year ? `${start_year}-${end_year ?? start_year}` : year);
        const parsed = parseYearSpec(spec);
        const multiYear = parsed.years.length > 1 || parsed.periodIds.length > 1;

        const resolvedRegions = await Promise.all(
          regionList.map(async (regionName) => ({
            regionName,
            resolved: await resolver.resolve(regionName),
          }))
        );

        const seriesList: RegionSeries[] = [];
        let usedNationalTable = false;

        // Fast path: all regions are provinces and one national table already
        // lists them all. One request, one unit, full precision.
        const provinceOnly =
          resolvedRegions.length > 1 &&
          resolvedRegions.every(
            (item) =>
              item.resolved !== null &&
              /^\d{4}$/.test(item.resolved.domainId) &&
              item.resolved.domainId.endsWith("00")
          );

        if (provinceOnly) {
          const breakdown = await buildNationalBreakdown(
            client,
            query,
            resolvedRegions.map((item) => ({
              name: item.regionName,
              domainName: item.resolved!.domainName,
            })),
            parsed.years,
            store
          );
          if (breakdown) {
            usedNationalTable = true;
            for (const item of resolvedRegions) {
              const points = breakdown.byRegion.get(item.resolved!.domainName) ?? [];
              seriesList.push({
                region: item.regionName,
                domain: "0000",
                domainName: item.resolved!.domainName,
                varId: breakdown.varId,
                varTitle: breakdown.varTitle,
                unit: breakdown.unit,
                seriesLabel: breakdown.seriesLabel,
                points,
                missingYears: parsed.years.filter(
                  (year) => !points.some((point) => point.year === year)
                ),
                availableYears: [],
                notes: [],
              });
            }
          }
        }

        if (!usedNationalTable) {
          for (const item of resolvedRegions) {
            if (!item.resolved) {
              seriesList.push({
                region: item.regionName, domain: "?", domainName: item.regionName, varId: null,
                varTitle: query, points: [], missingYears: parsed.years, availableYears: [],
                notes: ["Wilayah tidak ditemukan."],
              });
              continue;
            }
            const series = await buildRegionSeries(
              client,
              store,
              query,
              item.regionName,
              item.resolved.domainId,
              item.resolved.domainName,
              { years: parsed.years, maxCandidates: 6 }
            );
            seriesList.push(series);
          }
        }

        const withData = seriesList.filter((series) => series.points.length > 0);
        if (withData.length === 0) {
          const detail = seriesList.map((series) => `- ${series.region}: ${series.notes.join(" ") || "tidak ada data"}`);
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ada data "${query}"${spec ? ` untuk ${spec}` : ""} di ${regionList.join(", ")}.\n\n${detail.join("\n")}\n\n` +
                `**Saran:** pakai find_variable(keyword="${query}", domain="<kode provinsi>") untuk melihat variabel yang tersedia, atau get_ranking untuk membandingkan seluruh provinsi.`
              ),
            }],
          };
        }

        const varTitle = withData[0].varTitle || query;
        const sameTitle = new Set(withData.map((series) => series.varTitle)).size === 1;
        const displayTitle = sameTitle
          ? varTitle
          : query.charAt(0).toUpperCase() + query.slice(1);

        // Provinces sometimes expose the same count in different units
        // ("Ribu Jiwa" vs "Juta Jiwa"). Normalize before diffing, otherwise
        // the "Selisih" column is nonsense.
        const originalUnits = [...new Set(withData.map((series) => series.unit).filter(Boolean))];
        const massScale = (unit?: string): number | null => {
          const normalized = (unit ?? "").toLowerCase().trim();
          if (normalized === "juta jiwa" || normalized === "juta orang") return 1000;
          if (normalized === "ribu jiwa" || normalized === "ribu orang") return 1;
          if (normalized === "jiwa" || normalized === "orang") return 0.001;
          return null;
        };
        const scales = withData.map((series) => massScale(series.unit));
        const canNormalize = withData.length > 1 && scales.every((scale) => scale !== null);
        let unitNote = "";
        if (canNormalize) {
          withData.forEach((series, index) => {
            const scale = scales[index] as number;
            series.points = series.points.map((point) => ({ ...point, value: point.value * scale }));
            series.unit = "Ribu Jiwa";
          });
          if (originalUnits.length > 1) {
            unitNote = `Satuan diseragamkan ke Ribu Jiwa (asli: ${originalUnits.join(", ")}).`;
          }
        }

        const units = new Set(withData.map((series) => series.unit).filter(Boolean));
        const unitLabel = units.size === 1 ? formatUnit([...units][0]) : "";
        const seriesLabel = withData.find((series) => series.seriesLabel)?.seriesLabel;

        const formatValue = (series: RegionSeries, value: number) => {
          const unit = formatUnit(series.unit);
          return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
        };

        const unitInTitle = unitLabel
          ? new RegExp(`\\(${unitLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "i").test(displayTitle)
          : true;
        const lines: string[] = [
          `## Perbandingan: ${displayTitle}${unitLabel && !unitInTitle ? ` (${unitLabel})` : ""}`,
          `**Wilayah:** ${withData.map((series) => series.domainName).join(", ")}`,
        ];

        if (!multiYear) {
          const first = withData[0];
          const periodLabel = first.points[0]?.label ?? "";
          lines.push(`**Periode:** ${periodLabel || "Terbaru"}${seriesLabel ? ` | **Seri:** ${seriesLabel}` : ""}`, "");

          if (parsed.hasSpec || (spec && !year)) {
            // fall through to table
          }
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
            .map((series) => ({ region: series.region, value: series.points[0].value, text: formatValue(series, series.points[0].value) }));
          if (numeric.length >= 2) {
            const sorted = [...numeric].sort((a, b) => b.value - a.value);
            lines.push("");
            lines.push(`**Tertinggi:** ${sorted[0].region} (${sorted[0].text})`);
            lines.push(`**Terendah:** ${sorted[sorted.length - 1].region} (${sorted[sorted.length - 1].text})`);
          }
          if (units.size > 1) {
            lines.push("", `_Catatan: satuan berbeda antar wilayah (${[...units].join(", ")}); bandingkan dengan hati-hati._`);
          }
        } else {
          const yearKeys = [...new Set(
            withData.flatMap((series) => series.points.map((point) => point.year))
          )].sort();

          const yearRange = yearKeys.length > 1 ? `${yearKeys[0]}–${yearKeys[yearKeys.length - 1]}` : yearKeys[0];
          lines.push(`**Periode:** ${yearRange}${seriesLabel ? ` | **Seri:** ${seriesLabel}` : ""}`, "");

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
              const diff = left !== undefined && right !== undefined
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

        const extraNotes = seriesList.flatMap((series) =>
          series.notes.map((note) => `${series.region}: ${note}`)
        );
        if (unitNote) extraNotes.unshift(unitNote);
        if (usedNationalTable) {
          extraNotes.unshift(
            "Satu tabel nasional dipakai untuk semua wilayah, sehingga satuan dan presisinya konsisten."
          );
        }
        if (extraNotes.length > 0) {
          lines.push("", "_Catatan:_");
          for (const note of [...new Set(extraNotes)]) lines.push(`- ${note}`);
        }

        const sourceKeys = new Set<string>();
        const sources = seriesList
          .filter((series) => series.varId !== null)
          .filter((series) => {
            const key = `${series.varId}:${series.domain}`;
            if (sourceKeys.has(key)) return false;
            sourceKeys.add(key);
            return true;
          })
          .map((series) => {
            const shared = seriesList.filter((other) => other.varId === series.varId && other.domain === series.domain);
            const who = shared.length > 1 ? "semua wilayah" : series.region;
            return `${who}: ${series.varTitle} (var ${series.varId}, domain ${series.domain})`;
          });
        if (sources.length > 0) {
          lines.push("", `_Sumber variabel — ${sources.join("; ")}._`);
          lines.push(
            "_Angka di atas diambil dari baris agregat resmi tiap tabel; jangan menjumlahkan baris kabupaten/kota._"
          );
        }

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : "Gagal membandingkan data" }], isError: true };
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
    async ({ query, region: regionInput, wilayah, start_year, end_year, years }) => {
      const region = regionInput || wilayah || "Indonesia";
      try {
        // Resolve domain
        let domain = "0000";
        let domainName = "Indonesia";
        if (region.toLowerCase() !== "indonesia" && region !== "0000") {
          const resolved = await resolver.resolve(region);
          if (!resolved) {
            return { content: [{ type: "text", text: `Wilayah "${region}" tidak ditemukan.` }], isError: true };
          }
          domain = resolved.domainId;
          domainName = resolved.domainName;
        }

        const spec = years ?? `${start_year}-${end_year}`;
        const parsedYears = parseYearSpec(spec);
        const yearList = parsedYears.years;

        if (yearList.length === 0) {
          return { content: [{ type: "text", text: "Rentang tahun tidak valid." }], isError: true };
        }
        if (yearList.length > 11) {
          return {
            content: [{ type: "text", text: "Rentang maksimal 10 tahun per panggilan. Pecah menjadi beberapa rentang." }],
            isError: true,
          };
        }

        const series = await buildRegionSeries(client, store, query, region, domain, domainName, {
          years: yearList,
          maxCandidates: 6,
        });

        if (series.points.length === 0) {
          // Fallback: headline strategic indicators are often the only series
          // BPS exposes for topics like inflasi (monthly, latest month only).
          try {
            const indicators = await client.listStrategicIndicators(domain);
            const kw = normalizeKeyword(query);
            for (const ind of indicators.data ?? []) {
              const title = ind.title.toLowerCase();
              if (
                title.includes(kw) ||
                kw.split(/\s+/).some((word) => word.length > 2 && title.includes(word))
              ) {
                const val = typeof ind.value === "number" ? ind.value.toLocaleString("id-ID") : ind.value;
                const unit = formatUnit(ind.unit);
                const headline = [
                  `## Tren/Headline ${ind.title}`,
                  `**Wilayah:** ${domainName} (${domain})`,
                  "",
                  "*Catatan: menggunakan data headline indikator strategis karena variabel time-series tidak ditemukan.*",
                  "",
                  "| Periode | Nilai |",
                  "| --- | --- |",
                  `| ${ind.periode} | ${val}${unit ? ` ${unit}` : ""} |`,
                ];
                if (ind.name) headline.push("", `_${ind.name}_`);
                return { content: [{ type: "text", text: appendAttribution(headline.join("\n")) }] };
              }
            }
          } catch {
            // fall through to the diagnostic message
          }

          const notes = series.notes.length > 0 ? `\n\n${series.notes.join("\n")}` : "";
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ada data "${query}" untuk ${domainName} pada ${spec}.${notes}\n\n` +
                `**Saran:** find_variable(keyword="${query}", domain="${domain}") untuk melihat variabel dan cakupan tahunnya.`
              ),
            }],
          };
        }

        const unit = formatUnit(series.unit);
        const lines = [
          `## Tren ${series.varTitle}${unit ? ` (${unit})` : ""}`,
          `**Wilayah:** ${domainName} | **Periode:** ${yearList[0]}–${yearList[yearList.length - 1]}`,
        ];
        if (series.seriesLabel) {
          lines.push(`**Seri:** ${series.seriesLabel}`);
          if (/januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|semester/i.test(series.seriesLabel)) {
            lines.push(`_Catatan: variabel ini punya beberapa sub-periode; nilai yang ditampilkan adalah seri ${series.seriesLabel} pada setiap tahun._`);
          }
        }
        if (series.missingYears.length > 0 && series.points.length > 0) {
          lines.push(`**Catatan:** tahun ${series.missingYears.join(", ")} tidak tersedia untuk variabel ini.`);
        }
        lines.push("", "| Periode | Nilai | Perubahan |", "| --- | --- | --- |");

        for (let i = 0; i < series.points.length; i++) {
          const point = series.points[i];
          let change = "-";
          if (i > 0) {
            const previous = series.points[i - 1].value;
            const diff = point.value - previous;
            if (previous !== 0) {
              const pct = ((diff / previous) * 100).toFixed(1);
              change = `${diff > 0 ? "+" : ""}${pct}%`;
            }
          }
          lines.push(`| ${point.year} | ${point.value.toLocaleString("id-ID")} | ${change} |`);
        }

        if (series.points.length >= 2) {
          const first = series.points[0];
          const last = series.points[series.points.length - 1];
          if (first.value !== 0) {
            const totalChange = ((last.value - first.value) / first.value * 100).toFixed(1);
            const trend = last.value > first.value ? "naik" : last.value < first.value ? "turun" : "stabil";
            lines.push("");
            lines.push(`**Tren:** ${trend} ${totalChange}% dari ${first.year} ke ${last.year}`);
          }
        }

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : "Gagal mengambil data tren" }], isError: true };
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
        const useKabkota = level === "kabkota";

        if (useKabkota) {
          const provinceList = provinces
            ? provinces.split(",").map((name) => name.trim()).filter(Boolean)
            : undefined;
          const ranking = await rankKabkota(client, resolver, {
            query,
            year,
            topN: Math.min(top_n, 200),
            order,
            provinces: provinceList,
            periodMode: period_mode,
          });

          if (ranking.rows.length === 0) {
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
                  indicator: ranking.indicatorLabel,
                  order,
                  rows: ranking.rows,
                  totalRegions: ranking.totalRegions,
                  provincesCovered: ranking.provincesCovered,
                  periods: ranking.periods,
                  targetYear: ranking.targetYear,
                  missingProvinces: ranking.missing,
                }, null, 2),
              }],
            };
          }

          return {
            content: [{ type: "text", text: appendAttribution(formatKabkotaRanking(ranking, { order, query })) }],
          };
        }

        // For ranking, we need national-level data that breaks down by province
        // Prefer variables with "Provinsi" in title for proper provincial breakdown
        const varData = await resolveVariableForRanking(client, store, query);
        if (!varData) {
          return { content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ranking nasional.`) }] };
        }

        const periods = await listAllPeriodsSafe(client, "0000", varData.var_id);
        let selectedPeriod = year
          ? periods.find((period) => getPeriodLabel(period).includes(year))
          : periods[0];
        if (!selectedPeriod) selectedPeriod = periods[0];

        const selectedPeriodId = selectedPeriod ? getPeriodId(selectedPeriod) : "";
        const periodLabel = selectedPeriod ? getPeriodLabel(selectedPeriod) : "";

        const result = await client.getDynamicData("0000", String(varData.var_id), selectedPeriodId || undefined);
        if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data ranking tidak tersedia.`) }] };
        }

        const entries = getVervarEntries(result).filter(
          (entry) => !/^(indonesia|nasional|total|jumlah)$/i.test(entry.label.trim())
        );
        if (entries.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data ranking tidak dapat di-parse. Coba gunakan find_data untuk masing-masing wilayah.`) }] };
        }
        if (entries.length > 40) {
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Variabel "${getVariableTitle(varData)}" memiliki ${entries.length} kategori (bukan level provinsi). ` +
                `Gunakan find_data untuk wilayah tertentu atau find_variable untuk memilih variabel provinsi.`
              ),
            }],
          };
        }

        const valuesByVervar = new Map<string, number>();
        for (const [key, value] of Object.entries(result.datacontent)) {
          if (typeof value !== "number") continue;
          const vervarId = extractVervarId(key, result);
          if (vervarId && !valuesByVervar.has(vervarId)) valuesByVervar.set(vervarId, value);
        }

        const rankings = entries
          .filter((entry) => valuesByVervar.has(entry.id))
          .map((entry) => ({ province: entry.label, value: valuesByVervar.get(entry.id)! }));

        if (rankings.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data ranking tidak dapat di-parse. Coba gunakan find_data untuk masing-masing wilayah.`) }] };
        }

        // Sort
        rankings.sort((a, b) => order === "highest" ? b.value - a.value : a.value - b.value);
        const display = rankings.slice(0, Math.min(top_n, rankings.length));

        // Format
        const unit = formatUnit(getVariableUnit(varData) ?? varData.unit);
        const lines = [
          `## Ranking: ${getVariableTitle(varData) || varData.title}${unit ? ` (${unit})` : ""}`,
          `**Urutan:** ${order === "highest" ? "Tertinggi" : "Terendah"} | **Periode:** ${periodLabel || year || "Terbaru"}`,
          "",
          "| # | Wilayah | Nilai |",
          "| --- | --- | --- |",
        ];

        for (let i = 0; i < display.length; i++) {
          lines.push(`| ${i + 1} | ${display[i].province} | ${display[i].value.toLocaleString("id-ID")} |`);
        }

        if (rankings.length > display.length) {
          lines.push("");
          lines.push(`_Menampilkan ${display.length} dari ${rankings.length} wilayah._`);
        }

        // Point agents at the kab/kota equivalent so they do not sweep the
        // provinces by hand after getting a province-only answer.
        const kabkotaIndicator = findKabkotaIndicator(query);
        if (kabkotaIndicator) {
          lines.push("");
          lines.push(
            `_Butuh level kabupaten/kota? Panggil \`get_ranking(query="${query}", level="kabkota")\` — ` +
              `satu panggilan, semua kab/kota se-Indonesia, tahun diseragamkan._`
          );
        }

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : "Gagal mengambil data ranking" }], isError: true };
      }
    }
  );
}

// --- Helper functions ---

async function listAllPeriodsSafe(client: BpsClient, domain: string, varId: number) {
  const maybeAll = (client as BpsClient & {
    listAllPeriods?: (domain?: string, varId?: number) => Promise<Array<Record<string, unknown>>>;
  }).listAllPeriods;
  if (typeof maybeAll === "function") {
    return maybeAll.call(client, domain, varId);
  }
  return client.listPeriods(domain, varId);
}

/** Resolve a national variable that breaks down by province, for rankings. */
async function resolveVariableForRanking(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
  // Repeat rankings reuse the national table learned last time (one period
  // listing) instead of sweeping subjects and variables again.
  const learned = await lookupVar(query, "0000", store);
  if (learned) {
    try {
      const periods = await listAllPeriodsSafe(client, "0000", learned.var_id);
      const hasRecent = periods.some((period) => {
        const year = Number(getPeriodLabel(period).match(/\d{4}/)?.[0] ?? 0);
        return year >= 2020;
      });
      if (hasRecent) return learned;
    } catch {
      // Fall through to the search below.
    }
  }

  const candidates = await searchVariables(client, "0000", query, {
    maxSubjects: 8,
    maxPagesPerSubject: 6,
    maxCandidates: 40,
  });
  if (candidates.length === 0) {
    return resolveVariableShared(client, store, query, "0000");
  }

  const provinceCandidates = candidates.filter(
    (candidate) => /provinsi/i.test(candidate.title) && !/metode lama/i.test(candidate.title)
  );
  const pool = provinceCandidates.length > 0 ? provinceCandidates : candidates;

  const scored = pool
    .map((candidate) => ({
      candidate,
      score:
        candidate.score +
        (/persentase|tingkat|indeks|rasio/i.test(candidate.title) ? 10 : 0) -
        (/kabupaten|kecamatan/i.test(candidate.title) ? 20 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  for (const { candidate } of scored.slice(0, 5)) {
    const periods = await listAllPeriodsSafe(client, "0000", candidate.var_id);
    const hasRecent = periods.some((period) => {
      const year = Number(getPeriodLabel(period).match(/\d{4}/)?.[0] ?? 0);
      return year >= 2020;
    });
    if (hasRecent) return candidate;
  }

  return scored[0]?.candidate ?? null;
}
