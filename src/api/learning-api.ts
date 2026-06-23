import { validateBpsApiKey, hashKey } from "../auth/oauth-handler.js";

const LEARN_PREFIX = "learn:";
const PERIOD_PREFIX = "learn:period:";
const JSON_HEADERS = { "Content-Type": "application/json" };

async function validateAndCacheApiKey(apiKey: string, kv: KVNamespace): Promise<boolean> {
  const hash = await hashKey(apiKey);
  const cacheKey = `valid-key:${hash}`;

  try {
    const cached = await kv.get(cacheKey);
    if (cached === "true") return true;
    if (cached === "false") return false;
  } catch {
    // Ignore cache get errors
  }

  const isValid = await validateBpsApiKey(apiKey);

  try {
    // Cache validation result: 7 days for valid, 1 hour for invalid keys
    await kv.put(cacheKey, String(isValid), { expirationTtl: isValid ? 7 * 24 * 3600 : 3600 });
  } catch {
    // Ignore cache write errors
  }

  return isValid;
}

/**
 * Handles /api/learned-vars and /api/learned-periods endpoints.
 * GET → return all entries; POST → add/update a single entry.
 */
export async function handleLearningApi(request: Request, kv: KVNamespace): Promise<Response> {
  const apiKey = request.headers.get("x-bps-api-key");
  if (!apiKey || apiKey.length < 20) {
    return new Response(JSON.stringify({ error: "Unauthorized: Missing or invalid BPS API key" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const isValid = await validateAndCacheApiKey(apiKey, kv);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid BPS API key" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/learned-vars") {
    return request.method === "GET"
      ? getAllEntries(kv, LEARN_PREFIX, PERIOD_PREFIX)
      : request.method === "POST"
        ? putEntry(request, kv, LEARN_PREFIX)
        : methodNotAllowed();
  }

  if (path === "/api/learned-periods") {
    return request.method === "GET"
      ? getAllEntries(kv, PERIOD_PREFIX)
      : request.method === "POST"
        ? putEntry(request, kv, PERIOD_PREFIX)
        : methodNotAllowed();
  }

  return new Response("Not found", { status: 404 });
}

async function getAllEntries(kv: KVNamespace, prefix: string, excludePrefix?: string): Promise<Response> {
  const entries: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix, cursor });
    for (const key of list.keys) {
      // For learned-vars, exclude period entries
      if (excludePrefix && key.name.startsWith(excludePrefix)) continue;
      const val = await kv.get(key.name);
      if (val) entries[key.name.slice(prefix.length)] = val;
    }
    cursor = list.list_complete ? undefined : (list.cursor as string);
  } while (cursor);
  return new Response(JSON.stringify({ entries }), { headers: JSON_HEADERS });
}

async function putEntry(request: Request, kv: KVNamespace, prefix: string): Promise<Response> {
  try {
    const body = await request.json() as { key?: string; value?: unknown };
    if (!body.key || body.value === undefined) {
      return new Response(JSON.stringify({ error: "key and value required" }), { status: 400, headers: JSON_HEADERS });
    }
    const valueStr = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
    await kv.put(prefix + body.key, valueStr);
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: JSON_HEADERS });
  }
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", { status: 405 });
}
