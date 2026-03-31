import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiKeyProvider } from "./auth/api-key.provider.js";
import { loadWorkerConfig } from "./config/worker-config.js";
import { createServer } from "./server.js";
import { KVCache } from "./services/kv-cache.js";

export interface Env {
  BPS_CACHE: KVNamespace;
  BPS_API_KEY?: string;
  BPS_API_BASE_URL?: string;
  BPS_DEFAULT_LANG?: string;
  BPS_DEFAULT_DOMAIN?: string;
  BPS_LOG_LEVEL?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, X-BPS-API-Key, Mcp-Session-Id, Last-Event-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            name: "bps-mcp-server",
            version: "0.1.0",
            transport: "streamable-http",
            mcpEndpoint: "/mcp",
            docs: "https://github.com/setiapam/bps-mcp-server",
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      );
    }

    if (url.pathname === "/mcp") {
      const apiKey = request.headers.get("x-bps-api-key") || env.BPS_API_KEY;
      if (!apiKey) {
        return addCorsHeaders(
          new Response(
            JSON.stringify({
              error:
                "Missing BPS API key. Provide via X-BPS-API-Key header or configure BPS_API_KEY secret.",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          )
        );
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
        return addCorsHeaders(response);
      } catch (error) {
        return addCorsHeaders(
          new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Internal server error",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          )
        );
      }
    }

    return addCorsHeaders(new Response("Not found", { status: 404 }));
  },
};
