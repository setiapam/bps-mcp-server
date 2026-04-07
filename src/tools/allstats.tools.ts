import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AllStatsClient,
  AllStatsSearchResponse,
  AllStatsDeepSearchResponse,
} from "../client/allstats-client.js";
import { appendAttribution } from "../services/attribution.js";

// ========== Formatters ==========

function formatSearchResults(res: AllStatsSearchResponse): string {
  const lines: string[] = [];
  lines.push(`## Hasil AllStats Search: "${res.query}"`);
  lines.push("");
  lines.push(
    `Ditemukan **${res.totalResults.toLocaleString("id-ID")}** hasil (halaman ${res.currentPage}/${res.totalPages})`
  );
  lines.push("");

  if (res.results.length === 0) {
    lines.push("_Tidak ada hasil ditemukan._");
    return lines.join("\n");
  }

  for (let i = 0; i < res.results.length; i++) {
    const r = res.results[i];
    lines.push(`### ${i + 1}. ${r.title}`);
    if (r.description) lines.push(`> ${r.description}`);
    lines.push("");
    lines.push(`- **Tipe:** ${r.contentType}`);
    lines.push(`- **Sumber:** ${r.domain}`);
    if (r.url) lines.push(`- **URL:** ${r.url}`);
    if (r.deepSearchId) {
      lines.push(
        `- **Deep Search ID:** \`${r.deepSearchId}\` _(gunakan allstats_deep_search untuk cari teks di dalam publikasi ini)_`
      );
    }
    lines.push("");
  }

  if (res.currentPage < res.totalPages) {
    lines.push(
      `---\n_Halaman ${res.currentPage} dari ${res.totalPages}. Gunakan parameter \`page\` untuk melihat halaman berikutnya._`
    );
  }

  return lines.join("\n");
}

function formatDeepSearchResults(res: AllStatsDeepSearchResponse): string {
  const lines: string[] = [];
  const pub = res.publication;

  lines.push(`## Deep Search: "${res.query}"`);
  lines.push("");
  lines.push(`### Publikasi: ${pub.title}`);
  if (pub.publisher) lines.push(`**Penerbit:** ${pub.publisher}`);
  if (pub.publicationUrl) lines.push(`**URL:** ${pub.publicationUrl}`);
  lines.push("");
  lines.push(
    `Ditemukan **${res.totalMatches}** halaman cocok (halaman hasil ${res.currentPage}/${res.totalPages})`
  );
  lines.push("");

  if (res.matches.length === 0) {
    lines.push("_Tidak ada halaman yang cocok ditemukan._");
    return lines.join("\n");
  }

  for (const match of res.matches) {
    lines.push(`#### Halaman ${match.pageNumber}`);
    if (match.excerpt) {
      lines.push(`> ${match.excerpt}`);
    }
    if (match.highlights.length > 0) {
      lines.push(`**Kata kunci:** ${match.highlights.join(", ")}`);
    }
    if (match.pdfViewerUrl) {
      lines.push(`**PDF:** ${match.pdfViewerUrl}`);
    }
    lines.push("");
  }

  if (res.currentPage < res.totalPages) {
    lines.push(
      `---\n_Halaman ${res.currentPage} dari ${res.totalPages}. Gunakan parameter \`page\` untuk melihat halaman berikutnya._`
    );
  }

  return lines.join("\n");
}

// ========== Tool Registration ==========

export function registerAllStatsTools(
  server: McpServer,
  allStatsClient: AllStatsClient
): void {
  // ---------- allstats_search ----------
  server.tool(
    "allstats_search",
    "Pencarian konten BPS melalui AllStats Search Engine (publikasi, tabel, BRS, infografis, data mikro, glosarium, klasifikasi). Berguna untuk discovery, mencari publikasi, atau sebagai alternatif/fallback dari WebAPI search. Tidak memerlukan API key.",
    {
      query: z.string().describe("Kata kunci pencarian"),
      content: z
        .enum([
          "all",
          "publication",
          "table",
          "pressrelease",
          "infographic",
          "microdata",
          "news",
          "glosarium",
          "kbli2020",
          "kbli2017",
          "kbli2015",
          "kbli2009",
        ])
        .default("all")
        .describe(
          "Filter tipe konten: all, publication, table, pressrelease, infographic, microdata, news, glosarium, kbli2020/2017/2015/2009"
        ),
      domain: z
        .string()
        .default("0000")
        .describe(
          "Kode wilayah MFD. 'all'=semua, '0000'=nasional, 2 digit=provinsi (cth: 3500=Jatim), 4 digit=kab/kota"
        ),
      page: z
        .number()
        .default(1)
        .describe("Nomor halaman (10 hasil per halaman)"),
      title_only: z
        .boolean()
        .default(false)
        .describe("Cari di judul saja (true) atau semua field (false)"),
      year_from: z
        .string()
        .default("all")
        .describe("Filter tahun mulai ('all' atau tahun, cth: '2020')"),
      year_to: z
        .string()
        .default("all")
        .describe("Filter tahun sampai ('all' atau tahun, cth: '2024')"),
      sort: z
        .enum(["terbaru", "relevansi"])
        .default("terbaru")
        .describe("Urutan hasil: 'terbaru' (newest first) atau 'relevansi'"),
    },
    async ({ query, content, domain, page, title_only, year_from, year_to, sort }) => {
      try {
        const result = await allStatsClient.search({
          query,
          content,
          domain,
          page,
          titleOnly: title_only,
          yearFrom: year_from,
          yearTo: year_to,
          sort,
        });

        const text = appendAttribution(formatSearchResults(result));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message =
          error instanceof Error
            ? `Gagal melakukan pencarian AllStats: ${error.message}`
            : "Terjadi kesalahan saat mengakses AllStats Search.";
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  // ---------- allstats_deep_search ----------
  server.tool(
    "allstats_deep_search",
    "Full-text search di dalam isi PDF publikasi BPS. Mengembalikan halaman yang cocok beserta cuplikan teks. Dapatkan publication_id dari hasil allstats_search (field deep_search_id). Fitur unik — tidak tersedia di WebAPI. Tidak memerlukan API key.",
    {
      query: z.string().describe("Kata kunci untuk dicari di dalam publikasi"),
      publication_id: z
        .string()
        .regex(/^[a-f0-9]{24}$/, "Harus berupa 24 karakter hex")
        .describe(
          "ID publikasi (24 karakter hex) dari URL publikasi BPS atau dari field deep_search_id di hasil allstats_search"
        ),
      domain: z
        .string()
        .default("0000")
        .describe("Kode wilayah MFD"),
      page: z
        .number()
        .default(1)
        .describe("Halaman hasil (bukan halaman PDF)"),
    },
    async ({ query, publication_id, domain, page }) => {
      try {
        const result = await allStatsClient.deepSearch({
          query,
          publicationId: publication_id,
          domain,
          page,
        });

        const text = appendAttribution(formatDeepSearchResults(result));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message =
          error instanceof Error
            ? `Gagal melakukan deep search AllStats: ${error.message}`
            : "Terjadi kesalahan saat mengakses AllStats Deep Search.";
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );
}
