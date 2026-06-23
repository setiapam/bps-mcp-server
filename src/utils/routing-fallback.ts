let isWafBlocked: boolean | null = null;
let wafCheckPromise: Promise<boolean> | null = null;

const DIRECT_API_BASE = "https://webapi.bps.go.id/v1";
const PROXY_API_BASE = "https://bps-api.murphi.my.id/v1";

const DIRECT_ALLSTATS_BASE = "https://searchengine.web.bps.go.id";
const PROXY_ALLSTATS_BASE = "https://bps-api.murphi.my.id/allstats/";

export interface RoutingEnv {
  BPS_API_BASE_URL?: string;
  BPS_PROXY_API_BASE_URL?: string;
  BPS_DIRECT_API_BASE_URL?: string;
  BPS_ALLSTATS_BASE_URL?: string;
  BPS_PROXY_ALLSTATS_BASE_URL?: string;
  BPS_DIRECT_ALLSTATS_BASE_URL?: string;
}

export function getWafBlockedStatus(): boolean | null {
  return isWafBlocked;
}

export function setWafBlockedStatus(blocked: boolean): void {
  isWafBlocked = blocked;
}

/**
 * Tests direct connection to BPS WebAPI to check if WAF blocks us.
 * Returns true if blocked, false if accessible.
 */
export async function checkWafDirectly(): Promise<boolean> {
  const url = `${DIRECT_API_BASE}/api/domain/type/all/key/dummy_key/`;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000); // 4 seconds timeout

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(id);

    // If WAF blocks us (usually 403, 1020)
    if (res.status === 403 || res.status === 1020) {
      isWafBlocked = true;
      return true;
    }

    const text = await res.text();
    const isErrorOrValid = text.includes("message") || text.includes("status");
    if (isErrorOrValid) {
      isWafBlocked = false;
      return false;
    }

    // Cloudflare error or HTML page without JSON keys -> assume blocked
    isWafBlocked = true;
    return true;
  } catch {
    // Timeout or network error -> assume blocked
    isWafBlocked = true;
    return true;
  }
}

/**
 * Trigger background check if not yet checked.
 */
export function triggerBackgroundWafCheck(): void {
  if (isWafBlocked !== null || wafCheckPromise !== null) return;
  wafCheckPromise = checkWafDirectly().then((blocked) => {
    isWafBlocked = blocked;
    wafCheckPromise = null;
    return blocked;
  });
}

/**
 * Resolves the API base URL dynamically based on WAF status.
 */
export function getResolvedApiBaseUrl(env: RoutingEnv): string {
  // If BPS_API_BASE_URL is explicitly overridden to a custom value, respect it
  if (env.BPS_API_BASE_URL && env.BPS_API_BASE_URL !== DIRECT_API_BASE && env.BPS_API_BASE_URL !== PROXY_API_BASE) {
    return env.BPS_API_BASE_URL;
  }

  triggerBackgroundWafCheck();

  if (isWafBlocked === true) {
    return env.BPS_PROXY_API_BASE_URL || PROXY_API_BASE;
  }

  return env.BPS_DIRECT_API_BASE_URL || DIRECT_API_BASE;
}

/**
 * Resolves the AllStats base URL dynamically based on WAF status.
 */
export function getResolvedAllStatsBaseUrl(env: RoutingEnv): string {
  if (env.BPS_ALLSTATS_BASE_URL && env.BPS_ALLSTATS_BASE_URL !== DIRECT_ALLSTATS_BASE && env.BPS_ALLSTATS_BASE_URL !== PROXY_ALLSTATS_BASE) {
    return env.BPS_ALLSTATS_BASE_URL;
  }

  triggerBackgroundWafCheck();

  if (isWafBlocked === true) {
    return env.BPS_PROXY_ALLSTATS_BASE_URL || PROXY_ALLSTATS_BASE;
  }

  return env.BPS_DIRECT_ALLSTATS_BASE_URL || DIRECT_ALLSTATS_BASE;
}
