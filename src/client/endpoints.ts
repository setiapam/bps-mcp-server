/**
 * BPS API endpoint URL builders.
 *
 * BPS Web API uses path-based routing:
 *   List:   {baseUrl}/api/list/model/{model}/domain/{domain}/key/{key}/lang/{lang}/?page=X&keyword=Y
 *   View:   {baseUrl}/api/view/model/{model}/domain/{domain}/lang/{lang}/key/{key}/?id=X
 *   Domain: {baseUrl}/api/domain/type/{type}/key/{key}/lang/{lang}/
 *   Trade:  {baseUrl}/api/dataexim/sumber/{s}/kodehs/{hs}/jenishs/{j}/tahun/{y}/periode/{p}/lang/{lang}/key/{key}/
 *   Census: {baseUrl}/api/interoperabilitas/datasource/sensus/id/{id}/key/{key}/
 *   SIMDASI:{baseUrl}/api/interoperabilitas/datasource/simdasi/id/{id}/wilayah/{w}/key/{key}/
 *
 * Path params are inserted into the URL path. Remaining params (page, keyword, etc.)
 * become query string parameters.
 */

/** Parameters that go into the URL path for list/view endpoints */
const PATH_PARAMS = new Set(["domain", "key", "lang", "id", "var", "th", "turvar", "vervar", "turth", "subject", "subcat", "type", "prov"]);

/** Parameters that go into the URL path for the trade (dataexim) endpoint */
const TRADE_PATH_PARAMS = new Set(["sumber", "kodehs", "jenishs", "tahun", "periode", "lang", "key"]);

/** Parameters that go into the URL path for interoperabilitas endpoints */
const INTEROP_PATH_PARAMS = new Set(["datasource", "id", "kegiatan", "topik", "wilayah", "key"]);

/**
 * BPS accepts multiple values separated by semicolons (not commas) and ranges
 * with colons. Users naturally type commas, so normalize them before building
 * the path. See the API error: "'th' parameter is required (integer),
 * separated by colon (:) for range or semicolon (;) for multiple values".
 */
const MULTI_VALUE_PARAMS = new Set([
  "var",
  "th",
  "turvar",
  "vervar",
  "turth",
  "subject",
  "subcat",
  "kegiatan",
  "topik",
  "wilayah",
]);

export function normalizePathParam(key: string, value: string | number): string {
  let normalized = String(value).trim();
  if (MULTI_VALUE_PARAMS.has(key)) {
    normalized = normalized
      .replace(/\s*[,;]\s*/g, ";")
      .replace(/;+/g, ";")
      .replace(/^;|;$/g, "");
  }
  return normalized;
}

/**
 * Encode a path segment while leaving the BPS multi-value (`;`) and range (`:`)
 * separators intact. `encodeURIComponent` would turn them into `%3B`/`%3A`,
 * which the API does not accept.
 */
export function encodePathValue(value: string | number): string {
  return encodeURIComponent(String(value))
    .replace(/%3B/gi, ";")
    .replace(/%3A/gi, ":");
}

/**
 * Build a list URL: /api/list/model/{model}/param1/val1/.../key/{key}/?queryparams
 */
export function buildListUrl(
  baseUrl: string,
  model: string,
  params: Record<string, string | number | undefined>
): string {
  let path = `${baseUrl}/api/list/model/${model}`;
  const queryParams: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (PATH_PARAMS.has(key)) {
      path += `/${key}/${encodePathValue(normalizePathParam(key, value))}`;
    } else {
      queryParams[key] = String(value);
    }
  }

  // Ensure path ends with /
  if (!path.endsWith("/")) path += "/";

  const url = new URL(path);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Build a view URL: /api/view/model/{model}/param1/val1/.../key/{key}/?queryparams
 */
export function buildViewUrl(
  baseUrl: string,
  model: string,
  params: Record<string, string | number | undefined>
): string {
  let path = `${baseUrl}/api/view/model/${model}`;
  const queryParams: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (PATH_PARAMS.has(key)) {
      path += `/${key}/${encodePathValue(normalizePathParam(key, value))}`;
    } else {
      queryParams[key] = String(value);
    }
  }

  if (!path.endsWith("/")) path += "/";

  const url = new URL(path);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Build a domain URL: /api/domain/type/{type}/key/{key}/lang/{lang}/
 */
export function buildDomainUrl(
  baseUrl: string,
  params: Record<string, string | number | undefined>
): string {
  let path = `${baseUrl}/api/domain`;

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    path += `/${key}/${encodePathValue(normalizePathParam(key, value))}`;
  }

  if (!path.endsWith("/")) path += "/";
  return new URL(path).toString();
}

/**
 * Build a trade (dataexim) URL: /api/dataexim/param1/val1/.../key/{key}/
 */
export function buildTradeUrl(
  baseUrl: string,
  params: Record<string, string | number | undefined>
): string {
  let path = `${baseUrl}/api/dataexim`;
  const queryParams: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (TRADE_PATH_PARAMS.has(key)) {
      path += `/${key}/${encodePathValue(normalizePathParam(key, value))}`;
    } else {
      queryParams[key] = String(value);
    }
  }

  if (!path.endsWith("/")) path += "/";

  const url = new URL(path);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Build an interoperabilitas URL: /api/interoperabilitas/datasource/{source}/id/{id}/.../key/{key}/
 */
export function buildInteropUrl(
  baseUrl: string,
  datasource: string,
  params: Record<string, string | number | undefined>
): string {
  let path = `${baseUrl}/api/interoperabilitas/datasource/${datasource}`;
  const queryParams: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (INTEROP_PATH_PARAMS.has(key)) {
      path += `/${key}/${encodePathValue(normalizePathParam(key, value))}`;
    } else {
      queryParams[key] = String(value);
    }
  }

  if (!path.endsWith("/")) path += "/";

  const url = new URL(path);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export const MODELS = {
  // Domain (special — uses /api/domain/ directly)
  DOMAIN: "domain",

  // Subject & Category
  SUBJECT: "subject",
  SUBJECT_CATEGORY: "subcat",

  // Variables
  VARIABLE: "var",
  VERTICAL_VARIABLE: "vervar",
  DERIVED_VARIABLE: "turvar",
  PERIOD: "th",
  DERIVED_PERIOD: "turth",
  UNIT: "unit",

  // Dynamic data
  DATA: "data",

  // Static tables
  STATIC_TABLE: "statictable",

  // Press Release
  PRESS_RELEASE: "pressrelease",

  // Publication
  PUBLICATION: "publication",

  // Strategic Indicator
  STRATEGIC_INDICATOR: "indicators",

  // Infographic
  INFOGRAPHIC: "infographic",

  // News
  NEWS: "news",

  // Glossary
  GLOSSARY: "glosarium",

  // CSA (Classification of Statistical Activities)
  CSA_SUBJECT_CATEGORY: "subcatcsa",
  CSA_SUBJECT: "subjectcsa",
  CSA_TABLE: "tablestatistic",
} as const;
