import * as cheerio from "cheerio";
import type { ICacheProvider } from "../services/cache.js";
import { logger } from "../utils/logger.js";

// ========== Constants ==========

const ALLSTATS_BASE = "https://searchengine.web.bps.go.id";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://www.bps.go.id/",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-site",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
};
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

// ========== Types ==========

export type AllStatsContentType =
  | "all"
  | "publication"
  | "table"
  | "pressrelease"
  | "infographic"
  | "microdata"
  | "news"
  | "glosarium"
  | "kbli2020"
  | "kbli2017"
  | "kbli2015"
  | "kbli2009";

export type AllStatsSortOrder = "terbaru" | "relevansi";

export interface AllStatsSearchParams {
  query: string;
  content?: AllStatsContentType;
  domain?: string;
  page?: number;
  titleOnly?: boolean;
  yearFrom?: string;
  yearTo?: string;
  sort?: AllStatsSortOrder;
}

export interface AllStatsSearchResult {
  url: string;
  title: string;
  description: string;
  contentType: string;
  domain: string;
  deepSearchId?: string;
}

export interface AllStatsSearchResponse {
  query: string;
  totalResults: number;
  currentPage: number;
  totalPages: number;
  results: AllStatsSearchResult[];
}

export interface AllStatsDeepSearchParams {
  query: string;
  publicationId: string;
  domain?: string;
  page?: number;
}

export interface AllStatsDeepSearchMatch {
  pageNumber: number;
  excerpt: string;
  highlights: string[];
  pdfViewerUrl: string;
}

export interface AllStatsDeepSearchPublication {
  title: string;
  publisher: string;
  coverUrl: string;
  publicationUrl: string;
  pdfDownloadBase: string;
}

export interface AllStatsDeepSearchResponse {
  query: string;
  publication: AllStatsDeepSearchPublication;
  totalMatches: number;
  currentPage: number;
  totalPages: number;
  matches: AllStatsDeepSearchMatch[];
  /** Set when BPS redirects /deep to normal search or the format changes. */
  notice?: string;
}

// ========== OCR Cleanup ==========

const OCR_PATTERNS = [
  /^Ps\s*\/\/\s*W\s*Ww\s*\.Bp\s*S\.G\s*O\.I\s*D\s*/i,
  /^Ht\s*Tp\s*\/\/\s*.*?\.Bp\s*S\s*\.\s*Go\s*\.\s*Id\s*/i,
];

