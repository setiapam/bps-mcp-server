import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiKeyProvider } from "./auth/api-key.provider.js";
import { loadWorkerConfig } from "./config/worker-config.js";
import { createServer } from "./server.js";
import { KVCache } from "./services/kv-cache.js";

export interface Env {
  BPS_CACHE: KVNamespace;
  BPS_API_BASE_URL?: string;
  BPS_DEFAULT_LANG?: string;
  BPS_DEFAULT_DOMAIN?: string;
  BPS_LOG_LEVEL?: string;
  RATE_LIMIT_RPM?: string;
}

// --- Constants ---

const VERSION = "0.3.2";
const TOOLS_COUNT = 36;
const RATE_LIMIT_DEFAULT_RPM = 60;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Accept-Language, X-BPS-API-Key, Mcp-Session-Id, Last-Event-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

// --- Bilingual error messages ---

interface ErrorMessages {
  missingApiKey: string;
  invalidApiKey: string;
  rateLimited: string;
  notFound: string;
  internalError: string;
}

const MESSAGES: Record<"id" | "en", ErrorMessages> = {
  id: {
    missingApiKey: "API key BPS tidak ditemukan. Sertakan header X-BPS-API-Key.",
    invalidApiKey: "API key BPS tidak valid. Pastikan key Anda benar (dapatkan di https://webapi.bps.go.id).",
    rateLimited: "Terlalu banyak request. Coba lagi dalam 1 menit.",
    notFound: "Endpoint tidak ditemukan.",
    internalError: "Terjadi kesalahan internal server.",
  },
  en: {
    missingApiKey: "Missing BPS API key. Provide via X-BPS-API-Key header.",
    invalidApiKey: "Invalid BPS API key. Verify your key is correct (get one at https://webapi.bps.go.id).",
    rateLimited: "Too many requests. Try again in 1 minute.",
    notFound: "Endpoint not found.",
    internalError: "Internal server error.",
  },
};

function detectLang(request: Request): "id" | "en" {
  const accept = request.headers.get("accept-language") || "";
  if (accept.match(/^en/i)) return "en";
  return "id";
}

// --- Rate Limiting (per API key, fixed window with single counter) ---

async function checkRateLimit(
  kv: KVNamespace,
  apiKey: string,
  maxRpm: number
): Promise<{ allowed: boolean; remaining: number }> {
  // Use fixed 60-second windows to minimize KV operations
  const window = Math.floor(Date.now() / 60_000);
  const key = `rl:${apiKey}:${window}`;

  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= maxRpm) {
    return { allowed: false, remaining: 0 };
  }

  // Only write if allowed — saves 1 write on rejected requests
  await kv.put(key, String(count + 1), { expirationTtl: 120 });

  return { allowed: true, remaining: maxRpm - count - 1 };
}

// --- API Key Validation (fail fast) ---

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `https://webapi.bps.go.id/v1/api/list/model/domain/type/all/key/${apiKey}/`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BPS-MCP-Server)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status !== "400";
  } catch {
    // If validation request fails, allow through (don't block on network issues)
    return true;
  }
}

// --- Helpers ---

function addCorsHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Worker ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const lang = detectLang(request);
    const msg = MESSAGES[lang];

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // --- Health Check ---
    if (url.pathname === "/" || url.pathname === "/health") {
      return addCorsHeaders(
        jsonResponse(
          {
            name: "bps-mcp-server",
            version: VERSION,
            status: "ok",
            transport: "streamable-http",
            mcpEndpoint: "/mcp",
            tools: TOOLS_COUNT,
            auth: "BYOK (X-BPS-API-Key header required)",
            docs: "https://github.com/setiapam/bps-mcp-server",
            getApiKey: "https://webapi.bps.go.id",
          },
          200
        )
      );
    }

    // --- MCP Endpoint ---
    if (url.pathname === "/mcp") {
      const apiKey = request.headers.get("x-bps-api-key");
      if (!apiKey) {
        return addCorsHeaders(jsonResponse({ error: msg.missingApiKey }, 401));
      }

      // Rate limiting
      const maxRpm = parseInt(env.RATE_LIMIT_RPM || "", 10) || RATE_LIMIT_DEFAULT_RPM;
      const { allowed, remaining } = await checkRateLimit(env.BPS_CACHE, apiKey, maxRpm);
      if (!allowed) {
        const res = jsonResponse({ error: msg.rateLimited }, 429);
        res.headers.set("Retry-After", "60");
        return addCorsHeaders(res);
      }

      // API key format validation (BPS keys are typically 32+ hex chars)
      if (apiKey.length < 20) {
        return addCorsHeaders(jsonResponse({ error: msg.invalidApiKey }, 401));
      }

      // Fail-fast: validate API key on initialize requests
      if (request.method === "POST") {
        try {
          const cloned = request.clone();
          const body = (await cloned.json()) as { method?: string };
          if (body.method === "initialize") {
            const valid = await validateApiKey(apiKey);
            if (!valid) {
              return addCorsHeaders(jsonResponse({ error: msg.invalidApiKey }, 401));
            }
          }
        } catch {
          // If body parsing fails, let MCP SDK handle it
        }
      }

      try {
        const config = loadWorkerConfig(env, apiKey);
        const auth = new ApiKeyProvider(apiKey);
        const cache = new KVCache(env.BPS_CACHE);
        const { server } = createServer(config, auth, cache);

        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await server.connect(transport);
        const response = await transport.handleRequest(request);
        const finalResponse = addCorsHeaders(response);
        finalResponse.headers.set("X-RateLimit-Remaining", String(remaining));
        return finalResponse;
      } catch (error) {
        return addCorsHeaders(
          jsonResponse(
            { error: error instanceof Error ? error.message : msg.internalError },
            500
          )
        );
      }
    }

    return addCorsHeaders(jsonResponse({ error: msg.notFound }, 404));
  },
};
