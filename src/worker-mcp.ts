import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiKeyProvider } from "./auth/api-key.provider.js";
import { loadWorkerConfig } from "./config/worker-config.js";
import { createServer } from "./server.js";
import { KVCache } from "./services/kv-cache.js";
import type { Env } from "./worker.js";

// Rate limiting (fixed window counter)
async function checkRateLimit(
  kv: KVNamespace,
  userId: string,
  maxRpm: number
): Promise<{ allowed: boolean; remaining: number }> {
  const window = Math.floor(Date.now() / 60_000);
  const key = `rl:${userId}:${window}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= maxRpm) return { allowed: false, remaining: 0 };
  await kv.put(key, String(count + 1), { expirationTtl: 120 });
  return { allowed: true, remaining: maxRpm - count - 1 };
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

    // Debug: log key info (remove after fixing)
    const keyInfo = `key_len=${bpsApiKey.length},prefix=${bpsApiKey.substring(0, 4)}`;

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
      const { server } = createServer(config, auth, cache);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      const response = await transport.handleRequest(request);
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      return response;
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? `${error.message} [${keyInfo}]` : "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
