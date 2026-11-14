import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { appendAttribution } from "../services/attribution.js";
import { invalidateVar, normalizeKeyword } from "../services/learning.js";
import {
  resolveVariable as resolveVariableShared,
  resolveVariableForYears,
  searchVariables,
} from "../services/variable-search.js";
import {
  extractVervarId,
  getAggregateValue,
  getVervarEntries,
  selectAggregateVervar,
} from "../services/dynamic-data-utils.js";
import {
  formatUnit,
  getPeriodId,
  getPeriodLabel,
  getTurthId,
  getTurthLabel,
  getVariableTitle,
  getVariableUnit,
  isNeutralPeriodLabel,
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
    `Bandingkan data statistik antar wilayah dalam 1 langkah.
Gunakan tool ini ketika user ingin membandingkan data antara 2 atau lebih wilayah.
Catatan: hanya mendukung perbandingan untuk 1 tahun. Untuk perbandingan multi-tahun, gunakan get_trend per wilayah.

Contoh query user yang cocok untuk tool ini:
- "bandingkan kemiskinan Jawa Timur dan Jawa Barat"
- "IPM DKI Jakarta vs Banten vs Jawa Barat"
- "perbandingan pengangguran antar provinsi di Jawa"
- "mana yang lebih tinggi kemiskinan Jatim atau Jabar?"`,
    {
      query: z.string().describe("Indikator yang dibandingkan (misal: kemiskinan, pengangguran, IPM, penduduk)"),
      regions: z.string().describe("Nama wilayah dipisah koma (misal: 'Jawa Timur, Jawa Barat, Jawa Tengah')"),
      year: z.string().optional().describe("Tahun data (misal: '2023'). Kosongkan untuk data terbaru."),
    },
    async ({ query, regions, year }) => {
      try {
        const regionList = regions.split(",").map(r => r.trim()).filter(Boolean);
        if (regionList.length < 2) {
          return { content: [{ type: "text", text: "Minimal 2 wilayah untuk perbandingan." }], isError: true };
        }
        if (year && /[,;]/.test(year)) {
          return {
            content: [{ type: "text", text: "compare_data hanya mendukung 1 tahun. Gunakan get_trend per wilayah untuk multi-tahun." }],
            isError: true,
          };
        }

        const results: Array<{
          region: string;
          domain: string;
          value: string;
          rawValue: number | null;
          unit?: string;
          varTitle: string;
          period?: string;
        }> = [];

        for (const regionName of regionList) {
          const resolved = await resolver.resolve(regionName);
          if (!resolved) {
            results.push({ region: regionName, domain: "?", value: "Wilayah tidak ditemukan", rawValue: null, varTitle: "" });
            continue;
          }

          const { domainId, domainName } = resolved;
          const data = await fetchDataForDomain(client, store, query, domainId, year);
          results.push({
            region: domainName,
            domain: domainId,
            value: data.value,
            rawValue: data.rawValue,
            unit: data.unit,
            varTitle: data.varTitle,
            period: data.period,
          });
        }

        // Format output
        const varTitle = results.find(r => r.varTitle)?.varTitle || query;
        const showPeriod = !year;
        const lines = [
          `## Perbandingan: ${varTitle}`,
          year ? `**Tahun:** ${year}` : "**Tahun:** Terbaru",
          "",
          showPeriod ? "| Wilayah | Nilai | Periode |" : "| Wilayah | Nilai |",
          showPeriod ? "| --- | --- | --- |" : "| --- | --- |",
        ];

        for (const r of results) {
          lines.push(showPeriod ? `| ${r.region} | ${r.value} | ${r.period ?? "-"} |` : `| ${r.region} | ${r.value} |`);
        }

        // Add analysis hint (use the raw numeric value, not the localized string)
        const numericResults = results.filter(
          (result): result is typeof result & { rawValue: number } => result.rawValue !== null
        );
        if (numericResults.length >= 2) {
          const values = [...numericResults].sort((a, b) => b.rawValue - a.rawValue);
          lines.push("");
          lines.push(`**Tertinggi:** ${values[0].region} (${values[0].value})`);
          lines.push(`**Terendah:** ${values[values.length - 1].region} (${values[values.length - 1].value})`);

          const units = new Set(numericResults.map((result) => result.unit).filter(Boolean));
          if (units.size > 1) {
            lines.push("", `_Catatan: satuan berbeda antar wilayah (${[...units].join(", ")}); bandingkan dengan hati-hati._`);
          }
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
Gunakan tool ini ketika user ingin melihat perkembangan/tren data dari tahun ke tahun.

Contoh query user yang cocok untuk tool ini:
- "tren kemiskinan Indonesia 2019-2023"
- "perkembangan IPM Jawa Timur 5 tahun terakhir"
- "bagaimana pengangguran dari 2020 sampai 2024?"
- "data kemiskinan Jawa Barat dari tahun ke tahun"`,
    {
      query: z.string().describe("Indikator yang dianalisis (misal: kemiskinan, pengangguran, IPM)"),
      region: z.string().default("Indonesia").describe("Nama wilayah"),
      start_year: z.string().default("2019").describe("Tahun awal"),
      end_year: z.string().default("2024").describe("Tahun akhir"),
    },
    async ({ query, region, start_year, end_year }) => {
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

        const startNum = parseInt(start_year, 10);
        const endNum = parseInt(end_year, 10);
        if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || startNum > endNum) {
          return { content: [{ type: "text", text: "Rentang tahun tidak valid." }], isError: true };
        }
        if (endNum - startNum > 10) {
          return {
            content: [{ type: "text", text: "Rentang maksimal 10 tahun per panggilan. Pecah menjadi beberapa rentang." }],
            isError: true,
          };
        }
        const years = Array.from({ length: endNum - startNum + 1 }, (_, index) => String(startNum + index));

        // Resolve variable that actually has the requested years.
        const resolved = await resolveVariableForYears(client, store, query, domain, years, {
          maxCandidates: 20,
        });
        let varData = resolved?.varData ?? null;
        const matchedYears = resolved?.matchedYears ?? [];
        if (!varData || (years.length > 0 && matchedYears.length === 0)) {
          // Fallback: strategic indicators (headline only)
          const indicators = await client.listStrategicIndicators(domain);
          const kw2 = normalizeKeyword(query);
          for (const ind of indicators.data ?? []) {
            const title = ind.title.toLowerCase();
            if (title.includes(kw2) || kw2.split(/\s+/).some((word) => word.length > 2 && title.includes(word))) {
              const val = typeof ind.value === "number" ? ind.value.toLocaleString("id-ID") : ind.value;
              const unit = formatUnit(ind.unit);
              const lines = [
                `## Tren/Headline ${ind.title}`,
                `**Wilayah:** ${domainName} (${domain})`,
                "",
                `*Catatan: Menggunakan data headline indikator strategis karena variabel time-series lengkap tidak ditemukan.*`,
                "",
                `| Periode | Nilai |`,
                `| --- | --- |`,
                `| ${ind.periode} | ${val}${unit ? ` ${unit}` : ""} |`,
              ];
              if (ind.name) lines.push("", `_${ind.name}_`);
              return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
            }
          }
          return { content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ${domainName}.`) }] };
        }

        let periods = resolved?.periods ?? [];
        if (periods.length === 0) {
          await invalidateVar(query, domain, store);
          const retry = await searchVariables(client, domain, query, { maxCandidates: 10 });
          const retryVar = retry[0];
          if (!retryVar) {
            return { content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ${domainName}.`) }] };
          }
          varData = retryVar;
          periods = await listAllPeriodsSafe(client, domain, varData.var_id);
        }

        const yearToPeriod = new Map<string, string>();
        for (const period of periods) {
          const label = getPeriodLabel(period);
          const periodYear = label.match(/\d{4}/)?.[0];
          const id = getPeriodId(period);
          if (!periodYear || !id || !years.includes(periodYear)) continue;
          if (!yearToPeriod.has(periodYear)) yearToPeriod.set(periodYear, id);
        }

        const periodIds = years.map((year) => yearToPeriod.get(year)).filter((id): id is string => !!id);
        if (periodIds.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Tidak ada data periode ${start_year}-${end_year} untuk variabel ini.`) }] };
        }

        const result = await client.getDynamicData(domain, String(varData.var_id), periodIds.join(","));
        if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data tidak tersedia untuk periode ${start_year}-${end_year}.`) }] };
        }

        const periodLabels = new Map<string, string>();
        for (const period of result.tahun ?? []) {
          periodLabels.set(getPeriodId(period), getPeriodLabel(period));
        }

        const aggregateVervar = selectAggregateVervar(result, domain, domainName);
        const selectedTurth = selectTrendTurth(
          result.turtahun ?? [],
          Object.keys(result.datacontent ?? {}),
          periodIds
        );
        const vervarEntries = getVervarEntries(result);
        if (!aggregateVervar && vervarEntries.length > 10) {
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Variabel "${getVariableTitle(varData) || varData.title}" tidak memiliki baris agregat nasional ` +
                `(hanya ${vervarEntries.length} provinsi/kategori). Gunakan get_trend dengan region provinsi, ` +
                `atau get_ranking untuk membandingkan seluruh provinsi.`
              ),
            }],
          };
        }
        const sortedPeriodIds = [...periodIds].sort((a, b) => b.length - a.length);
        const trendData: Array<{ year: string; value: number }> = [];

        for (const [key, value] of Object.entries(result.datacontent)) {
          if (typeof value !== "number") continue;
          if (aggregateVervar && extractVervarId(key, result) !== aggregateVervar) continue;
          if (selectedTurth?.id && !key.endsWith(selectedTurth.id)) continue;

          const periodId = sortedPeriodIds.find((id) => key.includes(id));
          if (!periodId) continue;
          const label = periodLabels.get(periodId) ?? periodId;
          if (trendData.some((item) => item.year === label)) continue;
          trendData.push({ year: label, value });
        }

        trendData.sort((a, b) => a.year.localeCompare(b.year));

        if (trendData.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data tren tidak dapat di-parse.`) }] };
        }

        // Format output
        const unit = formatUnit(getVariableUnit(varData) ?? varData.unit);
        const title = getVariableTitle(varData) || varData.title;
        const lines = [
          `## Tren ${title}${unit ? ` (${unit})` : ""}`,
          `**Wilayah:** ${domainName} | **Periode:** ${start_year}–${end_year}`,
        ];
        if (selectedTurth && !isNeutralPeriodLabel(selectedTurth.label)) {
          lines.push(`**Seri:** ${selectedTurth.label}`);
          if (/januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember/i.test(selectedTurth.label)) {
            lines.push(`_Catatan: variabel ini bulanan; nilai yang ditampilkan adalah bulan ${selectedTurth.label} pada setiap tahun._`);
          }
        }
        const missingYears = years.filter((year) => !matchedYears.includes(year));
        if (missingYears.length > 0 && matchedYears.length > 0) {
          lines.push(`**Catatan:** tahun ${missingYears.join(", ")} tidak tersedia untuk variabel ini.`);
        }
        lines.push("", "| Periode | Nilai | Perubahan |", "| --- | --- | --- |");

        for (let i = 0; i < trendData.length; i++) {
          const d = trendData[i];
          let change = "-";
          if (i > 0) {
            const previous = trendData[i - 1].value;
            const diff = d.value - previous;
            if (previous !== 0) {
              const pct = ((diff / previous) * 100).toFixed(1);
              change = `${diff > 0 ? "+" : ""}${pct}%`;
            }
          }
          lines.push(`| ${d.year} | ${d.value.toLocaleString("id-ID")} | ${change} |`);
        }

        // Summary
        if (trendData.length >= 2) {
          const first = trendData[0].value;
          const last = trendData[trendData.length - 1].value;
          if (first !== 0) {
            const totalChange = ((last - first) / first * 100).toFixed(1);
            const trend = last > first ? "naik" : last < first ? "turun" : "stabil";
            lines.push("");
            lines.push(`**Tren:** ${trend} ${totalChange}% dari ${trendData[0].year} ke ${trendData[trendData.length - 1].year}`);
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
    `Ambil peringkat/ranking provinsi berdasarkan indikator tertentu dalam 1 langkah.
Gunakan tool ini ketika user ingin melihat peringkat, top-N, atau perbandingan seluruh provinsi.

Contoh query user yang cocok untuk tool ini:
- "10 provinsi termiskin di Indonesia"
- "peringkat IPM seluruh provinsi"
- "provinsi dengan pengangguran tertinggi"
- "ranking kemiskinan per provinsi 2023"
- "5 provinsi dengan penduduk terbanyak"`,
    {
      query: z.string().describe("Indikator untuk ranking (misal: kemiskinan, pengangguran, IPM, penduduk)"),
      top_n: z.number().int().min(1).max(40).default(10).describe("Jumlah data yang ditampilkan (default 10, max 40 untuk semua provinsi)"),
      order: z.enum(["highest", "lowest"]).default("highest").describe("Urutan: 'highest' (tertinggi dulu) atau 'lowest' (terendah dulu)"),
      year: z.string().optional().describe("Tahun data. Kosongkan untuk terbaru."),
    },
    async ({ query, top_n, order, year }) => {
      try {
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

function selectTrendTurth(
  turthList: unknown[],
  datacontentKeys: string[],
  periodIds: string[]
): { id: string; label: string } | null {
  const entries = turthList
    .map((item) => ({ id: getTurthId(item), label: getTurthLabel(item) }))
    .filter((entry) => entry.id !== "");
  if (entries.length === 0) return null;

  // BPS often lists series (annual, monthly, semester) that are not present for
  // every requested year. Count actual coverage and pick the best one instead
  // of selecting "Tahunan" and silently dropping years where it is missing.
  const scored = entries
    .map((entry) => {
      const coverage = periodIds.filter((periodId) =>
        datacontentKeys.some((key) => key.includes(periodId) && key.endsWith(entry.id))
      ).length;
      return { entry, coverage };
    })
    .filter((candidate) => candidate.coverage > 0)
    .sort((a, b) => b.coverage - a.coverage);

  if (scored.length === 0) return null;

  const bestCoverage = scored[0].coverage;
  const best = scored.filter((candidate) => candidate.coverage === bestCoverage).map((candidate) => candidate.entry);

  const annual = best.find((entry) => isNeutralPeriodLabel(entry.label));
  if (annual) return annual;

  const firstSemester = best.find((entry) => /semester\s*1/i.test(entry.label));
  if (firstSemester) return firstSemester;

  const december = best.find((entry) => /desember/i.test(entry.label));
  if (december) return december;

  return best[0];
}

/** Fetch a single aggregate value for a domain + query + year. */
async function fetchDataForDomain(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  domain: string,
  year: string | undefined
): Promise<{ value: string; rawValue: number | null; unit?: string; varTitle: string; period?: string }> {
  const yearList = year ? [year] : [];
  const resolved = await resolveVariableForYears(client, store, query, domain, yearList, {
    maxCandidates: 20,
  });
  let varData = resolved?.varData ?? null;

  if (yearList.length > 0 && (!resolved || resolved.matchedYears.length === 0)) {
    varData = null;
  }

  if (!varData) {
    const indicators = await client.listStrategicIndicators(domain);
    const kw = normalizeKeyword(query);
    for (const indicator of indicators.data ?? []) {
      const title = indicator.title.toLowerCase();
      if (title.includes(kw) || kw.split(/\s+/).some((word) => word.length > 2 && title.includes(word))) {
        if (year && !indicator.periode.includes(year)) continue;
        const unit = formatUnit(indicator.unit);
        const rawValue = typeof indicator.value === "number" ? indicator.value : null;
        const formatted = typeof indicator.value === "number"
          ? indicator.value.toLocaleString("id-ID")
          : String(indicator.value);
        return {
          value: `${formatted}${unit ? ` ${unit}` : ""} (${indicator.periode})`,
          rawValue,
          unit,
          varTitle: indicator.title,
          period: indicator.periode,
        };
      }
    }
    return { value: "N/A", rawValue: null, varTitle: "" };
  }

  let periods = resolved?.periods ?? [];
  if (periods.length === 0) {
    await invalidateVar(query, domain, store);
    const retry = await searchVariables(client, domain, query, { maxCandidates: 10 });
    const retryVar = retry[0];
    if (!retryVar) return { value: "N/A", rawValue: null, varTitle: "" };
    varData = retryVar;
    periods = await listAllPeriodsSafe(client, domain, varData.var_id);
  }

  let selectedPeriod = year
    ? periods.find((period) => getPeriodLabel(period).includes(year))
    : periods[0];
  // With an explicit year, never silently fall back to a different year.
  if (!selectedPeriod && year) {
    return {
      value: "N/A",
      rawValue: null,
      varTitle: getVariableTitle(varData) || varData.title,
    };
  }
  if (!selectedPeriod) selectedPeriod = periods[0];

  const periodId = selectedPeriod ? getPeriodId(selectedPeriod) : "";
  const periodLabel = selectedPeriod ? getPeriodLabel(selectedPeriod) : "";
  const result = await client.getDynamicData(domain, String(varData.var_id), periodId || undefined);
  const rawValue = getAggregateValue(result, domain);
  const unit = formatUnit(getVariableUnit(varData) ?? varData.unit);

  if (rawValue === null) {
    return { value: "N/A", rawValue: null, unit, varTitle: getVariableTitle(varData) || varData.title, period: periodLabel };
  }

  return {
    value: `${rawValue.toLocaleString("id-ID")}${unit ? ` ${unit}` : ""}`,
    rawValue,
    unit,
    varTitle: getVariableTitle(varData) || varData.title,
    period: periodLabel,
  };
}

/** Resolve a national variable that breaks down by province, for rankings. */
async function resolveVariableForRanking(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
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
