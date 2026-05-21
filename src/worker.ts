import OAuthProvider, { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { handleAuthorize } from "./auth/oauth-handler.js";
import { McpHandler } from "./worker-mcp.js";
import { handleLearningApi } from "./api/learning-api.js";

// Wrangler bundles with esbuild which resolves JSON imports at build time
import pkg from "../package.json";

export interface Env {
  OAUTH_KV: KVNamespace;
  BPS_CACHE: KVNamespace;
  BPS_API_BASE_URL?: string;
  BPS_DEFAULT_LANG?: string;
  BPS_DEFAULT_DOMAIN?: string;
  BPS_LOG_LEVEL?: string;
  RATE_LIMIT_RPM?: string;
}

const oauthOptions = {
  apiRoute: "/mcp",
  apiHandler: McpHandler,
  defaultHandler: {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/" || url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            name: "bps-mcp-server",
            version: pkg.version,
            status: "ok",
            transport: "streamable-http",
            mcpEndpoint: "/mcp",
            auth: "OAuth 2.1 (MCP spec compliant)",
            tools: 36,
            docs: "https://github.com/setiapam/bps-mcp-server",
            getApiKey: "https://webapi.bps.go.id",
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.pathname === "/authorize") {
        const oauthHelpers: OAuthHelpers = getOAuthApi(oauthOptions, env);
        return handleAuthorize(request, oauthHelpers);
      }

      // Learning sync API
      if (url.pathname.startsWith("/api/learned-")) {
        return handleLearningApi(request, env.BPS_CACHE);
      }

      return new Response("Not found", { status: 404 });
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  accessTokenTTL: 3600,
  refreshTokenTTL: 7 * 24 * 3600,
  scopesSupported: ["bps:read"],
};

export default new OAuthProvider<Env>(oauthOptions);
