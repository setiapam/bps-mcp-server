import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { appendAttribution } from "../services/attribution.js";
import { lookupVar, learnVar, normalizeKeyword } from "../services/learning.js";

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

        const results: Array<{ region: string; domain: string; value: string; varTitle: string }> = [];

        for (const regionName of regionList) {
          const resolved = await resolver.resolve(regionName);
          if (!resolved) {
            results.push({ region: regionName, domain: "?", value: "Wilayah tidak ditemukan", varTitle: "" });
            continue;
          }

          const { domainId, domainName } = resolved;
          const data = await fetchDataForDomain(client, store, query, domainId, year);
          results.push({
            region: domainName,
            domain: domainId,
            value: data.value,
            varTitle: data.varTitle,
          });
        }

        // Format output
        const varTitle = results.find(r => r.varTitle)?.varTitle || query;
        const lines = [
          `## Perbandingan: ${varTitle}`,
          year ? `**Tahun:** ${year}` : "**Tahun:** Terbaru",
          "",
          "| Wilayah | Nilai |",
          "| --- | --- |",
        ];

        for (const r of results) {
          lines.push(`| ${r.region} | ${r.value} |`);
        }

        // Add analysis hint
        const numericResults = results.filter(r => !isNaN(parseFloat(r.value.replace(",", "."))));
        if (numericResults.length >= 2) {
          const values = numericResults.map(r => ({ region: r.region, val: parseFloat(r.value.replace(",", ".")) }));
          values.sort((a, b) => b.val - a.val);
          lines.push("");
          lines.push(`**Tertinggi:** ${values[0].region} (${values[0].val})`);
          lines.push(`**Terendah:** ${values[values.length - 1].region} (${values[values.length - 1].val})`);
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

        // Find variable
        const varData = await resolveVariable(client, store, query, domain);
        if (!varData) {
          return { content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ${domainName}.`) }] };
        }

        // Build year range
        const startNum = parseInt(start_year);
        const endNum = parseInt(end_year);
        const years: string[] = [];
        for (let y = startNum; y <= endNum; y++) years.push(String(y));

        // Get periods for all years
        const periods = await client.listPeriods(domain, varData.var_id);
        const yearToPeriod: Record<string, string> = {};
        for (const p of periods) {
          const pAny = p as unknown as Record<string, unknown>;
          const label = String(pAny.th_name || pAny.th || pAny.label || "");
          const id = String(p.th_id ?? pAny.val);
          for (const y of years) {
            if (label.includes(y)) yearToPeriod[y] = id;
          }
        }

        const periodIds = years.map(y => yearToPeriod[y]).filter(Boolean);
        if (periodIds.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Tidak ada data periode ${start_year}-${end_year} untuk variabel ini.`) }] };
        }

        // Fetch data
        const result = await client.getDynamicData(domain, String(varData.var_id), periodIds.join(","));
        if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data tidak tersedia untuk periode ${start_year}-${end_year}.`) }] };
        }

        // Parse datacontent — match period IDs to values
        // Build period label map from response
        const periodLabels: Record<string, string> = {};
        if (result.tahun) {
          for (const t of result.tahun) {
            const tAny = t as unknown as Record<string, unknown>;
            const id = String(t.th_id ?? tAny.val);
            const label = String(t.th_name ?? tAny.label ?? id);
            periodLabels[id] = label;
          }
        }

        // Extract values — find entries matching the domain (for provincial data, filter by domain prefix)
        const trendData: Array<{ year: string; value: number }> = [];
        for (const [key, value] of Object.entries(result.datacontent)) {
          if (typeof value !== "number") continue;
          // Find which period this key belongs to
          for (const pid of periodIds) {
            if (key.includes(pid)) {
              // For provincial data, only take the aggregate (key starts with domain or short key)
              const label = periodLabels[pid] || pid;
              // Avoid duplicates and take only the first match (aggregate)
              if (!trendData.some(d => d.year === label)) {
                trendData.push({ year: label, value });
              }
              break;
            }
          }
        }

        trendData.sort((a, b) => a.year.localeCompare(b.year));

        if (trendData.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data tren tidak dapat di-parse.`) }] };
        }

        // Format output
        const unit = varData.unit ? ` (${varData.unit})` : "";
        const lines = [
          `## Tren ${varData.title}${unit}`,
          `**Wilayah:** ${domainName} | **Periode:** ${start_year}–${end_year}`,
          "",
          "| Tahun | Nilai | Perubahan |",
          "| --- | --- | --- |",
        ];

        for (let i = 0; i < trendData.length; i++) {
          const d = trendData[i];
          let change = "-";
          if (i > 0) {
            const diff = d.value - trendData[i - 1].value;
            const pct = ((diff / trendData[i - 1].value) * 100).toFixed(1);
            change = `${diff > 0 ? "+" : ""}${pct}%`;
          }
          lines.push(`| ${d.year} | ${d.value.toLocaleString("id-ID")} | ${change} |`);
        }

        // Summary
        if (trendData.length >= 2) {
          const first = trendData[0].value;
          const last = trendData[trendData.length - 1].value;
          const totalChange = ((last - first) / first * 100).toFixed(1);
          const trend = last > first ? "naik" : last < first ? "turun" : "stabil";
          lines.push("");
          lines.push(`**Tren:** ${trend} ${totalChange}% dari ${trendData[0].year} ke ${trendData[trendData.length - 1].year}`);
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
      top_n: z.number().default(10).describe("Jumlah data yang ditampilkan (default 10, max 34 untuk semua provinsi)"),
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

        // Get latest period
        let periodParam: string | undefined;
        if (year) {
          const periods = await client.listPeriods("0000", varData.var_id);
          for (const p of periods) {
            const pAny = p as unknown as Record<string, unknown>;
            const label = String(pAny.th_name || pAny.th || pAny.label || "");
            if (label.includes(year)) {
              periodParam = String(p.th_id ?? pAny.val);
              break;
            }
          }
        }
        if (!periodParam) {
          const periods = await client.listPeriods("0000", varData.var_id);
          if (periods.length > 0) {
            const pAny = periods[0] as unknown as Record<string, unknown>;
            periodParam = String(periods[0].th_id ?? pAny.val);
          }
        }

        const result = await client.getDynamicData("0000", String(varData.var_id), periodParam);
        if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data ranking tidak tersedia.`) }] };
        }

        // Build vervar (province) label map
        const vervarLabels: Record<string, string> = {};
        if (result.vervar) {
          for (const v of result.vervar) {
            const vAny = v as unknown as Record<string, unknown>;
            const id = String(v.kode_vervar ?? vAny.val);
            const label = String(v.label_vervar ?? vAny.label ?? id);
            vervarLabels[id] = label;
          }
        }

        // Extract province-level data
        const rankings: Array<{ province: string; value: number }> = [];
        for (const [key, value] of Object.entries(result.datacontent)) {
          if (typeof value !== "number") continue;
          // Match vervar ID in the key
          for (const [vId, vLabel] of Object.entries(vervarLabels)) {
            if (key.includes(vId) && !rankings.some(r => r.province === vLabel)) {
              rankings.push({ province: vLabel, value });
              break;
            }
          }
        }

        if (rankings.length === 0) {
          return { content: [{ type: "text", text: appendAttribution(`Data ranking tidak dapat di-parse. Coba gunakan find_data untuk masing-masing wilayah.`) }] };
        }

        // Sort
        rankings.sort((a, b) => order === "highest" ? b.value - a.value : a.value - b.value);
        const display = rankings.slice(0, Math.min(top_n, rankings.length));

        // Format
        const unit = varData.unit ? ` (${varData.unit})` : "";
        const lines = [
          `## Ranking: ${varData.title}${unit}`,
          `**Urutan:** ${order === "highest" ? "Tertinggi" : "Terendah"} | **Tahun:** ${year || "Terbaru"}`,
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

/** Resolve variable for a domain using learning store + full search fallback. */
async function resolveVariable(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  domain: string
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
  // Try learning store first
  const learned = await lookupVar(query, domain, store);
  if (learned) return learned;

  // Full search
  const kw = normalizeKeyword(query);
  const KEYWORD_SUBJECTS: Record<string, number[]> = {
    pengangguran: [6], tenaga: [6], kerja: [6], tpt: [6],
    miskin: [23], kemiskinan: [23], gini: [23], ketimpangan: [23],
    penduduk: [12], kependudukan: [12],
    inflasi: [3], harga: [3], ihk: [3],
    pdrb: [52], ekonomi: [52, 35], pertumbuhan: [52],
    ipm: [26], pembangunan: [26],
    ekspor: [8], impor: [8],
  };

  const subjectIds: number[] = [];
  for (const [keyword, ids] of Object.entries(KEYWORD_SUBJECTS)) {
    if (kw.includes(keyword)) subjectIds.push(...ids);
  }

  // Also match from subject titles
  const subjects = await client.listSubjects(domain);
  for (const s of subjects.data) {
    if (kw.split(/\s+/).some(w => w.length > 2 && s.title.toLowerCase().includes(w))) {
      if (!subjectIds.includes(s.sub_id)) subjectIds.push(s.sub_id);
    }
  }

  for (const subId of subjectIds.slice(0, 3)) {
    const result = await client.listVariables(domain, subId, undefined, 1, 100);
    if (!result.data) continue;
    for (const v of result.data) {
      const titleLower = v.title.toLowerCase();
      if (titleLower.includes(kw) || kw.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w))) {
        const found = { var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit };
        await learnVar(query, domain, found, store);
        return found;
      }
    }
  }

  return null;
}

