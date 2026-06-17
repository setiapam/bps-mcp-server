import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiKeyProvider } from "./auth/api-key.provider.js";
import { loadWorkerConfig } from "./config/worker-config.js";
import { createServer } from "./server.js";
import { KVCache } from "./services/kv-cache.js";
import { KVStore } from "./services/kv-store.js";
import pkg from "../package.json";
import type { Env } from "./worker.js";

// Rate limiting (in-memory counter to avoid KV PUT operations)
interface RateLimitData {
  count: number;
  window: number;
}
const rateLimitMap = new Map<string, RateLimitData>();

async function checkRateLimit(
  _kv: KVNamespace,
  userId: string,
  maxRpm: number
): Promise<{ allowed: boolean; remaining: number }> {
  const window = Math.floor(Date.now() / 60_000);
  const current = rateLimitMap.get(userId);

  // Periodically clean up old entries in rateLimitMap to prevent memory leaks
  if (rateLimitMap.size > 2000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (val.window < window - 1) {
        rateLimitMap.delete(key);
      }
    }
  }

  if (current && current.window === window) {
    if (current.count >= maxRpm) return { allowed: false, remaining: 0 };
    current.count += 1;
    rateLimitMap.set(userId, current);
    return { allowed: true, remaining: maxRpm - current.count };
  } else {
    rateLimitMap.set(userId, { count: 1, window });
    return { allowed: true, remaining: maxRpm - 1 };
  }
}

/**
 * MCP handler — receives requests after OAuth validation.
 * The BPS API key is available in ctx.props.bpsApiKey (set during authorization).
 */
export const McpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Props injected by OAuthProvider into ctx
    const props = (ctx as unknown as { props?: { bpsApiKey?: string } }).props;
    let bpsApiKey: string | null = props?.bpsApiKey || null;

    // Fallback: also accept X-BPS-API-Key header for non-OAuth clients
    if (!bpsApiKey) {
      bpsApiKey = request.headers.get("x-bps-api-key");
    }

    if (!bpsApiKey) {
      return new Response(
        JSON.stringify({ error: "No BPS API key found in authorization context." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Rate limiting
    const maxRpm = parseInt(env.RATE_LIMIT_RPM || "", 10) || 60;
    const userId = `key:${bpsApiKey.substring(0, 8)}`;
    const { allowed, remaining } = await checkRateLimit(env.BPS_CACHE, userId, maxRpm);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Try again in 1 minute." }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }

    try {
      const config = loadWorkerConfig(env, bpsApiKey);
      const auth = new ApiKeyProvider(bpsApiKey);
      const cache = new KVCache(env.BPS_CACHE);
      const kvStore = new KVStore(env.BPS_CACHE);
      const { server } = createServer(config, auth, cache, kvStore, pkg.version);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      const response = await transport.handleRequest(request);
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      return response;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
