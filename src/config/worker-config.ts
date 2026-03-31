import type { Config } from "./index.js";
import { DEFAULTS } from "./defaults.js";

export interface WorkerEnv {
  BPS_CACHE: KVNamespace;
  BPS_API_KEY?: string;
  BPS_API_BASE_URL?: string;
  BPS_DEFAULT_LANG?: string;
  BPS_DEFAULT_DOMAIN?: string;
  BPS_LOG_LEVEL?: string;
}

export function loadWorkerConfig(env: WorkerEnv, apiKey?: string): Config {
  return {
    authType: "api-key" as const,
    apiKey: apiKey || env.BPS_API_KEY || "",
    apiBaseUrl: env.BPS_API_BASE_URL || DEFAULTS.API_BASE_URL,
    defaultLang: (env.BPS_DEFAULT_LANG || DEFAULTS.DEFAULT_LANG) as "ind" | "eng",
    defaultDomain: env.BPS_DEFAULT_DOMAIN || DEFAULTS.DEFAULT_DOMAIN,
    cacheEnabled: true,
    cacheMaxEntries: DEFAULTS.CACHE_MAX_ENTRIES,
    logLevel: (env.BPS_LOG_LEVEL || "warn") as "debug" | "info" | "warn" | "error",
  };
}
