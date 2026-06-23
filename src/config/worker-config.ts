import type { Config } from "./index.js";
import { DEFAULTS } from "./defaults.js";
import { getResolvedApiBaseUrl, getResolvedAllStatsBaseUrl } from "../utils/routing-fallback.js";

export interface WorkerEnv {
  BPS_CACHE: KVNamespace;
  BPS_API_BASE_URL?: string;
  BPS_ALLSTATS_BASE_URL?: string;
  BPS_DEFAULT_LANG?: string;
  BPS_DEFAULT_DOMAIN?: string;
  BPS_LOG_LEVEL?: string;
  BPS_CACHE_ENABLED?: string;
  BPS_PROXY_API_BASE_URL?: string;
  BPS_PROXY_ALLSTATS_BASE_URL?: string;
  BPS_DIRECT_API_BASE_URL?: string;
  BPS_DIRECT_ALLSTATS_BASE_URL?: string;
}

export function loadWorkerConfig(env: WorkerEnv, apiKey: string): Config {
  return {
    authType: "api-key" as const,
    apiKey,
    apiBaseUrl: getResolvedApiBaseUrl(env),
    allStatsBaseUrl: getResolvedAllStatsBaseUrl(env),
    defaultLang: (env.BPS_DEFAULT_LANG || DEFAULTS.DEFAULT_LANG) as "ind" | "eng",
    defaultDomain: env.BPS_DEFAULT_DOMAIN || DEFAULTS.DEFAULT_DOMAIN,
    cacheEnabled: env.BPS_CACHE_ENABLED !== "false",
    cacheMaxEntries: DEFAULTS.CACHE_MAX_ENTRIES,
    logLevel: (env.BPS_LOG_LEVEL || "warn") as "debug" | "info" | "warn" | "error",
  };
}
