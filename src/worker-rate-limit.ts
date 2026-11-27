import { hashKey } from "./auth/oauth-handler.js";
import type { Env } from "./worker.js";

// Rate limiting (in-memory fixed-window to avoid KV PUT operations and O(N) cleanup)
let currentWindow = 0;
const rateLimitMap = new Map<string, number>();

export async function checkWorkerRateLimit(
  userId: string,
  maxRpm: number
): Promise<{ allowed: boolean; remaining: number }> {
  const window = Math.floor(Date.now() / 60_000);

  if (window !== currentWindow) {
    rateLimitMap.clear();
    currentWindow = window;
  }

  const count = rateLimitMap.get(userId) || 0;
  if (count >= maxRpm) return { allowed: false, remaining: 0 };

  const newCount = count + 1;
  rateLimitMap.set(userId, newCount);
  return { allowed: true, remaining: maxRpm - newCount };
}

/** Reset in-memory rate limit counters (for unit tests). */
export function resetWorkerRateLimit(): void {
  rateLimitMap.clear();
  currentWindow = 0;
}

export type WorkerAuthOutcome =
  | { ok: true; bpsApiKey: string; remaining: number }
  | { ok: false; response: Response };

/**
 * Extract the user's BPS API key from OAuth props (or X-BPS-API-Key header)
 * and enforce the shared per-key RPM rate limit.
 */
export async function enforceWorkerAuthAndRateLimit(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<WorkerAuthOutcome> {
  const props = (ctx as unknown as { props?: { bpsApiKey?: string } }).props;
  let bpsApiKey: string | null = props?.bpsApiKey || null;

  if (!bpsApiKey) {
    bpsApiKey = request.headers.get("x-bps-api-key");
  }

  if (!bpsApiKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "No BPS API key found in authorization context." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const maxRpm = parseInt(env.RATE_LIMIT_RPM || "", 10) || 60;
  // Hash the full key instead of using its first 8 characters: short
  // prefixes collide, which would share a rate-limit bucket between users.
  const userId = `key:${(await hashKey(bpsApiKey)).slice(0, 16)}`;
  const { allowed, remaining } = await checkWorkerRateLimit(userId, maxRpm);
  if (!allowed) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Too many requests. Try again in 1 minute." }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }
      ),
    };
  }

  return { ok: true, bpsApiKey, remaining };
}
