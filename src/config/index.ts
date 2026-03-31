import { z } from "zod";
import { DEFAULTS } from "./defaults.js";

const ConfigSchema = z
  .object({
    authType: z.enum(["api-key", "oauth2"]).default("api-key"),
    apiKey: z.string().optional(),
    oauthClientId: z.string().optional(),
    oauthClientSecret: z.string().optional(),
    oauthTokenEndpoint: z.string().url().optional(),
    oauthScopes: z.string().optional(),

    apiBaseUrl: z.string().url().default(DEFAULTS.API_BASE_URL),
    defaultLang: z.enum(["ind", "eng"]).default(DEFAULTS.DEFAULT_LANG),
    defaultDomain: z.string().default(DEFAULTS.DEFAULT_DOMAIN),

    cacheEnabled: z.boolean().default(DEFAULTS.CACHE_ENABLED),
    cacheMaxEntries: z.number().int().positive().default(DEFAULTS.CACHE_MAX_ENTRIES),

    logLevel: z.enum(["debug", "info", "warn", "error"]).default(DEFAULTS.LOG_LEVEL),
  })
  .refine(
    (data) => {
      if (data.authType === "api-key") return !!data.apiKey;
      if (data.authType === "oauth2") {
        return !!data.oauthClientId && !!data.oauthClientSecret && !!data.oauthTokenEndpoint;
      }
      return false;
    },
    { message: "Invalid auth configuration. Provide BPS_API_KEY or OAuth2 credentials." }
  );

export type Config = z.infer<typeof ConfigSchema>;

function detectAuthType(env: NodeJS.ProcessEnv): "api-key" | "oauth2" {
  if (env.BPS_AUTH_TYPE) return env.BPS_AUTH_TYPE as "api-key" | "oauth2";
  if (env.BPS_OAUTH_CLIENT_ID) return "oauth2";
  return "api-key";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = {
    authType: detectAuthType(env),
    apiKey: env.BPS_API_KEY,
    oauthClientId: env.BPS_OAUTH_CLIENT_ID,
    oauthClientSecret: env.BPS_OAUTH_CLIENT_SECRET,
    oauthTokenEndpoint: env.BPS_OAUTH_TOKEN_ENDPOINT,
    oauthScopes: env.BPS_OAUTH_SCOPES,
    apiBaseUrl: env.BPS_API_BASE_URL || DEFAULTS.API_BASE_URL,
    defaultLang: env.BPS_DEFAULT_LANG || DEFAULTS.DEFAULT_LANG,
    defaultDomain: env.BPS_DEFAULT_DOMAIN || DEFAULTS.DEFAULT_DOMAIN,
    cacheEnabled: env.BPS_CACHE_ENABLED !== "false",
    cacheMaxEntries: env.BPS_CACHE_MAX_ENTRIES
      ? parseInt(env.BPS_CACHE_MAX_ENTRIES, 10)
      : DEFAULTS.CACHE_MAX_ENTRIES,
    logLevel: env.BPS_LOG_LEVEL || DEFAULTS.LOG_LEVEL,
  };

  return ConfigSchema.parse(raw);
}
