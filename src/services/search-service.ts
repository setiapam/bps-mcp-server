import type { BpsClient } from "../client/bps-client.js";
import type {
  AllStatsClient,
  AllStatsContentType,
  AllStatsSearchResponse,
  AllStatsSortOrder,
} from "../client/allstats-client.js";
import type { PageInfo } from "../client/types.js";
import { MODELS } from "../client/endpoints.js";
import { searchQueryFallbacks } from "./search-query.js";
import { expandQueryTerms } from "./variable-search.js";
import { logger } from "../utils/logger.js";
import { stripHtml } from "../utils/html.js";

/** WebAPI content types the search endpoint accepts. */
export type WebApiSearchType =
  | "statictable"
  | "publication"
  | "pressrelease"
  | "strategicindicator";

export type SearchType = "all" | WebApiSearchType;

const SEARCH_MODELS: Record<WebApiSearchType, string> = {
  statictable: MODELS.STATIC_TABLE,
  publication: MODELS.PUBLICATION,
  pressrelease: MODELS.PRESS_RELEASE,
  strategicindicator: MODELS.STRATEGIC_INDICATOR,
};

/** Types searched when the caller does not narrow it down. */
const FANOUT_TYPES: WebApiSearchType[] = ["statictable", "publication", "pressrelease"];

/** Map WebAPI type names to AllStats content types */
const WEBAPI_TO_ALLSTATS_CONTENT: Record<string, AllStatsContentType> = {
  statictable: "table",
  pressrelease: "pressrelease",
  publication: "publication",
  strategicindicator: "table",
};

export interface SearchInput {
  keyword: string;
  domain?: string;
  type?: SearchType;
  page?: number;
}

export interface SearchWebApiGroup {
  type: WebApiSearchType;
  data: unknown[];
  page?: PageInfo;
}

export interface SearchServiceResult {
  source: "webapi" | "allstats" | "none";
  keyword: string;
  effectiveQuery: string;
  domain: string;
  type: SearchType;
  groups?: Partial<Record<WebApiSearchType, unknown[]>>;
  orderedGroups?: SearchWebApiGroup[];
  page?: PageInfo;
  total?: number;
  results?: AllStatsSearchResponse["results"];
  allStatsResult?: AllStatsSearchResponse;
  webapiError?: unknown;
}

