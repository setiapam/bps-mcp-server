import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient, AllStatsSearchResponse } from "../client/allstats-client.js";
import { MODELS } from "../client/endpoints.js";
import { appendAttribution } from "../services/attribution.js";
import { inferContentTypeFromUrl, searchQueryFallbacks } from "../services/search-query.js";
import { expandQueryTerms } from "../services/variable-search.js";
import { formatErrorForUser } from "../utils/error.js";
import { BpsNotFoundError } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import { stripHtml } from "../utils/html.js";
import { formatUnit } from "../client/fields.js";
import type {
  BpsPressRelease,
  BpsPublication,
  BpsStaticTable,
  BpsStrategicIndicator,
} from "../client/types.js";

/** WebAPI content types the search endpoint accepts. */
type WebApiSearchType = "statictable" | "publication" | "pressrelease" | "strategicindicator";

const SEARCH_MODELS: Record<WebApiSearchType, string> = {
  statictable: MODELS.STATIC_TABLE,
  publication: MODELS.PUBLICATION,
  pressrelease: MODELS.PRESS_RELEASE,
  strategicindicator: MODELS.STRATEGIC_INDICATOR,
};

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

/** Types searched when the caller does not narrow it down. */
const FANOUT_TYPES: WebApiSearchType[] = ["statictable", "publication", "pressrelease"];

/** Map WebAPI type names to AllStats content types */
const WEBAPI_TO_ALLSTATS_CONTENT: Record<string, string> = {
  statictable: "table",
  pressrelease: "pressrelease",
  publication: "publication",
  strategicindicator: "table",
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

      // --- Step 1: Try WebAPI, one request per content type ---
      const types: WebApiSearchType[] = searchType === "all" ? FANOUT_TYPES : [searchType];
      let webapiError: unknown = null;

      const runSearch = async (searchKeyword: string, searchTypes: WebApiSearchType[]) => {
        const settled = await Promise.all(
          searchTypes.map(async (contentType) => {
            try {
              const res = await client.search(domain, searchKeyword, SEARCH_MODELS[contentType], searchPage);
              return { type: contentType, res };
            } catch (error) {
              webapiError = error;
              logger.debug(
                `WebAPI search ${contentType} failed for "${searchKeyword}": ${error instanceof Error ? error.message : "unknown"}`
              );
              return { type: contentType, res: null };
            }
          })
        );
        return settled.filter(
          (entry) => !!entry.res && Array.isArray(entry.res.data) && entry.res.data.length > 0
        );
      };

      let groups = await runSearch(keyword, types);

      // Fallback: multi-word keywords often fail as a phrase because BPS matches
      // titles literally. Retry with the head noun when only one type was asked
      // for; for "all" the AllStats fallback below is cheaper than six requests.
      if (groups.length === 0 && searchType !== "all") {
        for (const fallback of searchQueryFallbacks(keyword).slice(0, 1)) {
          logger.debug(`WebAPI search fallback: retrying with "${fallback}"`);
          groups = await runSearch(fallback, types);
          if (groups.length > 0) break;
        }
      }

      if (groups.length > 0) {
        // The strategic-indicator list endpoint ignores `keyword` (it always
        // returns every headline indicator), so filter it here instead of
        // presenting inflation for a poverty query.
        const terms = expandQueryTerms(keyword).filter((term) => term.length > 2);
        groups = groups.map((group) => {
          if (group.type !== "strategicindicator" || !group.res) return group;
          const relevant = group.res.data.filter((item) => {
            const title = stripHtml((item as { title?: string }).title ?? "").toLowerCase();
            return terms.some((term) => title.includes(term));
          });
          return relevant.length > 0 ? { ...group, res: { ...group.res, data: relevant } } : group;
        });

        const maxItems = searchType === "all" ? 5 : 10;
        const total = groups.reduce((sum, group) => sum + (group.res?.data.length ?? 0), 0);
        const lines: string[] = [
          `## Hasil Pencarian: "${keyword}"`,
          `**Ditemukan:** ${total} hasil${groups.length > 1 ? ` dari ${groups.length} tipe konten` : ""}`,
          "",
        ];

        for (const group of groups) {
          const data = group.res?.data ?? [];
          lines.push(`### ${TYPE_LABEL[group.type]} (${data.length})`);
          lines.push(...formatWebApiResults(data, group.type, maxItems));
          lines.push("");
        }

        lines.push(
          `_Langkah berikutnya: ${groups.map((group) => `${TYPE_LABEL[group.type]} → ${TYPE_FOLLOW_UP[group.type]}`).join("; ")}._`
        );

        const pageInfo = groups.find((group) => group.res?.page)?.res?.page;
        if (pageInfo) {
          lines.push(
            `_Halaman ${pageInfo.page} dari ${pageInfo.pages} (total: ${pageInfo.total}). Gunakan parameter \`page\` untuk halaman berikutnya._`
          );
        }
        return { content: [{ type: "text", text: appendAttribution(lines.join("\n")) }] };
      }

      // --- Step 2: Fallback to AllStats ---
      if (allStatsClient) {
        try {
          const allStatsContent =
            searchType !== "all" && WEBAPI_TO_ALLSTATS_CONTENT[searchType]
              ? WEBAPI_TO_ALLSTATS_CONTENT[searchType]
              : "all";

          let effectiveQuery = keyword;
          let allStatsResult = await allStatsClient.search({
            query: effectiveQuery,
            content: allStatsContent as "all",
            domain,
            page: searchPage,
            sort: "relevansi",
          });

          for (const fallback of searchQueryFallbacks(keyword)) {
            if (allStatsResult.results.length > 0) break;
            logger.debug(`AllStats search fallback: retrying with "${fallback}"`);
            effectiveQuery = fallback;
            allStatsResult = await allStatsClient.search({
              query: fallback,
              content: allStatsContent as "all",
              domain,
              page: searchPage,
              sort: "relevansi",
            });
          }

          if (allStatsResult.results.length > 0) {
            const parts: string[] = [];
            parts.push(`## Hasil Pencarian: "${keyword}"\n`);
            if (effectiveQuery !== keyword) {
              parts.push(`> **Catatan:** WebAPI tidak menemukan hasil; AllStats dicari dengan kata kunci "${effectiveQuery}".\n`);
            }

            if (webapiError) {
              parts.push(
                `> **Catatan:** WebAPI BPS tidak tersedia (${webapiError instanceof Error ? webapiError.message : "error"}). Menampilkan hasil dari AllStats Search.\n`
              );
            } else {
              parts.push(
                `> **Catatan:** WebAPI BPS tidak menemukan hasil untuk "${keyword}". Menampilkan hasil dari AllStats Search.\n`
              );
            }

            parts.push(formatAllStatsFallback(allStatsResult));

            const text = appendAttribution(parts.join("\n"));
            return { content: [{ type: "text", text }] };
          }
        } catch (allStatsError) {
          logger.debug(
            `AllStats fallback also failed for "${keyword}": ${allStatsError instanceof Error ? allStatsError.message : "unknown"}`
          );
        }
      }

      // --- Step 3: Both failed or no results ---
      if (webapiError) {
        if (webapiError instanceof BpsNotFoundError) {
          return {
            content: [
              {
                type: "text",
                text: `Tidak ditemukan hasil untuk "${keyword}" di WebAPI maupun AllStats Search.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: formatErrorForUser(webapiError) }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Tidak ditemukan hasil untuk "${keyword}".`,
          },
        ],
        isError: true,
      };
    }
  );
}