function cleanExcerpt(text: string): string {
  let cleaned = text;
  for (const p of OCR_PATTERNS) cleaned = cleaned.replace(p, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

// ========== Client ==========

export class AllStatsClient {
  private readonly baseUrl: string;

  constructor(private readonly cache: ICacheProvider | null, baseUrl?: string) {
    this.baseUrl = baseUrl || ALLSTATS_BASE;
  }

  // ---------- HTTP ----------

  private async fetchHtml(path: string, params: Record<string, string>): Promise<string> {
    // Ensure base URL ends with / and path is relative for proper URL construction
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : this.baseUrl + "/";
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(relativePath, base);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const cacheKey = `allstats:${url.toString()}`;

    // Check cache
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.debug(`AllStats cache hit: ${cacheKey}`);
        return cached;
      }
    }

    const html = await this.fetchWithRetry(url.toString());

    // Cache for 2 hours
    if (this.cache) {
      await this.cache.set(cacheKey, html, 2 * 60 * 60);
    }

    return html;
  }

  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.doFetch(url);
      } catch (error) {
        lastError = error;

        // Retry on 403 (rate limit) and 5xx
        const isRetryable =
          error instanceof AllStatsError &&
          error.statusCode !== undefined &&
          (error.statusCode === 403 || error.statusCode >= 500);

        if (!isRetryable || attempt === MAX_RETRIES - 1) {
          throw error;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`AllStats retry (${attempt + 1}/${MAX_RETRIES}) after ${delay}ms: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async doFetch(url: string): Promise<string> {
    logger.debug(`AllStats fetch: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AllStatsError(`Request timeout after ${FETCH_TIMEOUT_MS}ms`, 408, url);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      if (res.status === 403) {
        throw new AllStatsError(
          "AllStats HTTP 403 Forbidden — situs BPS kemungkinan memblokir request dari IP server/cloud. " +
          "Fitur AllStats Search & Deep Search hanya tersedia saat server dijalankan secara lokal (stdio). " +
          "Gunakan tool 'search' (WebAPI) sebagai alternatif.",
          403,
          url,
        );
      }
      throw new AllStatsError(`AllStats HTTP ${res.status} ${res.statusText}`, res.status, url);
    }

    return res.text();
  }

  // ---------- Search ----------

  async search(params: AllStatsSearchParams): Promise<AllStatsSearchResponse> {
    const html = await this.fetchHtml("/search", {
      q: params.query,
      content: params.content || "all",
      page: String(params.page || 1),
      title: params.titleOnly ? "1" : "0",
      mfd: params.domain || "0000",
      from: params.yearFrom || "all",
      to: params.yearTo || "all",
      sort: params.sort || "relevansi",
    });

    return this.parseSearchResults(html, params.query, params.page || 1, params);
  }

  private parseSearchResults(
    html: string,
    query: string,
    currentPage: number,
    params?: AllStatsSearchParams
  ): AllStatsSearchResponse {
    const $ = cheerio.load(html);

    // Total results: "Menampilkan 4.079 hasil pencarian dalam ..." or
    // "Menampilkan 106 tabel dalam ...". The noun changes per content type.
    const bodyText = $("body").text();
    const totalMatch =
      bodyText.match(/Menampilkan\s+([\d.]+)\s+(?:hasil pencarian|tabel|publikasi|berita|infografis|data mikro|glosarium|klasifikasi)/i) ||
      bodyText.match(/Menampilkan\s+([\d.]+)/i);
    const totalResults = totalMatch
      ? parseInt(totalMatch[1].replace(/\./g, ""))
      : 0;

    // Pagination
    const pages: number[] = [];
    $("a[onclick*='changePage']").each((_, el) => {
      const m = $(el).attr("onclick")?.match(/changePage\((\d+)\)/);
      if (m) pages.push(parseInt(m[1]));
    });
    const totalPages = pages.length > 0 ? Math.max(...pages) : 1;

    // Results
    const results: AllStatsSearchResult[] = [];
    $("div.card-result").each((_, el) => {
      const $c = $(el);
      const url = $c.find("a.stretched-link").attr("href") || "";
      const title = $c.find("h5.fw-medium").text().trim();
      const description = $c
        .find("p.text-body-secondary.text-truncate")
        .text()
        .trim();

      const badges = $c.find("div.badge");
      const badgeTexts = badges.toArray().map((badge) => $(badge).text().trim()).filter(Boolean);
      const contentType = badgeTexts[0] || params?.content || "";
      const domainBadge = $c.find("div.badge.text-bg-light").text().trim();
      const domain =
        domainBadge ||
        (badgeTexts.length > 1 ? badgeTexts[badgeTexts.length - 1] : "") ||
        params?.domain || "";

      let deepSearchId: string | undefined;
      // Publication URLs contain the id BPS uses for /deep.
      const urlMatch = url.match(/\/publication\/\d{4}\/\d{2}\/\d{2}\/([a-f0-9]{24})\//);
      if (urlMatch) {
        deepSearchId = urlMatch[1];
      } else {
        const deepHref = $c.find('a[href*="deep"]').attr("href");
        const m = deepHref?.match(/id=([a-f0-9]{24})/);
        if (m) deepSearchId = m[1];
      }

      results.push({
        url,
        title,
        description,
        contentType,
        domain,
        deepSearchId,
      });
    });

    return {
      query,
      totalResults,
      currentPage,
      totalPages,
      results,
    };
  }

  // ---------- Deep Search ----------

  async deepSearch(
    params: AllStatsDeepSearchParams
  ): Promise<AllStatsDeepSearchResponse> {
    const html = await this.fetchHtml("/deep", {
      q: params.query,
      id: params.publicationId,
      content: "publication",
      mfd: params.domain || "0000",
      page: String(params.page || 1),
    });

    return this.parseDeepSearchResults(html, params.query, params.page || 1);
  }

  private parseDeepSearchResults(
    html: string,
    query: string,
    currentPage: number
  ): AllStatsDeepSearchResponse {
    const $ = cheerio.load(html);

    // Deep Search now sometimes redirects to the normal search page (BPS
    // changed/removed the endpoint for some publications). Detect that instead
    // of returning ten empty "Halaman 0" rows.
    const hasDeepMarkers =
      $("a.linkhalaman").length > 0 ||
      $('p[id^="deskripsi-"]').length > 0;

    const title =
      $("h5.card-title.fw-semibold").first().text().trim() ||
      $("h5.fw-medium").first().text().trim() ||
      $("title").text().replace(/\s*-\s*AllStats Search\s*$/i, "").trim();

    const publication: AllStatsDeepSearchPublication = {
      title,
      publisher: $("p.card-text.text-body-secondary").first().text().trim(),
      coverUrl: $("img.foreground").attr("src") || "",
      publicationUrl:
        $('a.btn-info[href*="bps.go.id/publication"]').attr("href") || "",
      pdfDownloadBase: "",
    };

    // PDF download base from inline script
    $("script").each((_, el) => {
      const content = $(el).html() || "";
      const m = content.match(
        /https:\/\/web-api\.bps\.go\.id\/download\.php\?f=[^#"]*/
      );
      if (m) publication.pdfDownloadBase = m[0];
    });

    // Total matches: "Menampilkan 11 halaman dengan kata kunci ..."
    const bodyText = $("body").text();
    const totalMatch =
      bodyText.match(/Menampilkan\s+([\d.]+)\s+halaman dengan kata kunci/i) ||
      bodyText.match(/Menampilkan\s+([\d.]+)\s+halaman/i);
    const totalMatches = totalMatch
      ? parseInt(totalMatch[1].replace(/\./g, ""))
      : 0;

    // Pagination
    const pages: number[] = [];
    $("a[onclick*='changePage']").each((_, el) => {
      const m = $(el).attr("onclick")?.match(/changePage\((\d+)\)/);
      if (m) pages.push(parseInt(m[1]));
    });
    const totalPages = pages.length > 0 ? Math.max(...pages) : 1;

    // Matches
    const matches: AllStatsDeepSearchMatch[] = [];
    if (hasDeepMarkers) {
      $("div.card-result").each((_, el) => {
        const $c = $(el);
        const pageNumber = parseInt(
          $c.find("a.linkhalaman").attr("data-page") ||
            $c.find("[data-page]").first().attr("data-page") ||
            "0",
          10
        );
        const excerptEl = $c.find('p[id^="deskripsi-"]').first();
        const excerpt = cleanExcerpt(
          excerptEl.text() || $c.find("p.text-body-secondary").first().text()
        );

        const highlights: string[] = [];
        excerptEl.find("mark").each((_, mark) => {
          const kw = $(mark).text().trim().toLowerCase();
          if (!highlights.includes(kw)) highlights.push(kw);
        });

        if (pageNumber === 0 && !excerpt) return;

        const pdfViewerUrl = publication.pdfDownloadBase
          ? `${publication.pdfDownloadBase}#page=${pageNumber}`
          : "";

        matches.push({ pageNumber, excerpt, highlights, pdfViewerUrl });
      });
    }

    const notice = hasDeepMarkers
      ? undefined
      : "Deep Search tidak tersedia untuk publikasi ini (BPS mengalihkan endpoint /deep ke pencarian biasa). Gunakan allstats_search atau buka PDF publikasi langsung.";

    return {
      query,
      publication,
      totalMatches,
      currentPage,
      totalPages,
      matches,
      notice,
    };
  }
}

// ========== Error ==========

class AllStatsError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = "AllStatsError";
  }
}
