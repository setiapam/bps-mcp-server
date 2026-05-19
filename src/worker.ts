import OAuthProvider, { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { handleAuthorize } from "./auth/oauth-handler.js";
import { McpHandler } from "./worker-mcp.js";

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

      // Health check
      if (url.pathname === "/" || url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            name: "bps-mcp-server",
            version: "0.3.2",
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

      // Debug: test BPS API reachability from this worker
      if (url.pathname === "/debug-bps") {
        const testKey = url.searchParams.get("key") || "";
        const testUrl = `https://webapi.bps.go.id/v1/api/domain/type/all/lang/ind/key/${testKey}/`;
        try {
          const r = await fetch(testUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          const body = await r.text();
          return new Response(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: body.substring(0, 500) }), { headers: { "Content-Type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e) }), { headers: { "Content-Type": "application/json" } });
        }
      }

      // OAuth authorize endpoint
      if (url.pathname === "/authorize") {
        const oauthHelpers: OAuthHelpers = getOAuthApi(oauthOptions, env);
        return handleAuthorize(request, oauthHelpers);
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
