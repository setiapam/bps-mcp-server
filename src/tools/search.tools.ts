import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient, AllStatsSearchResponse } from "../client/allstats-client.js";
import { appendAttribution } from "../services/attribution.js";
import { inferContentTypeFromUrl } from "../services/search-query.js";
import { searchService, type WebApiSearchType } from "../services/search-service.js";
import { formatErrorForUser, BpsNotFoundError } from "../utils/error.js";
import { stripHtml } from "../utils/html.js";
import { formatUnit } from "../client/fields.js";
import type {
  BpsPressRelease,
  BpsPublication,
  BpsStaticTable,
  BpsStrategicIndicator,
} from "../client/types.js";

const TYPE_LABEL: Record<WebApiSearchType, string> = {
  statictable: "Tabel Statis",
  publication: "Publikasi",
  pressrelease: "Berita Resmi Statistik (BRS)",
  strategicindicator: "Indikator Strategis",
};

/** Follow-up tool for each result type, so callers do not have to guess. */
const TYPE_FOLLOW_UP: Record<WebApiSearchType, string> = {
  statictable: "get_static_table(domain, id=<ID>)",
  publication: "get_publication(domain, id=<ID>)",
  pressrelease: "get_press_release(domain, id=<ID>)",
  strategicindicator: "get_dynamic_data atau list_strategic_indicators(domain)",
};

