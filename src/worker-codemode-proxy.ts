import { enforceWorkerAuthAndRateLimit } from "./worker-rate-limit.js";
import type { Env } from "./worker.js";

const PROXY_TIMEOUT_MS = 35_000;

const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "mcp-session-id",
  "last-event-id",
  "mcp-protocol-version",
];

function unavailableResponse(error: string): Response {
  return new Response(
    JSON.stringify({
      error,
      fallback: "/mcp",
      hint: "Standard MCP endpoint /mcp (39 tools) remains fully available at the Cloudflare edge.",
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "30",
      },
    }
  );
}

/**
 * Pattern A proxy handler for `/mcp/code` on Cloudflare Workers Free Plan.
 *
 * Validates OAuth 2.1 + shared rate limiting at the edge, then forwards the
 * Streamable HTTP MCP request through Cloudflare Tunnel to the k3s homelab pod
 * running the QuickJS WASM sandbox — keeping the Worker Free bundle 100% WASM-free.
 */
export const CodeModeProxyHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const authOutcome = await enforceWorkerAuthAndRateLimit(request, env, ctx);
    if (!authOutcome.ok) return authOutcome.response;
    const { bpsApiKey, remaining } = authOutcome;

    const backendUrl = env.CODEMODE_BACKEND_URL?.trim().replace(/\/+$/, "");
    if (!backendUrl) {
      return unavailableResponse(
        "Code Mode backend is not configured on this Worker."
      );
    }

    const sharedSecret = env.CODEMODE_SHARED_SECRET?.trim();
    if (!sharedSecret) {
      return unavailableResponse(
        "Code Mode backend authentication is not configured."
      );
    }

    const incomingUrl = new URL(request.url);
    const targetUrl = `${backendUrl}/mcp/code${incomingUrl.search}`;

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("X-BPS-API-Key", bpsApiKey);
    headers.set("X-CodeMode-Secret", sharedSecret);

    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID);
      headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
    }

    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    try {
      const upstream = await fetch(targetUrl, {
        method,
        headers,
        body: hasBody ? request.body : undefined,
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });

      // Cloudflare Tunnel returns 502/503/504 (or 530) when the homelab pod is offline
      if (
        upstream.status === 502 ||
        upstream.status === 503 ||
        upstream.status === 504 ||
        upstream.status === 530
      ) {
        return unavailableResponse(
          `Code Mode backend is currently unreachable (upstream HTTP ${upstream.status}).`
        );
      }

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("X-RateLimit-Remaining", String(remaining));

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const reason =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? `timed out after ${PROXY_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : "network error";
      return unavailableResponse(
        `Code Mode backend is currently unavailable (${reason}).`
      );
    }
  },
};
