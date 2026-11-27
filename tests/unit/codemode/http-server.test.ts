import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createCodeModeHttpServer, verifySharedSecret } from "../../../src/http-server.js";
import type { CodeExecutor } from "../../../src/codemode/executor.js";
import { QuickJSExecutor } from "../../../src/codemode/quickjs-executor.js";

async function startTestServer(
  options: Parameters<typeof createCodeModeHttpServer>[0] = {}
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = createCodeModeHttpServer({
    store: null,
    cache: null,
    logLevel: "error",
    ...options,
  });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const addr = app.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        app.server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

function parseMcpResponse(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  // StreamableHTTP may respond as SSE (`event: message\ndata: {...}`)
  const dataLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`Unexpected MCP HTTP response: ${text}`);
  }
  return JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>;
}

describe("Code Mode HTTP server (k3s backend)", () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
  });

  it("verifySharedSecret uses constant-time comparison and rejects empty/mismatched secrets", () => {
    expect(verifySharedSecret("secret-123", "secret-123")).toBe(true);
    expect(verifySharedSecret("secret-124", "secret-123")).toBe(false);
    expect(verifySharedSecret("short", "much-longer-secret")).toBe(false);
    expect(verifySharedSecret("", "secret-123")).toBe(false);
    expect(verifySharedSecret("secret-123", "")).toBe(false);
    expect(verifySharedSecret(null, "secret-123")).toBe(false);
  });

  it("serves /healthz and /readyz probes", async () => {
    const srv = await startTestServer({ sharedSecret: "topsecret" });
    closeServer = srv.close;

    const health = await fetch(`${srv.baseUrl}/healthz`);
    expect(health.status).toBe(200);
    const healthJson = (await health.json()) as { status: string };
    expect(healthJson.status).toBe("ok");

    const ready = await fetch(`${srv.baseUrl}/readyz`);
    expect(ready.status).toBe(200);
    const readyJson = (await ready.json()) as { status: string; quickjs: boolean };
    expect(readyJson.status).toBe("ready");
    expect(readyJson.quickjs).toBe(true);
  });

  it("fails closed when sharedSecret is unset and rejects invalid secret or missing API key", async () => {
    const failClosed = await startTestServer({ sharedSecret: "" });
    closeServer = failClosed.close;

    const r0 = await fetch(`${failClosed.baseUrl}/mcp/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BPS-API-Key": "user-key",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r0.status).toBe(401);
    await failClosed.close();
    closeServer = null;

    const srv = await startTestServer({ sharedSecret: "s3cr3t" });
    closeServer = srv.close;

    const badSecret = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CodeMode-Secret": "wrong",
        "X-BPS-API-Key": "user-key",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(badSecret.status).toBe(401);

    const missingKey = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CodeMode-Secret": "s3cr3t",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(missingKey.status).toBe(401);
  });

  it("rejects payloads larger than maxBodyBytes with 413", async () => {
    const srv = await startTestServer({ sharedSecret: "s3cr3t", maxBodyBytes: 256 });
    closeServer = srv.close;

    const res = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CodeMode-Secret": "s3cr3t",
        "X-BPS-API-Key": "user-key",
      },
      body: JSON.stringify({ padding: "x".repeat(500) }),
    });
    expect(res.status).toBe(413);
  });

  it("enforces maxConcurrent limit with 429", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const slowExecutor: CodeExecutor = {
      execute: async () => {
        await gate;
        return { result: { ok: true }, logs: [], callsUsed: 0, durationMs: 5 };
      },
    };

    const srv = await startTestServer({
      sharedSecret: "s3cr3t",
      maxConcurrent: 1,
      executor: slowExecutor,
    });
    closeServer = srv.close;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-CodeMode-Secret": "s3cr3t",
      "X-BPS-API-Key": "user-key",
    };

    const callBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "execute_bps_code", arguments: { code: "return 1;" } },
    });

    const firstPromise = fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers,
      body: callBody,
    });

    // Give the first request a tick to enter activeRequests
    await new Promise((r) => setTimeout(r, 30));

    const second = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers,
      body: callBody,
    });
    expect(second.status).toBe(429);

    releaseFirst();
    const first = await firstPromise;
    expect(first.status).toBe(200);
  });

  it("handles Streamable HTTP initialize -> tools/list (1 tool) -> tools/call end-to-end", async () => {
    const srv = await startTestServer({
      sharedSecret: "s3cr3t",
      executor: new QuickJSExecutor(),
    });
    closeServer = srv.close;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-CodeMode-Secret": "s3cr3t",
      "X-BPS-API-Key": "user-key",
    };

    // 1. initialize
    const initRes = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initPayload = parseMcpResponse(await initRes.text()) as {
      result?: { serverInfo?: { name: string } };
    };
    expect(initPayload.result?.serverInfo?.name).toBe("bps-statistics");

    // 2. tools/list -> must expose only execute_bps_code
    const listRes = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(listRes.status).toBe(200);
    const listPayload = parseMcpResponse(await listRes.text()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    expect(listPayload.result?.tools?.map((t) => t.name)).toEqual(["execute_bps_code"]);

    // 3. tools/call -> execute JS inside QuickJS sandbox calling bps.help()
    const callRes = await fetch(`${srv.baseUrl}/mcp/code`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "execute_bps_code",
          arguments: {
            code: `const info = await bps.help("getRanking"); return { method: info.method, sum: 20 + 22 };`,
          },
        },
      }),
    });
    expect(callRes.status).toBe(200);
    const callPayload = parseMcpResponse(await callRes.text()) as {
      result?: { content?: Array<{ text: string }>; isError?: boolean };
    };
    expect(callPayload.result?.isError).toBeFalsy();
    const text = callPayload.result?.content?.[0]?.text ?? "";
    expect(text).toContain('"method": "getRanking"');
    expect(text).toContain('"sum": 42');
    expect(text).toContain("Badan Pusat Statistik");
  });
});