export async function searchService(
  client: BpsClient,
  allStatsClient: AllStatsClient | undefined,
  input: SearchInput
): Promise<SearchServiceResult> {
  const domain = input.domain || "0000";
  const keyword = input.keyword;
  const searchType: SearchType = input.type ?? "all";
  const searchPage = input.page ?? 1;

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
      (entry): entry is { type: WebApiSearchType; res: { data: unknown[]; page?: PageInfo } } =>
        !!entry.res && Array.isArray(entry.res.data) && entry.res.data.length > 0
    );
  };

  let effectiveQuery = keyword;
  let groups = await runSearch(keyword, types);

  if (groups.length === 0 && searchType !== "all") {
    for (const fallback of searchQueryFallbacks(keyword).slice(0, 1)) {
      logger.debug(`WebAPI search fallback: retrying with "${fallback}"`);
      groups = await runSearch(fallback, types);
      if (groups.length > 0) {
        effectiveQuery = fallback;
        break;
      }
    }
  }

  if (groups.length > 0) {
    const terms = expandQueryTerms(keyword).filter((term) => term.length > 2);
    const filteredGroups: SearchWebApiGroup[] = groups.map((group) => {
      if (group.type !== "strategicindicator") {
        return { type: group.type, data: group.res.data, page: group.res.page };
      }
      const relevant = group.res.data.filter((item) => {
        const title = stripHtml((item as { title?: string }).title ?? "").toLowerCase();
        return terms.some((term) => title.includes(term));
      });
      return {
        type: group.type,
        data: relevant.length > 0 ? relevant : group.res.data,
        page: group.res.page,
      };
    });

    const groupsMap: Partial<Record<WebApiSearchType, unknown[]>> = {};
    for (const group of filteredGroups) {
      groupsMap[group.type] = group.data;
    }

    const total = filteredGroups.reduce((sum, group) => sum + group.data.length, 0);
    const pageInfo = filteredGroups.find((group) => group.page)?.page;

    return {
      source: "webapi",
      keyword,
      effectiveQuery,
      domain,
      type: searchType,
      groups: groupsMap,
      orderedGroups: filteredGroups,
      page: pageInfo,
      total,
    };
  }

  // --- Step 2: Fallback to AllStats ---
  if (allStatsClient) {
    try {
      const allStatsContent: AllStatsContentType =
        searchType !== "all" && WEBAPI_TO_ALLSTATS_CONTENT[searchType]
          ? WEBAPI_TO_ALLSTATS_CONTENT[searchType]
          : "all";

      let fallbackQuery = keyword;
      let allStatsResult = await allStatsClient.search({
        query: fallbackQuery,
        content: allStatsContent,
        domain,
        page: searchPage,
        sort: "relevansi",
      });

      for (const fallback of searchQueryFallbacks(keyword)) {
        if (allStatsResult.results.length > 0) break;
        logger.debug(`AllStats search fallback: retrying with "${fallback}"`);
        fallbackQuery = fallback;
        allStatsResult = await allStatsClient.search({
          query: fallback,
          content: allStatsContent,
          domain,
          page: searchPage,
          sort: "relevansi",
        });
      }

      if (allStatsResult.results.length > 0) {
        return {
          source: "allstats",
          keyword,
          effectiveQuery: fallbackQuery,
          domain,
          type: searchType,
          results: allStatsResult.results,
          total: allStatsResult.totalResults,
          allStatsResult,
          webapiError,
        };
      }
    } catch (allStatsError) {
      logger.debug(
        `AllStats fallback also failed for "${keyword}": ${allStatsError instanceof Error ? allStatsError.message : "unknown"}`
      );
    }
  }

  return {
    source: "none",
    keyword,
    effectiveQuery: keyword,
    domain,
    type: searchType,
    webapiError,
  };
}

export interface AllStatsSearchServiceInput {
  query: string;
  content?: AllStatsContentType;
  domain?: string;
  page?: number;
  title_only?: boolean;
  year_from?: string;
  year_to?: string;
  sort?: AllStatsSortOrder;
}

export interface AllStatsSearchServiceResult extends AllStatsSearchResponse {
  originalQuery: string;
  effectiveQuery: string;
}

export async function allstatsSearchService(
  allStatsClient: AllStatsClient,
  input: AllStatsSearchServiceInput
): Promise<AllStatsSearchServiceResult> {
  const {
    query,
    content = "all",
    domain = "0000",
    page = 1,
    title_only = false,
    year_from = "all",
    year_to = "all",
    sort = "relevansi",
  } = input;

  let effectiveQuery = query;
  let result = await allStatsClient.search({
    query,
    content,
    domain,
    page,
    titleOnly: title_only,
    yearFrom: year_from,
    yearTo: year_to,
    sort,
  });

  if (result.results.length === 0) {
    let best: { query: string; response: AllStatsSearchResponse } | null = null;
    for (const fallback of searchQueryFallbacks(query)) {
      const retry = await allStatsClient.search({
        query: fallback,
        content,
        domain,
        page,
        titleOnly: title_only,
        yearFrom: year_from,
        yearTo: year_to,
        sort,
      });
      if (retry.results.length === 0) continue;
      if (!best || retry.results.length > best.response.results.length) {
        best = { query: fallback, response: retry };
      }
      if (best.response.results.length >= 5) break;
    }
    if (best) {
      effectiveQuery = best.query;
      result = best.response;
    }
  }

  return {
    ...result,
    originalQuery: query,
    effectiveQuery,
  };
}
