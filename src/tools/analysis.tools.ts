import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { appendAttribution } from "../services/attribution.js";
import { lookupVar, learnVar, invalidateVar, normalizeKeyword } from "../services/learning.js";

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
        let varData = await resolveVariable(client, store, query, domain);
        if (!varData) {
          // Fallback: try strategic indicators for inflasi/PDRB/etc.
          const indicators = await client.listStrategicIndicators(domain);
          if (indicators.data) {
            const kw2 = normalizeKeyword(query);
            for (const ind of indicators.data) {
              const t = ind.title.toLowerCase();
              if (t.includes(kw2) || kw2.split(/\s+/).some(w => w.length > 2 && t.includes(w))) {
                if (ind.data) {
                  const entries = Object.entries(ind.data).filter(([k]) => {
                    const y = parseInt(k);
                    return y >= parseInt(start_year) && y <= parseInt(end_year);
                  });
                  if (entries.length > 0) {
                    const lines = [`## Tren ${ind.title}`, `**Wilayah:** ${domainName} | **Periode:** ${start_year}–${end_year}`, "", "| Tahun | Nilai | Perubahan |", "| --- | --- | --- |"];
                    const sorted = entries.sort((a, b) => a[0].localeCompare(b[0]));
                    for (let i = 0; i < sorted.length; i++) {
                      const [period, val] = sorted[i];
                      let change = "-";
                      if (i > 0 && typeof val === "number" && typeof sorted[i-1][1] === "number") {
                        const prev = sorted[i-1][1] as number;
                        const pct = ((val - prev) / Math.abs(prev) * 100).toFixed(1);
                        change = `${val > prev ? "+" : ""}${pct}%`;
                      }
                      lines.push(`| ${period} | ${typeof val === "number" ? val.toLocaleString("id-ID") : val} | ${change} |`);
                    }
                    if (sorted.length >= 2) {
                      const first = sorted[0][1] as number;
                      const last = sorted[sorted.length-1][1] as number;
                      if (typeof first === "number" && typeof last === "number") {
                        const totalChange = ((last - first) / Math.abs(first) * 100).toFixed(1);
                        lines.push("", `**Tren:** ${last > first ? "naik" : "turun"} ${totalChange}% dari ${sorted[0][0]} ke ${sorted[sorted.length-1][0]}`);
                      }
                    }
                    return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
                  }
                }
              }
            }
          }
          return { content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ${domainName}.`) }] };
        }

        // Build year range
        const startNum = parseInt(start_year);
        const endNum = parseInt(end_year);
        const years: string[] = [];
        for (let y = startNum; y <= endNum; y++) years.push(String(y));

        // Get periods for all years
        let periods = await client.listPeriods(domain, varData.var_id);

        // Fallback: if no periods found, invalidate cached var and do full search
        if (periods.length === 0) {
          await invalidateVar(query, domain, store);
          varData = await resolveVariableFullSearch(client, store, query, domain);
          if (!varData) {
            return { content: [{ type: "text", text: appendAttribution(`Tidak ditemukan variabel "${query}" untuk ${domainName}.`) }] };
          }
          periods = await client.listPeriods(domain, varData.var_id);
        }

        const yearToPeriod: Record<string, string> = {};
        for (const p of periods) {
          const pAny = p as unknown as Record<string, unknown>;
          const label = String(pAny.th_name || pAny.th || pAny.label || "");
          const id = String(p.th_id ?? pAny.val);
          for (const y of years) {
            if (label.includes(y)) {
              // Prefer annual period (label is just the year) over semester (Maret/September)
              const isAnnual = label.trim() === y;
              const existingIsAnnual = yearToPeriod[y] ? !yearToPeriod[y + "_sem"] : false;
              if (!yearToPeriod[y] || (isAnnual && !existingIsAnnual)) {
                yearToPeriod[y] = id;
                if (!isAnnual) yearToPeriod[y + "_sem"] = "1"; // marker
              }
            }
          }
        }
        // Clean up semester markers
        for (const k of Object.keys(yearToPeriod)) {
          if (k.endsWith("_sem")) delete yearToPeriod[k];
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
        const responsePeriodIds: string[] = [];
        if (result.tahun) {
          for (const t of result.tahun) {
            const tAny = t as unknown as Record<string, unknown>;
            const id = String(t.th_id ?? tAny.val);
            const label = String(t.th_name ?? tAny.label ?? id);
            periodLabels[id] = label;
            responsePeriodIds.push(id);
          }
        }

        // Find the aggregate vervar (national = 9999, provincial = domain pattern or bold/last entry)
        let aggregateVervar: string | null = null;
        if (result.vervar) {
          for (const v of result.vervar) {
            const vAny = v as unknown as Record<string, unknown>;
            const vLabel = String(v.label_vervar ?? vAny.label ?? "");
            const vId = String(v.kode_vervar ?? vAny.val);
            if (vId === "9999" || vLabel.toLowerCase().includes("indonesia")) {
              aggregateVervar = vId; break;
            }
          }
          // For provincial domains: look for domain-based patterns
          if (!aggregateVervar && domain !== "0000") {
            for (const v of result.vervar) {
              const vAny = v as unknown as Record<string, unknown>;
              const vLabel = String(v.label_vervar ?? vAny.label ?? "");
              const vId = String(v.kode_vervar ?? vAny.val);
              // Pattern: domain prefix + "99" (e.g., 3599 for domain 3500)
              if (vId === domain.slice(0, 2) + "99" || vId === domain.slice(0, 4) + "0") {
                aggregateVervar = vId; break;
              }
              if (vLabel.startsWith("<b>") || vLabel.toLowerCase().includes("provinsi") || vLabel.toLowerCase().includes("jawa timur") || vLabel === domainName) {
                aggregateVervar = vId; break;
              }
            }
            // Last resort: if vervar has a "Jumlah" or last entry is typically aggregate
            if (!aggregateVervar) {
              for (const v of result.vervar) {
                const vAny = v as unknown as Record<string, unknown>;
                const vLabel = String(v.label_vervar ?? vAny.label ?? "").toLowerCase();
                if (vLabel === "jumlah" || vLabel === "total") {
                  aggregateVervar = String(v.kode_vervar ?? vAny.val); break;
                }
              }
            }
          }
          // For national domain: try bold labels
          if (!aggregateVervar && domain === "0000") {
            for (const v of result.vervar) {
              const vAny = v as unknown as Record<string, unknown>;
              const vLabel = String(v.label_vervar ?? vAny.label ?? "");
              if (vLabel.startsWith("<b>")) {
                aggregateVervar = String(v.kode_vervar ?? vAny.val); break;
              }
            }
          }
        }

        // Extract values using proper key matching
        // Sort period IDs longest-first to avoid substring collisions
        const sortedPeriodIds = responsePeriodIds.sort((a, b) => b.length - a.length);
        const trendData: Array<{ year: string; value: number }> = [];

        for (const [key, value] of Object.entries(result.datacontent)) {
          if (typeof value !== "number") continue;
          // If we have an aggregate vervar, only match keys containing it
          if (aggregateVervar && !key.includes(aggregateVervar)) continue;
          // Find which period this key belongs to (longest match first)
          for (const pid of sortedPeriodIds) {
            if (key.includes(pid)) {
              const label = periodLabels[pid] || pid;
              // Only keep periods in our requested year range
              const yearNum = parseInt(label);
              if (yearNum >= parseInt(start_year) && yearNum <= parseInt(end_year)) {
                if (!trendData.some(d => d.year === label)) {
                  trendData.push({ year: label, value });
                }
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
        const unit = varData.unit && !varData.unit.toLowerCase().includes("tidak ada") ? ` (${varData.unit})` : "";
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

        // Build vervar (province) label map — prefer provincial level only
        const vervarLabels: Record<string, string> = {};
        const allVervarLabels: Record<string, string> = {};
        if (result.vervar) {
          for (const v of result.vervar) {
            const vAny = v as unknown as Record<string, unknown>;
            const id = String(v.kode_vervar ?? vAny.val);
            const label = String(v.label_vervar ?? vAny.label ?? id);
            allVervarLabels[id] = label;
            // Provincial entries have bold labels or are 4-digit codes ending in 00
            if (label.startsWith("<b>") && !label.toLowerCase().includes("indonesia")) {
              vervarLabels[id] = label.replace(/<\/?b>/g, "");
            }
          }
        }
        // If no bold entries found, use all (the variable is already at province level)
        const useLabels = Object.keys(vervarLabels).length >= 10 ? vervarLabels : allVervarLabels;

        // Extract province-level data
        const rankings: Array<{ province: string; value: number }> = [];
        // Sort vervar IDs longest-first to avoid substring collisions
        const vervarIds = Object.keys(useLabels).sort((a, b) => b.length - a.length);
        for (const [key, value] of Object.entries(result.datacontent)) {
          if (typeof value !== "number") continue;
          for (const vId of vervarIds) {
            if (key.includes(vId) && !rankings.some(r => r.province === useLabels[vId])) {
              const label = useLabels[vId].replace(/<\/?b>/g, "");
              rankings.push({ province: label, value });
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
        const unit = varData.unit && !varData.unit.toLowerCase().includes("tidak ada") ? ` (${varData.unit})` : "";
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

  // Expand search terms with synonyms
  const SEARCH_SYNONYMS: Record<string, string[]> = {
    ipm: ["ipm", "pembangunan manusia", "indeks pembangunan"],
    tpt: ["tpt", "pengangguran terbuka"],
    gini: ["gini", "gini rasio"],
  };
  const searchTerms: string[] = SEARCH_SYNONYMS[kw] || [kw];

  for (const subId of subjectIds.slice(0, 3)) {
    const result = await client.listVariables(domain, subId, undefined, 1, 100);
    if (!result.data) continue;
    const candidates: Array<{ var_id: number; title: string; sub_name: string; unit?: string }> = [];
    for (const v of result.data) {
      const titleLower = v.title.toLowerCase();
      const matches = searchTerms.some(term => titleLower.includes(term)) ||
        kw.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w));
      if (matches) {
        candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit });
      }
    }
    if (candidates.length > 0) {
      // Score candidates: prefer non-lama, prefer kabupaten/provinsi, deprioritize disaggregated
      candidates.sort((a, b) => {
        const t = (x: typeof a) => x.title.toLowerCase();
        const score = (x: typeof a) => {
          let s = 0;
          if (t(x).includes("metode lama")) s += 10;
          if (t(x).includes("metode baru")) s -= 2;
          // Prefer variables with kabupaten/kota or provinsi (have aggregate)
          if (t(x).includes("kabupaten") || t(x).includes("provinsi")) s -= 3;
          // Deprioritize disaggregated variants
          if (t(x).includes("golongan umur") || t(x).includes("lapangan usaha") || t(x).includes("klasifikasi") || t(x).includes("pendidikan tertinggi")) s += 5;
          return s;
        };
        return score(a) - score(b);
      });
      const found = candidates[0];
      await learnVar(query, domain, found, store);
      return found;
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
  let varData = await resolveVariable(client, store, query, domain);
  if (!varData) {
    // Fallback: try strategic indicators (inflasi, PDRB, etc.)
    const indicators = await client.listStrategicIndicators(domain);
    if (indicators.data) {
      const kw2 = normalizeKeyword(query);
      for (const ind of indicators.data) {
        const t = ind.title.toLowerCase();
        if (t.includes(kw2) || kw2.split(/\s+/).some(w => w.length > 2 && t.includes(w))) {
          if (ind.data) {
            const entries = Object.entries(ind.data);
            const match = year ? entries.find(([k]) => k.includes(year)) : entries[entries.length - 1];
            if (match) {
              const val = typeof match[1] === "number" ? match[1].toLocaleString("id-ID") : String(match[1]);
              return { value: val, varTitle: ind.title };
            }
          }
        }
      }
    }
    return { value: "N/A", varTitle: "" };
  }

  // Resolve period
  let periodParam: string | undefined;
  let periods = await client.listPeriods(domain, varData.var_id);

  // Fallback: if no periods, invalidate and do full search
  if (periods.length === 0) {
    await invalidateVar(query, domain, store);
    varData = await resolveVariableFullSearch(client, store, query, domain);
    if (!varData) return { value: "N/A", varTitle: "" };
    periods = await client.listPeriods(domain, varData.var_id);
  }

  if (year && periods.length > 0) {
    for (const p of periods) {
      const pAny = p as unknown as Record<string, unknown>;
      const label = String(pAny.th_name || pAny.th || pAny.label || "");
      if (label.includes(year)) {
        periodParam = String(p.th_id ?? pAny.val);
        break;
      }
    }
    // If requested year not found, try full search for a variable that has it
    if (!periodParam) {
      await invalidateVar(query, domain, store);
      varData = await resolveVariableFullSearch(client, store, query, domain);
      if (!varData) return { value: "N/A", varTitle: "" };
      periods = await client.listPeriods(domain, varData.var_id);
      for (const p of periods) {
        const pAny = p as unknown as Record<string, unknown>;
        const label = String(pAny.th_name || pAny.th || pAny.label || "");
        if (label.includes(year)) {
          periodParam = String(p.th_id ?? pAny.val);
          break;
        }
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

  // Find the aggregate vervar for this domain
  let aggregateVervar: string | null = null;
  if (result.vervar) {
    for (const v of result.vervar) {
      const vAny = v as unknown as Record<string, unknown>;
      const vId = String(v.kode_vervar ?? vAny.val);
      const vLabel = String(v.label_vervar ?? vAny.label ?? "");
      // National: 9999 = INDONESIA
      if (vId === "9999" || vLabel.toLowerCase().includes("indonesia")) {
        aggregateVervar = vId; break;
      }
      // Provincial: domain + "99" pattern (e.g., 3699 for domain 3600)
      if (domain !== "0000" && (vId === domain.slice(0, 2) + "99" || vId === domain.slice(0, 4) + "0" || vLabel.startsWith("<b>") || vLabel.toLowerCase().includes("provinsi"))) {
        aggregateVervar = vId; break;
      }
    }
  }

  // Extract the aggregate value
  let val: number | null = null;
  if (aggregateVervar) {
    for (const [key, value] of Object.entries(result.datacontent)) {
      if (typeof value === "number" && key.includes(aggregateVervar)) {
        val = value; break;
      }
    }
  }
  // Fallback: first numeric value
  if (val === null) {
    const values = Object.values(result.datacontent).filter(v => typeof v === "number") as number[];
    if (values.length === 0) return { value: "N/A", varTitle: varData.title };
    val = values[0];
  }

  const unit = varData.unit && !varData.unit.toLowerCase().includes("tidak ada") ? ` ${varData.unit}` : "";
  return { value: `${val.toLocaleString("id-ID")}${unit}`, varTitle: varData.title };
}

/** Resolve variable bypassing KNOWN_VARS/store — full API search only. */
async function resolveVariableFullSearch(
  client: BpsClient,
  store: IPersistentStore | null,
  query: string,
  domain: string
): Promise<{ var_id: number; title: string; sub_name: string; unit?: string } | null> {
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

  const subjects = await client.listSubjects(domain);
  for (const s of subjects.data) {
    if (kw.split(/\s+/).some(w => w.length > 2 && s.title.toLowerCase().includes(w))) {
      if (!subjectIds.includes(s.sub_id)) subjectIds.push(s.sub_id);
    }
  }

  for (const subId of subjectIds.slice(0, 3)) {
    const result = await client.listVariables(domain, subId, undefined, 1, 100);
    if (!result.data) continue;
    const candidates: Array<{ var_id: number; title: string; sub_name: string; unit?: string }> = [];
    const SEARCH_SYNONYMS: Record<string, string[]> = {
      ipm: ["ipm", "pembangunan manusia", "indeks pembangunan"],
      tpt: ["tpt", "pengangguran terbuka"],
      gini: ["gini", "gini rasio"],
    };
    const searchTerms: string[] = SEARCH_SYNONYMS[kw] || [kw];
    for (const v of result.data) {
      const titleLower = v.title.toLowerCase();
      const matches = searchTerms.some(term => titleLower.includes(term)) ||
        kw.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w));
      if (matches && !titleLower.includes("metode lama")) {
        candidates.push({ var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit });
      }
    }
    // Pick the first candidate that has periods
    for (const c of candidates) {
      const periods = await client.listPeriods(domain, c.var_id);
      if (periods.length === 0) continue;
      await learnVar(query, domain, c, store);
      return c;
    }
  }

  return null;
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
    if (w.startsWith("ke") && w.endsWith("an") && w.length > 6) roots.push(w.slice(2, -2));
    if (w.startsWith("pe") && w.endsWith("an") && w.length > 6) roots.push(w.slice(2, -2));
    if (w.endsWith("an") && w.length > 5) roots.push(w.slice(0, -2));
  }
  // Add synonym expansions
  const RANKING_SYNONYMS: Record<string, string[]> = {
    ipm: ["ipm", "pembangunan manusia", "indeks pembangunan"],
    tpt: ["tpt", "pengangguran terbuka", "tingkat pengangguran"],
    gini: ["gini", "gini rasio", "ketimpangan"],
    pdrb: ["pdrb", "produk domestik", "pertumbuhan ekonomi"],
    "harapan hidup": ["harapan hidup", "angka harapan hidup", "umur harapan"],
    pendidikan: ["rata-rata lama sekolah", "harapan lama sekolah", "melek huruf"],
    penduduk: ["jumlah penduduk", "populasi"],
  };
  const synonyms: string[] = RANKING_SYNONYMS[kw] || [];
  // Also check if any synonym key is contained in the query
  for (const [key, syns] of Object.entries(RANKING_SYNONYMS)) {
    if (kw.includes(key) && !synonyms.length) { synonyms.push(...syns); break; }
  }
  const matchesTitle = (t: string) =>
    roots.some(r => t.includes(r)) || synonyms.some(s => t.includes(s));

  const KEYWORD_SUBJECTS: Record<string, number[]> = {
    miskin: [23], kemiskinan: [23], gini: [23],
    pengangguran: [6], tpt: [6],
    penduduk: [12], ipm: [26],
    pdrb: [52], ekonomi: [52], pertumbuhan: [52],
    harapan: [26, 30], pendidikan: [26, 28],
    sekolah: [26, 28],
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

    // First pass: find one with "Provinsi" AND matching keyword AND recent data
    for (const v of result.data) {
      const t = v.title.toLowerCase();
      if (t.includes("provinsi") && matchesTitle(t) && !t.includes("metode lama")) {
        if (t.includes("persentase") || t.includes("tingkat") || t.includes("indeks")) {
          // Validate has recent data (at least 2020+)
          const periods = await client.listPeriods("0000", v.var_id);
          const hasRecent = periods.some(p => {
            const pAny = p as unknown as Record<string, unknown>;
            const label = String(pAny.th_name || pAny.th || pAny.label || "");
            return parseInt(label) >= 2020;
          });
          if (hasRecent) return { var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit };
        }
      }
    }

    // Second pass: "Provinsi" + keyword match (any) with recent data
    for (const v of result.data) {
      const t = v.title.toLowerCase();
      if (t.includes("provinsi") && matchesTitle(t) && !t.includes("metode lama")) {
        const periods = await client.listPeriods("0000", v.var_id);
        const hasRecent = periods.some(p => {
          const pAny = p as unknown as Record<string, unknown>;
          const label = String(pAny.th_name || pAny.th || pAny.label || "");
          return parseInt(label) >= 2020;
        });
        if (hasRecent) return { var_id: v.var_id, title: v.title, sub_name: v.sub_name, unit: v.unit };
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