/** Fetch a single data value for a domain+query+year. */
async function fetchDataForDomain(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  domain: string,
  year: string | undefined
): Promise<{ value: string; varTitle: string }> {
  const varData = await resolveVariable(client, store, query, domain);
  if (!varData) return { value: "N/A", varTitle: "" };

  // Resolve period
  let periodParam: string | undefined;
  const periods = await client.listPeriods(domain, varData.var_id);
  if (year && periods.length > 0) {
    for (const p of periods) {
      const pAny = p as unknown as Record<string, unknown>;
      const label = String(pAny.th_name || pAny.th || pAny.label || "");
      if (label.includes(year)) {
        periodParam = String(p.th_id ?? pAny.val);
        break;
      }
    }
  }
  if (!periodParam && periods.length > 0) {
    const pAny = periods[0] as unknown as Record<string, unknown>;
    periodParam = String(periods[0].th_id ?? pAny.val);
  }

  const result = await client.getDynamicData(domain, String(varData.var_id), periodParam);
  if (!result.datacontent || Object.keys(result.datacontent).length === 0) {
    return { value: "N/A", varTitle: varData.title };
  }

  // Get the aggregate value (first entry or the one matching the domain)
  const values = Object.values(result.datacontent).filter(v => typeof v === "number") as number[];
  if (values.length === 0) return { value: "N/A", varTitle: varData.title };

  // First value is typically the aggregate for the domain
  const val = values[0];
  const unit = varData.unit ? ` ${varData.unit}` : "";
  return { value: `${val.toLocaleString("id-ID")}${unit}`, varTitle: varData.title };
}

