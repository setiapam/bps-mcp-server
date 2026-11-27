import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { Config } from "../config/index.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { formatDynamicData } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatUnit } from "../client/fields.js";
import { findDataService, findVariableService } from "../services/smart-service.js";

/**
 * AI-friendly shortcut tools that reduce multi-step workflows to single calls.
 */
export function registerSmartTools(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver,
  config: Config,
  store: IPersistentStore | null
): void {
  // ---------- find_variable ----------
  server.tool(
    "find_variable",
    `Cari variabel data BPS berdasarkan kata kunci. Mencari di semua subjek yang relevan.

Bukan untuk ranking: bila user minta "10 kabupaten/kota ... tertinggi", panggil
\`get_ranking(level="kabkota")\` — tool itu sudah tahu var_id tiap provinsi.

Contoh penggunaan:
- find_variable(keyword="penduduk") → variabel terkait jumlah penduduk
- find_variable(keyword="kemiskinan", domain="3500") → variabel kemiskinan di Jawa Timur
- find_variable(keyword="inflasi") → variabel inflasi nasional

Setelah mendapat var_id dari tool ini, gunakan get_dynamic_data untuk mengambil datanya.`,
    {
      keyword: z.string().optional().describe("Kata kunci pencarian variabel (misal: penduduk, kemiskinan, inflasi, pengangguran, PDRB)"),
      keywords: z.string().optional().describe("Alias untuk 'keyword'."),
      query: z.string().optional().describe("Alias untuk 'keyword'."),
      domain: z.string().default("0000").describe("Kode domain BPS. '0000'=nasional. Gunakan resolve_domain jika perlu."),
      subject: z.number().optional().describe("Filter berdasarkan ID subjek (opsional, gunakan list_subjects untuk melihat daftar)"),
    },
    async ({ keyword: keywordInput, keywords, query, domain, subject }) => {
      const keyword = keywordInput ?? keywords ?? query;
      if (!keyword || !keyword.trim()) {
        return {
          content: [{
            type: "text",
            text: "Parameter 'keyword' wajib diisi, misal find_variable(keyword=\"penduduk miskin\", domain=\"3500\").",
          }],
          isError: true,
        };
      }
      try {
        const result = await findVariableService(client, { keyword, domain, subject });
        const allVars = result.variables;

        if (allVars.length === 0) {
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Tidak ditemukan variabel yang cocok dengan "${keyword}" di domain ${domain}.\n\n` +
                `**Tips:** Coba kata kunci yang lebih umum, atau gunakan list_subjects untuk melihat subjek yang tersedia, lalu filter dengan parameter subject.`
              ),
            }],
          };
        }

        const lines: string[] = [
          `## Variabel yang cocok dengan "${keyword}"`,
          `**Domain:** ${domain} | **Ditemukan:** ${allVars.length} variabel`,
          "",
        ];

        for (const v of allVars.slice(0, 15)) {
          const unit = formatUnit(v.unit);
          lines.push(`- **${v.title}** (var_id: \`${v.var_id}\`) — Subjek: ${v.sub_name}${unit ? ` — Satuan: ${unit}` : ""}`);
          if (v.def) lines.push(`  _${v.def.replace(/\s+/g, " ").substring(0, 200)}_`);
        }

        lines.push("");
        lines.push("**Langkah selanjutnya:** Gunakan `get_dynamic_data(domain=\"" + domain + "\", var=\"<var_id>\")` untuk mengambil data.");

        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Gagal mencari variabel";
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );

  // ---------- find_data ----------
  server.tool(
    "find_data",
    `Tool utama untuk AI: cari dan ambil data BPS dalam satu langkah.
Secara otomatis: detect intent → resolve wilayah → cari variabel → ambil data.

⚠️ JANGAN pakai tool ini untuk PERINGKAT/top-N wilayah ("10 kabupaten/kota
tertinggi", "5 provinsi termiskin", "daerah dengan ... terbesar"). Panggil
\`get_ranking\` langsung — untuk kabupaten/kota pakai level="kabkota". Menyapu
sendiri daftar provinsi + variabel akan memakan 100+ panggilan dan tetap
kehilangan sebagian wilayah. find_data hanya untuk SATU wilayah.

## Intent Detection (otomatis):
- **Single value** (angka spesifik) → find_data
- **Comparison** ("bandingkan X dan Y") → delegate ke compare_data
- **Trend** ("tren 2019-2024") → delegate ke get_trend
- **Ranking** ("10 provinsi termiskin") → delegate ke get_ranking
- **Table/Breakdown** ("pemeluk agama per kecamatan") → find_data + static table fallback
- **Publication** ("cari publikasi") → delegate ke search

## Quick Reference — Topik Umum

| Topik | Metode Tercepat | var_id (nasional) |
|-------|----------------|-------------------|
| Kemiskinan (jumlah) | find_data atau get_dynamic_data | 183, 185 |
| Kemiskinan (%) | find_data atau get_dynamic_data | 184, 192 |
| Pengangguran (TPT %) | get_dynamic_data(var="543") | 543 |
| Inflasi (YoY) | list_strategic_indicators atau get_dynamic_data | 2263 |
| Pertumbuhan ekonomi | list_strategic_indicators | - |
| IPM | list_strategic_indicators atau get_dynamic_data | 413 |
| Gini Rasio | get_dynamic_data(var="98") | 98 |
| Jumlah Penduduk | get_dynamic_data(var="2781") | 2781 |
| PDRB | list_strategic_indicators(domain=kode_prov) | - |
| Ekspor/Impor | list_strategic_indicators atau get_trade_data | - |
| Agama/Religi | find_data atau list_static_tables | - |
| Publikasi/BRS | search atau allstats_search | - |
| Teks dalam PDF | allstats_deep_search | - |

## Strategi:
1. Data angka terbaru (headline) → list_strategic_indicators
2. Data angka historis/spesifik → find_data atau get_dynamic_data + var_id di atas
3. Cari publikasi/tabel/BRS → search atau allstats_search
4. Cari teks di dalam PDF → allstats_deep_search

Contoh:
- find_data(query="penduduk miskin", region="Indonesia", year="2023")
- find_data(query="pengangguran", region="Jawa Timur", year="2023")
- find_data(query="PDRB", region="Bali", year="2023")
- find_data(query="pemeluk agama", region="Kabupaten Jombang")`,
    {
      query: z.string().describe("Deskripsi data yang dicari (misal: jumlah penduduk, angka kemiskinan, inflasi, PDRB, pengangguran, pemeluk agama)"),
      region: z.string().default("Indonesia").describe("Nama wilayah (misal: Indonesia, Jawa Timur, Surabaya, DKI Jakarta). Mendukung nama resmi dan singkatan."),
      year: z.string().optional().describe("Tahun data (misal: '2023' atau '2020,2021,2022,2023' untuk multi-tahun). Kosongkan untuk data terbaru."),
    },
    async ({ query, region, year }) => {
      try {
        const outcome = await findDataService(client, resolver, store, {
          query,
          region,
          year,
          bypassRedirect: false,
        });

        if (outcome.source === "redirect" && outcome.detectedIntent) {
          const intent = outcome.detectedIntent;
          let redirectionText = "";
          if (intent.intent === "comparison") {
            const regions = `${intent.extractedParams.region1}, ${intent.extractedParams.region2}`;
            redirectionText = `**Menyalin intensi pencarian: Perbandingan Wilayah**\n` +
              `Query Anda tampaknya merupakan perbandingan data antar wilayah. Silakan panggil tool \`compare_data\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "compare_data",\n` +
              `  "arguments": {\n` +
              `    "query": "${query}",\n` +
              `    "regions": "${regions}"\n` +
              (year ? `    ,"year": "${year}"\n` : "") +
              `  }\n` +
              `}\n` +
              `\`\`\``;
          } else if (intent.intent === "trend") {
            redirectionText = `**Menyalin intensi pencarian: Tren Multi-Tahun**\n` +
              `Query Anda tampaknya menanyakan perkembangan/tren data dari tahun ke tahun. Silakan panggil tool \`get_trend\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "get_trend",\n` +
              `  "arguments": {\n` +
              `    "query": "${query}",\n` +
              `    "region": "${region}"\n` +
              `  }\n` +
              `}\n` +
              `\`\`\``;
          } else if (intent.intent === "ranking") {
            const kabkotaLevel = /\b(kabupaten|kabkota|kab\/kota|kabupaten\/kota)\b/i.test(query);
            redirectionText = `**Menyalin intensi pencarian: Peringkat/Ranking**\n` +
              `Query Anda tampaknya meminta peringkat data wilayah. Silakan panggil tool \`get_ranking\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "get_ranking",\n` +
              `  "arguments": {\n` +
              `    "query": "${query}",\n` +
              `    "top_n": 10,\n` +
              `    "order": "highest",\n    "level": "${kabkotaLevel ? "kabkota" : "provinsi"}"` +
              `\n  }\n` +
              `}\n` +
              `\`\`\``;
          } else if (intent.intent === "publication") {
            redirectionText = `**Menyalin intensi pencarian: Publikasi/Dokumen**\n` +
              `Query Anda tampaknya mencari publikasi atau dokumen statistik. Silakan panggil tool \`search\` atau \`allstats_search\` untuk hasil terbaik.\n\n` +
              `**Rekomendasi pemanggilan tool:**\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "name": "search",\n` +
              `  "arguments": {\n` +
              `    "keyword": "${query}",\n` +
              `    "type": "publication"\n` +
              `  }\n` +
              `}\n` +
              `\`\`\``;
          }

          if (redirectionText) {
            return {
              content: [{
                type: "text",
                text: appendAttribution(
                  redirectionText +
                    `\n\n_Catatan: Penggunaan tool spesifik di atas jauh lebih efisien dan akurat daripada find_data untuk query jenis ini._`
                ),
              }],
            };
          }
        }

        if (outcome.source === "domain_not_found") {
          return {
            content: [{
              type: "text",
              text: appendAttribution(
                `Wilayah "${region}" tidak ditemukan. Gunakan resolve_domain untuk mencari kode wilayah yang benar.`
              ),
            }],
            isError: true,
          };
        }

        if (outcome.source === "strategic_indicator" && outcome.indicator) {
          const indicator = outcome.indicator;
          const val = typeof indicator.value === "number"
            ? indicator.value.toLocaleString("id-ID")
            : String(indicator.value);
          const unit = formatUnit(indicator.unit);
          const lines = [
            `## ${indicator.title}`,
            `**Wilayah:** ${outcome.domainName} (${outcome.domain})`,
            "",
            `| Periode | Nilai |`,
            `| --- | --- |`,
            `| ${indicator.periode} | ${val}${unit ? ` ${unit}` : ""} |`,
          ];
          if (indicator.name) {
            lines.push("", `_${indicator.name}_`);
          }
          if (outcome.headlineNote) {
            lines.push("", "_Data headline terbaru. Untuk data historis, gunakan `get_trend` atau `find_data` dengan parameter `year`._");
          }
          return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
        }

        if (outcome.source === "static_table" && outcome.staticTable) {
          const st = outcome.staticTable;
          const lines = [
            `**Pencarian:** "${query}" di ${outcome.domainName}`,
            `**Sumber:** Tabel Statis — ${st.title}`,
          ];
          if (st.domain !== outcome.domain) {
            lines.push(`_Tabel berasal dari domain provinsi induk (${st.domain})._`);
          }
          lines.push("", st.markdownTable);
          lines.push(
            "",
            `**Detail/Excel:** get_static_table(domain="${st.domain}", id=${st.table_id})`
          );
          return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
        }

        if (outcome.source === "parent_dynamic_data" && outcome.rawResponse && outcome.parentDomain) {
          const parentFormatted = formatDynamicData(outcome.rawResponse, outcome.parentDomain, config.defaultLang, {
            includeAttribution: false,
          });
          const parentHeader = `**Pencarian:** "${query}" di ${outcome.domainName}${year ? ` (${year})` : ""}\n**Variabel:** ${outcome.varTitle} (ID: ${outcome.varId})\n_Data diambil dari domain provinsi induk (${outcome.parentDomain})_\n\n`;
          return { content: [{ type: "text", text: appendAttribution(parentHeader + parentFormatted) }] };
        }

        if (outcome.source === "dynamic_data" && outcome.rawResponse) {
          const filteredNote = outcome.filteredAggregate
            ? "\n_Menampilkan agregat wilayah. Gunakan get_dynamic_data untuk rincian lengkap._\n"
            : "";
          const formatted = formatDynamicData(outcome.rawResponse, outcome.domain, config.defaultLang, {
            includeAttribution: false,
          });
          const missingYears = outcome.missingYears ?? [];
          const matchedYears = outcome.matchedYears ?? [];
          const missingNote =
            missingYears.length > 0 && matchedYears.length > 0
              ? `\n_Catatan: tahun ${missingYears.join(", ")} tidak tersedia untuk variabel ini; data yang ditampilkan hanya tahun ${matchedYears.join(", ")}._\n`
              : "";
          const header = `**Pencarian:** "${query}" di ${outcome.domainName}${year ? ` (${year})` : ""}\n**Variabel:** ${outcome.varTitle} (ID: ${outcome.varId})\n${filteredNote}${missingNote}\n`;

          const hints = outcome.hints ?? [];
          const hintsText = hints.length > 0 ? "\n\n**💡 Tips Lanjutan:**\n" + hints.join("\n") : "";
          return { content: [{ type: "text", text: appendAttribution(header + formatted + hintsText) }] };
        }

        // source === "not_found"
        if (outcome.varTitle) {
          const altLines = [
            `Data untuk variabel "${outcome.varTitle}" tidak tersedia${year ? ` untuk tahun ${year}` : ""} di ${outcome.domainName}.`,
            "",
          ];
          const alternatives = outcome.alternatives ?? [];
          if (alternatives.length > 0) {
            altLines.push("**Variabel alternatif yang ditemukan:**");
            for (const c of alternatives.slice(0, 5)) {
              const unit = formatUnit(c.unit);
              altLines.push(`- ${c.title} (var_id: \`${c.var_id}\`)${unit ? ` — ${unit}` : ""}`);
            }
            altLines.push("");
            altLines.push("Gunakan `get_dynamic_data` dengan var_id di atas untuk mencoba variabel lain.");
          }
          return { content: [{ type: "text", text: appendAttribution(altLines.join("\n")) }] };
        }

        const allStatsQuery = `${query} ${outcome.domainName}`.trim();
        return {
          content: [{
            type: "text",
            text: appendAttribution(
              `Tidak ditemukan data "${query}" untuk ${outcome.domainName}.\n\n` +
              `**Saran:**\n` +
              `1. Gunakan \`find_variable(keyword="${query}", domain="${outcome.domain}")\` untuk mencari variabel yang lebih spesifik\n` +
              `2. Gunakan \`search(keyword="${query}")\` untuk pencarian lebih luas\n` +
              `3. Gunakan \`list_strategic_indicators(domain="${outcome.domain}")\` untuk indikator utama\n` +
              `4. Gunakan \`allstats_search(query="${allStatsQuery}", content="table")\` untuk mencari tabel di AllStats\n` +
              `5. Gunakan \`allstats_deep_search(query="${allStatsQuery}")\` untuk mencari teks di dalam PDF publikasi\n\n` +
              `**Catatan:** Beberapa data (seperti agama) hanya tersedia di website BPS daerah, tidak di WebAPI.`
            ),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Gagal mengambil data";
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );
}
