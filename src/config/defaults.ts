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

export const ATTRIBUTION =
  "Sumber: Badan Pusat Statistik (BPS) — https://www.bps.go.id\n" +
  "Layanan ini menggunakan API Badan Pusat Statistik (BPS).";

export const ATTRIBUTION_EN =
  "Source: Statistics Indonesia (BPS) — https://www.bps.go.id\n" +
  "This service uses the BPS (Badan Pusat Statistik) API.";