function truncate(text: string | null | undefined, max = 220): string {
  if (!text) return "";
  const clean = stripHtml(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Format WebAPI search results without dumping huge JSON/base64 URLs. */
function formatWebApiResults(
  data: unknown[],
  type: WebApiSearchType,
  maxItems: number
): string[] {
  const lines: string[] = [];

  for (let index = 0; index < Math.min(data.length, maxItems); index++) {
    const item = data[index] as Record<string, unknown>;
    const number = index + 1;

    if (type === "statictable") {
      const table = item as unknown as BpsStaticTable;
      lines.push(`${number}. **${stripHtml(table.title)}**`);
      lines.push(`   - ID: \`${table.table_id}\` | Subjek: ${table.subj ?? "-"}${table.updt_date ? ` | Update: ${table.updt_date}` : ""}`);
      continue;
    }

    if (type === "pressrelease") {
      const release = item as unknown as BpsPressRelease;
      lines.push(`${number}. **${stripHtml(release.title)}**`);
      lines.push(`   - ID: \`${release.brs_id}\` | Tanggal: ${release.rl_date}`);
      const abstract = truncate(release.abstract);
      if (abstract) lines.push(`   - ${abstract}`);
      continue;
    }

    if (type === "publication") {
      const publication = item as unknown as BpsPublication;
      lines.push(`${number}. **${stripHtml(publication.title)}**`);
      lines.push(`   - ID: \`${publication.pub_id}\` | Rilis: ${publication.rl_date}${publication.issn ? ` | ISSN: ${publication.issn}` : ""}`);
      const abstract = truncate(publication.abstract);
      if (abstract) lines.push(`   - ${abstract}`);
      continue;
    }

    const indicator = item as unknown as BpsStrategicIndicator;
    const unit = formatUnit(indicator.unit);
    lines.push(`${number}. **${stripHtml(indicator.title)}**`);
    lines.push(`   - ${indicator.value}${unit ? ` ${unit}` : ""} (${indicator.periode})`);
  }

  if (data.length > maxItems) {
    lines.push(`_Menampilkan ${maxItems} dari ${data.length} hasil pada halaman ini._`);
  }
  return lines;
}

function formatAllStatsFallback(res: AllStatsSearchResponse): string {
  const lines: string[] = [];
  lines.push(`### Hasil dari AllStats Search (fallback)`);
  lines.push(
    `Ditemukan **${res.totalResults.toLocaleString("id-ID")}** hasil via AllStats Search Engine`
  );
  lines.push("");

  for (let i = 0; i < res.results.length; i++) {
    const r = res.results[i];
    lines.push(`**${i + 1}. ${r.title}**`);
    if (r.description) lines.push(`> ${r.description}`);
    lines.push(`- Tipe: ${inferContentTypeFromUrl(r.url, r.contentType)} | Sumber: ${r.domain}`);
    if (r.url) lines.push(`- URL: ${r.url}`);
    if (r.deepSearchId) {
      lines.push(
        `- Deep Search ID: \`${r.deepSearchId}\` _(gunakan allstats_deep_search untuk cari di dalam publikasi)_`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerSearchTools(
  server: McpServer,
  client: BpsClient,
  allStatsClient?: AllStatsClient
): void {
  server.tool(
    "search",
    `Pencarian data lintas tipe di BPS (tabel statis, publikasi, BRS, indikator) dalam SATU panggilan.

Secara default (\`type="all"\`) server mencari tabel statis + publikasi + BRS sekaligus
dan mengelompokkan hasilnya, jadi tidak perlu memanggil tool ini beberapa kali dengan
\`type\` berbeda.

Kapan menggunakan tool ini:
- Mencari tabel statis, publikasi, atau BRS berdasarkan topik
- Mencari dokumen yang memuat suatu istilah
- Pencarian umum ketika find_data tidak menemukan hasil

Kapan TIDAK menggunakan tool ini:
- Jika user minta data angka spesifik → gunakan find_data
- Jika sudah tahu variabel ID → gunakan get_dynamic_data
- Jika butuh teks di dalam PDF → allstats_deep_search

Jika WebAPI tidak menemukan hasil, otomatis fallback ke AllStats Search Engine
(dengan penyederhanaan kata kunci otomatis, mis. "kemiskinan" → "miskin").`,
    {
      domain: z.string().default("0000").describe("Kode domain BPS"),
      keyword: z.string().optional().describe("Kata kunci pencarian"),
      keywords: z.string().optional().describe("Alias untuk 'keyword'."),
      query: z.string().optional().describe("Alias untuk 'keyword'."),
      type: z
        .enum(["all", "statictable", "publication", "pressrelease", "strategicindicator"])
        .default("all")
        .describe(
          "Filter tipe: 'all' (default, tabel+publikasi+BRS sekaligus), 'statictable', 'publication', 'pressrelease', 'strategicindicator'"
        ),
      page: z.number().int().min(1).default(1).describe("Nomor halaman (berlaku untuk tiap tipe)"),
    },
    async ({ domain, keyword: keywordInput, keywords, query, type, page }) => {
      const keyword = keywordInput ?? keywords ?? query;
      const searchType = type ?? "all";
      const searchPage = page ?? 1;
      if (!keyword || !keyword.trim()) {
        return {
          content: [{
            type: "text",
            text: "Parameter 'keyword' wajib diisi, misal search(keyword=\"kemiskinan\").",
          }],
          isError: true,
        };
      }

      const outcome = await searchService(client, allStatsClient, {
        domain,
        keyword,
        type: searchType,
        page: searchPage,
      });

      if (outcome.source === "webapi" && outcome.orderedGroups) {
        const groups = outcome.orderedGroups;
        const maxItems = searchType === "all" ? 5 : 10;
        const total = outcome.total ?? groups.reduce((sum, group) => sum + group.data.length, 0);
        const lines: string[] = [
          `## Hasil Pencarian: "${keyword}"`,
          `**Ditemukan:** ${total} hasil${groups.length > 1 ? ` dari ${groups.length} tipe konten` : ""}`,
          "",
        ];

        for (const group of groups) {
          lines.push(`### ${TYPE_LABEL[group.type]} (${group.data.length})`);
          lines.push(...formatWebApiResults(group.data, group.type, maxItems));
          lines.push("");
        }

        lines.push(
          `_Langkah berikutnya: ${groups.map((group) => `${TYPE_LABEL[group.type]} → ${TYPE_FOLLOW_UP[group.type]}`).join("; ")}._`
        );

        if (outcome.page) {
          lines.push(
            `_Halaman ${outcome.page.page} dari ${outcome.page.pages} (total: ${outcome.page.total}). Gunakan parameter \`page\` untuk halaman berikutnya._`
          );
        }
        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      }

      if (outcome.source === "allstats" && outcome.allStatsResult) {
        const parts: string[] = [];
        parts.push(`## Hasil Pencarian: "${keyword}"\n`);
        if (outcome.effectiveQuery !== keyword) {
          parts.push(`> **Catatan:** WebAPI tidak menemukan hasil; AllStats dicari dengan kata kunci "${outcome.effectiveQuery}".\n`);
        }

        if (outcome.webapiError) {
          parts.push(
            `> **Catatan:** WebAPI BPS tidak tersedia (${outcome.webapiError instanceof Error ? outcome.webapiError.message : "error"}). Menampilkan hasil dari AllStats Search.\n`
          );
        } else {
          parts.push(
            `> **Catatan:** WebAPI BPS tidak menemukan hasil untuk "${keyword}". Menampilkan hasil dari AllStats Search.\n`
          );
        }

        parts.push(formatAllStatsFallback(outcome.allStatsResult));
        return { content: [{ type: "text", text: appendAttribution(parts.join("\n")) }] };
      }

      if (outcome.webapiError) {
        if (outcome.webapiError instanceof BpsNotFoundError) {
          return {
            content: [{
              type: "text",
              text: `Tidak ditemukan hasil untuk "${keyword}" di WebAPI maupun AllStats Search.`,
            }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: formatErrorForUser(outcome.webapiError) }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `Tidak ditemukan hasil untuk "${keyword}".`,
        }],
        isError: true,
      };
    }
  );
}
