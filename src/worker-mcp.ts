import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiKeyProvider } from "./auth/api-key.provider.js";
import { loadWorkerConfig } from "./config/worker-config.js";
import { createServer } from "./server.js";
import { KVCache } from "./services/kv-cache.js";
import { KVStore } from "./services/kv-store.js";
import { enforceWorkerAuthAndRateLimit } from "./worker-rate-limit.js";
import pkg from "../package.json";
import type { Env } from "./worker.js";

/**
 * MCP handler — receives requests after OAuth validation.
 * The BPS API key is available in ctx.props.bpsApiKey (set during authorization).
 */
export const McpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const authOutcome = await enforceWorkerAuthAndRateLimit(request, env, ctx);
    if (!authOutcome.ok) return authOutcome.response;
    const { bpsApiKey, remaining } = authOutcome;

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