/** Resolve variable for ranking — prefer "Menurut Provinsi" variants at national level. */
async function resolveVariableForRanking(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
  const kw = normalizeKeyword(query);
  const kwWords = kw.split(/\s+/).filter(w => w.length > 2);
  // Add root words for common Indonesian affixes: ke-...-an → root
  const roots: string[] = [...kwWords];
  for (const w of kwWords) {
    if (w.startsWith("ke") && w.endsWith("an") && w.length > 6) roots.push(w.slice(2, -2)); // kemiskinan → miskin
    if (w.startsWith("pe") && w.endsWith("an") && w.length > 6) roots.push(w.slice(2, -2)); // pengangguran → nganggur
    if (w.endsWith("an") && w.length > 5) roots.push(w.slice(0, -2)); // pengangguran → pengangguran (already), kemiskinan → kemiskina (not useful but harmless)
  }
  const matchesTitle = (t: string) =>
    roots.some(r => t.includes(r));

  const KEYWORD_SUBJECTS: Record<string, number[]> = {
    miskin: [23], kemiskinan: [23], gini: [23],
    pengangguran: [6], tpt: [6],
    penduduk: [12], ipm: [26],
  };

  const subjectIds: number[] = [];
  for (const [keyword, ids] of Object.entries(KEYWORD_SUBJECTS)) {
    if (kw.includes(keyword)) subjectIds.push(...ids);
  }
  if (subjectIds.length === 0) subjectIds.push(23, 6, 12, 26);

  // Search for variables with "Provinsi" in title
  for (const subId of subjectIds.slice(0, 3)) {
    const result = await client.listVariables("0000", subId, undefined, 1, 100);
    if (!result.data) continue;

    // First pass: find one with "Provinsi" AND matching keyword
    for (const v of result.data) {
      const t = v.title.toLowerCase();
      if (t.includes("provinsi") && matchesTitle(t)) {
        // Prefer "persentase" or "tingkat" variants (main indicators)
        if (t.includes("persentase") || t.includes("tingkat") || t.includes("indeks")) {
          return { var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit };
        }
      }
    }

    // Second pass: "Provinsi" + keyword match (any)
    for (const v of result.data) {
      const t = v.title.toLowerCase();
      if (t.includes("provinsi") && matchesTitle(t)) {
        return { var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit };
      }
    }

    // Second pass: any match without "Provinsi" requirement
    for (const v of result.data) {
      const t = v.title.toLowerCase();
      if (t.includes(kw) || kw.split(/\s+/).some(w => w.length > 2 && t.includes(w))) {
        return { var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit };
      }
    }
  }

  // Fallback to general resolver
  return resolveVariable(client, store, query, "0000");
}
