import type { BpsClient } from "../client/bps-client.js";
import type { AllStatsClient } from "../client/allstats-client.js";
import type { BpsGlossaryTerm, PageInfo } from "../client/types.js";
import { logger } from "../utils/logger.js";
import { searchVariables } from "./variable-search.js";
import { searchQueryFallbacks } from "./search-query.js";

export interface ListGlossaryInput {
  domain?: string;
  keyword?: string;
  page?: number;
}

export interface GlossaryVariableItem {
  var_id: number;
  title: string;
  definition: string;
  unit?: string;
  sub_name?: string;
}

export interface GlossaryDocumentItem {
  title: string;
  url: string;
  description?: string;
}

export type GlossaryServiceResult =
  | {
      source: "glossary";
      domain: string;
      keyword?: string;
      items: BpsGlossaryTerm[];
      page?: PageInfo;
    }
  | {
      source: "variables";
      domain: string;
      keyword: string;
      items: GlossaryVariableItem[];
    }
  | {
      source: "documents";
      domain: string;
      keyword: string;
      effectiveKeyword: string;
      items: GlossaryDocumentItem[];
    }
  | {
      source: "unavailable";
      domain: string;
      keyword?: string;
      items: [];
      error?: string;
    };

export async function listGlossaryService(
  client: BpsClient,
  allStatsClient: AllStatsClient | undefined,
  input: ListGlossaryInput
): Promise<GlossaryServiceResult> {
  const domain = input.domain || "0000";
  const keyword = input.keyword;
  const page = input.page;

  try {
    const result = await client.listGlossary(domain, keyword, page);
    return {
      source: "glossary",
      domain,
      keyword,
      items: result.data,
      page: result.page,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown";
    logger.debug(`Glossary WebAPI failed: ${errorMsg}`);

    // The WebAPI glossary endpoint currently returns HTTP 500 for every
    // request. Variable metadata carries the same definitions, so answer
    // from there instead of returning an error the caller cannot act on.
    if (keyword && keyword.trim()) {
      try {
        const variables = await searchVariables(client, domain, keyword, {
          maxSubjects: 4,
          maxPagesPerSubject: 2,
          maxCandidates: 8,
        });
        const defined = variables
          .filter((variable) => (variable.def ?? "").trim().length > 20)
          .slice(0, 5);

        if (defined.length > 0) {
          return {
            source: "variables",
            domain,
            keyword,
            items: defined.map((v) => ({
              var_id: v.var_id,
              title: v.title,
              definition: v.def!.trim().slice(0, 600),
              unit: v.unit,
              sub_name: v.sub_name,
            })),
          };
        }
      } catch (fallbackError) {
        logger.debug(
          `Glossary variable-definition fallback failed: ${
            fallbackError instanceof Error ? fallbackError.message : "unknown"
          }`
        );
      }

      if (allStatsClient) {
        try {
          let related = await allStatsClient.search({
            query: keyword,
            content: "all",
            domain,
            page: page || 1,
            sort: "relevansi",
          });
          let effectiveKeyword = keyword;
          if (related.results.length === 0) {
            for (const fallback of searchQueryFallbacks(keyword)) {
              related = await allStatsClient.search({
                query: fallback,
                content: "all",
                domain,
                page: page || 1,
                sort: "relevansi",
              });
              if (related.results.length > 0) {
                effectiveKeyword = fallback;
                break;
              }
            }
          }
          if (related.results.length > 0) {
            return {
              source: "documents",
              domain,
              keyword,
              effectiveKeyword,
              items: related.results.slice(0, 5).map((item) => ({
                title: item.title,
                url: item.url,
                description: item.description || undefined,
              })),
            };
          }
        } catch (relatedError) {
          logger.debug(
            `Glossary AllStats fallback failed: ${
              relatedError instanceof Error ? relatedError.message : "unknown"
            }`
          );
        }
      }
    }

    return {
      source: "unavailable",
      domain,
      keyword,
      items: [],
      error: errorMsg,
    };
  }
}
