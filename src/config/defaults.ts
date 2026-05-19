export const DEFAULTS = {
  API_BASE_URL: "https://webapi.bps.go.id/v1",
  DEFAULT_LANG: "ind" as const,
  DEFAULT_DOMAIN: "0000",
  CACHE_ENABLED: true,
  CACHE_MAX_ENTRIES: 500,
  LOG_LEVEL: "info" as const,
  TRANSPORT: "stdio" as const,
  HTTP_PORT: 3000,
} as const;

export const CACHE_TTL = {
  DOMAIN_LIST: 7 * 24 * 60 * 60,       // 7 days — domains rarely change
  SUBJECT_LIST: 7 * 24 * 60 * 60,      // 7 days — subjects rarely change
  VARIABLE_LIST: 24 * 60 * 60,         // 24 hours
  STATIC_TABLE: 24 * 60 * 60,          // 24 hours
  DYNAMIC_DATA: 6 * 60 * 60,           // 6 hours — data updates infrequently
  TRADE_DATA: 6 * 60 * 60,             // 6 hours
  PRESS_RELEASE: 2 * 60 * 60,          // 2 hours
  PUBLICATION: 24 * 60 * 60,           // 24 hours
  STRATEGIC_INDICATOR: 6 * 60 * 60,    // 6 hours
  ALLSTATS_SEARCH: 2 * 60 * 60,        // 2 hours
  ALLSTATS_DEEP_SEARCH: 24 * 60 * 60,  // 24 hours — PDF content doesn't change
} as const;

export const ATTRIBUTION =
  "Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id\n" +
  "Layanan ini menggunakan API Badan Pusat Statistik (BPS).";

export const ATTRIBUTION_EN =
  "Source: Statistics Indonesia (BPS) — https://www.bps.go.id\n" +
  "This service uses the BPS (Badan Pusat Statistik) API.";
