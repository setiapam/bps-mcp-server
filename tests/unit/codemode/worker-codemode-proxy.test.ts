import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@cloudflare/workers-oauth-provider", () => ({
  default: class MockOAuthProvider {
    constructor(public options: unknown) {}
  },
  getOAuthApi: vi.fn(),
}));

import { CodeModeProxyHandler } from "../../../src/worker-codemode-proxy.js";
import { resetWorkerRateLimit } from "../../../src/worker-rate-limit.js";
import { oauthOptions, type Env } from "../../../src/worker.js";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    OAUTH_KV: {} as KVNamespace,
    BPS_CACHE: {} as KVNamespace,
    CODEMODE_BACKEND_URL: "https://bps-codemode.example.com",
    CODEMODE_SHARED_SECRET: "super-secret-token",
    RATE_LIMIT_RPM: "60",
    ...overrides,
  };
}

function makeCtx(bpsApiKey?: string): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: bpsApiKey ? { bpsApiKey } : undefined,
  } as unknown as ExecutionContext;
}

describe("Worker Code Mode Proxy (Pattern A)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetWorkerRateLimit();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("declares /mcp/code BEFORE /mcp in oauthOptions.apiHandlers so startsWith() matches correctly", () => {
    const routes = Object.keys(oauthOptions.apiHandlers);
    expect(routes.indexOf("/mcp/code")).toBeGreaterThanOrEqual(0);
    expect(routes.indexOf("/mcp")).toBeGreaterThanOrEqual(0);
    expect(routes.indexOf("/mcp/code")).toBeLessThan(routes.indexOf("/mcp"));
  });

  it("reports codeModeEndpoint and codeModeEnabled on /health", async () => {
    const resEnabled = await oauthOptions.defaultHandler.fetch(
      new Request("https://worker.example.com/health"),
      makeEnv({ CODEMODE_BACKEND_URL: "https://bps-codemode.example.com" })
    );
    const jsonEnabled = (await resEnabled.json()) as {
      codeModeEndpoint: string;
      codeModeEnabled: boolean;
    };
    expect(jsonEnabled.codeModeEndpoint).toBe("/mcp/code");
    expect(jsonEnabled.codeModeEnabled).toBe(true);

    const resDisabled = await oauthOptions.defaultHandler.fetch(
      new Request("https://worker.example.com/health"),
      makeEnv({ CODEMODE_BACKEND_URL: undefined })
    );
    const jsonDisabled = (await resDisabled.json()) as { codeModeEnabled: boolean };
    expect(jsonDisabled.codeModeEnabled).toBe(false);
  });

  it("forwards OAuth bpsApiKey, injects X-CodeMode-Secret and optional CF Access headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = new Request("https://worker.example.com/mcp/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": "sess-1",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    const env = makeEnv({
      CODEMODE_BACKEND_URL: "https://bps-codemode.example.com/",
      CF_ACCESS_CLIENT_ID: "cf-id",
      CF_ACCESS_CLIENT_SECRET: "cf-secret",
    });

    const res = await CodeModeProxyHandler.fetch(req, env, makeCtx("oauth-user-bps-key"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("59");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [targetUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(targetUrl).toBe("https://bps-codemode.example.com/mcp/code");
    expect(init.method).toBe("POST");

    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.get("x-bps-api-key")).toBe("oauth-user-bps-key");
    expect(sentHeaders.get("x-codemode-secret")).toBe("super-secret-token");
    expect(sentHeaders.get("cf-access-client-id")).toBe("cf-id");
    expect(sentHeaders.get("cf-access-client-secret")).toBe("cf-secret");
    expect(sentHeaders.get("mcp-session-id")).toBe("sess-1");
  });

  it("returns 401 when no BPS API key is present", async () => {
    const req = new Request("https://worker.example.com/mcp/code", { method: "POST" });
    const res = await CodeModeProxyHandler.fetch(req, makeEnv(), makeCtx(undefined));
    expect(res.status).toBe(401);
  });

  it("returns informative 503 with /mcp fallback when CODEMODE_BACKEND_URL is unset", async () => {
    const req = new Request("https://worker.example.com/mcp/code", { method: "POST" });
    const res = await CodeModeProxyHandler.fetch(
      req,
      makeEnv({ CODEMODE_BACKEND_URL: undefined }),
      makeCtx("user-key")
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { fallback: string; error: string };
    expect(body.fallback).toBe("/mcp");
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns informative 503 when homelab backend is offline or returns 502", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) as unknown as typeof fetch;

    const req1 = new Request("https://worker.example.com/mcp/code", { method: "POST", body: "{}" });
    const res1 = await CodeModeProxyHandler.fetch(req1, makeEnv(), makeCtx("user-key"));
    expect(res1.status).toBe(503);
    const json1 = (await res1.json()) as { fallback: string };
    expect(json1.fallback).toBe("/mcp");

    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })) as unknown as typeof fetch;
    const req2 = new Request("https://worker.example.com/mcp/code", { method: "POST", body: "{}" });
    const res2 = await CodeModeProxyHandler.fetch(req2, makeEnv(), makeCtx("user-key"));
    expect(res2.status).toBe(503);
    const json2 = (await res2.json()) as { fallback: string; error: string };
    expect(json2.fallback).toBe("/mcp");
    expect(json2.error).toContain("502");
  });

  it("enforces RATE_LIMIT_RPM across requests", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
    ) as unknown as typeof fetch;

    const env = makeEnv({ RATE_LIMIT_RPM: "1" });
    const first = await CodeModeProxyHandler.fetch(
      new Request("https://worker.example.com/mcp/code", { method: "POST", body: "{}" }),
      env,
      makeCtx("same-user-key")
    );
    expect(first.status).toBe(200);

    const second = await CodeModeProxyHandler.fetch(
      new Request("https://worker.example.com/mcp/code", { method: "POST", body: "{}" }),
      env,
      makeCtx("same-user-key")
    );
    expect(second.status).toBe(429);
  });
});
