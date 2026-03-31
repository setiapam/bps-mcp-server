/**
 * BPS API endpoint URL builders.
 * All endpoints follow the pattern: {baseUrl}/api/{endpoint}
 */

export function buildUrl(
  baseUrl: string,
  endpoint: string,
  params: Record<string, string | number | undefined>
): string {
  const url = new URL(`${baseUrl}/api/${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export const ENDPOINTS = {
  // Domain
  DOMAIN_LIST: "domain",

  // Subject
  SUBJECT_LIST: "subject",
  SUBJECT_CATEGORY_LIST: "subjectcategory",

  // Variable
  VARIABLE_LIST: "var",
  VERTICAL_VARIABLE_LIST: "vervar",
  DERIVED_VARIABLE_LIST: "turvar",
  PERIOD_LIST: "th",
  DERIVED_PERIOD_LIST: "turth",
  UNIT_LIST: "unit",

  // Dynamic data
  DYNAMIC_DATA: "dataexport",

  // Static tables
  STATIC_TABLE_LIST: "statictable",
  STATIC_TABLE_DETAIL: "statictable",

  // Press Release
  PRESS_RELEASE_LIST: "pressrelease",
  PRESS_RELEASE_DETAIL: "pressrelease",

  // Publication
  PUBLICATION_LIST: "publication",
  PUBLICATION_DETAIL: "publication",

  // Strategic Indicator
  STRATEGIC_INDICATOR_LIST: "strategicindicator",

  // Trade
  TRADE_DATA: "intertradeHS",

  // Infographic
  INFOGRAPHIC_LIST: "infographic",

  // Search
  SEARCH: "list",

  // Glossary
  GLOSSARY_LIST: "glossary",
} as const;
