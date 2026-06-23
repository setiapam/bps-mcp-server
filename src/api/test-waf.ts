import { getWafBlockedStatus, type RoutingEnv } from "../utils/routing-fallback.js";

const DIRECT_API_BASE = "https://webapi.bps.go.id/v1";
const PROXY_API_BASE = "https://bps-api.murphi.my.id/v1";
const TEST_PATH = "/api/list/model/subject/domain/0000/lang/ind/key/dummy_key/";

interface AccessResult {
  status: number;
  blocked: boolean;
  ok: boolean;
  snippet: string;
}

export async function handleTestWaf(env: RoutingEnv): Promise<Response> {
  const startDirect = Date.now();
  const directResult: AccessResult = await (async () => {
    try {
      const resDirect = await fetch(`${DIRECT_API_BASE}${TEST_PATH}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        },
      });
      const text = await resDirect.text();
      const isBlocked = resDirect.status === 403 || resDirect.status === 1020 || (!text.includes("message") && !text.includes("status"));
      return {
        status: resDirect.status,
        blocked: isBlocked,
        ok: resDirect.ok && !isBlocked,
        snippet: text.substring(0, 200),
      };
    } catch (error) {
      return {
        status: 0,
        blocked: true,
        ok: false,
        snippet: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  const directDuration = Date.now() - startDirect;

  const startProxy = Date.now();
  const proxyResult: AccessResult = await (async () => {
    try {
      const proxyBase = env.BPS_PROXY_API_BASE_URL || PROXY_API_BASE;
      const resProxy = await fetch(`${proxyBase}${TEST_PATH}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        },
      });
      const text = await resProxy.text();
      const isOk = resProxy.ok && (text.includes("message") || text.includes("status"));
      return {
        status: resProxy.status,
        blocked: !isOk,
        ok: isOk,
        snippet: text.substring(0, 200),
      };
    } catch (error) {
      return {
        status: 0,
        blocked: true,
        ok: false,
        snippet: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  const proxyDuration = Date.now() - startProxy;

  // Sync internal cache status
  const currentCachedStatus = getWafBlockedStatus();

  return new Response(
    JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      wafBlocked: directResult.blocked,
      currentCachedStatus: currentCachedStatus,
      directAccess: {
        url: `${DIRECT_API_BASE}${TEST_PATH}`,
        status: directResult.status,
        blocked: directResult.blocked,
        durationMs: directDuration,
        responseSnippet: directResult.snippet,
      },
      proxyAccess: {
        url: `${env.BPS_PROXY_API_BASE_URL || PROXY_API_BASE}${TEST_PATH}`,
        status: proxyResult.status,
        ok: proxyResult.ok,
        durationMs: proxyDuration,
        responseSnippet: proxyResult.snippet,
      },
      routingMode: directResult.blocked ? "proxy" : "direct",
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
