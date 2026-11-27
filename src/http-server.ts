import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ApiKeyProvider } from "./auth/api-key.provider.js";
import type { Config } from "./config/index.js";
import { DEFAULTS } from "./config/defaults.js";
import { InMemoryCache, type ICacheProvider } from "./services/cache.js";
import { FileStore } from "./services/file-store.js";
import type { IPersistentStore } from "./services/persistent-store.js";
import { createCodeModeServer } from "./codemode/server.js";
import {
  readCodeModeLimitsFromEnv,
  type CodeExecutor,
  type ExecuteOptions,
} from "./codemode/executor.js";
import { ensureQuickJSReady, QuickJSExecutor } from "./codemode/quickjs-executor.js";
import { logger, setLogLevel } from "./utils/logger.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  version: string;
};

const MAX_BODY_BYTES = 256 * 1024; // 256 KB
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_CONCURRENT = 8;

export interface CodeModeHttpServerOptions {
  sharedSecret?: string;
  maxConcurrent?: number;
  maxBodyBytes?: number;
  apiBaseUrl?: string;
  allStatsBaseUrl?: string;
  defaultLang?: "ind" | "eng";
  defaultDomain?: string;
  cacheEnabled?: boolean;
  cacheMaxEntries?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  dataDir?: string;
  workerUrl?: string;
  syncApiKey?: string;
  version?: string;
  cache?: ICacheProvider | null;
  store?: IPersistentStore | null;
  executor?: CodeExecutor;
  executeOptions?: ExecuteOptions;
}

/**
 * Constant-time secret check using SHA-256 digests so length differences never leak.
 */
export function verifySharedSecret(provided: string | null | undefined, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload, "utf8"),
    ...extraHeaders,
  });
  res.end(payload);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds maximum allowed size.");
    this.name = "PayloadTooLargeError";
  }
}

class InvalidJsonError extends Error {
  constructor() {
    super("Invalid JSON request body.");
    this.name = "InvalidJsonError";
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentLengthHeader = req.headers["content-length"];
  if (contentLengthHeader) {
    const declared = Number.parseInt(
      Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader,
      10
    );
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      throw new PayloadTooLargeError();
    }
  }

  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        settled = true;
        req.pause();
        rejectBody(new PayloadTooLargeError());
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolveBody(undefined);
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new InvalidJsonError());
      }
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      rejectBody(err);
    });
  });
}

function getHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

export interface CodeModeHttpApp {
  server: Server;
  flushStore: () => void;
}

export function createCodeModeHttpServer(
  options: CodeModeHttpServerOptions = {}
): CodeModeHttpApp {
  const sharedSecret = options.sharedSecret ?? process.env.CODEMODE_SHARED_SECRET ?? "";
  const maxConcurrent =
    options.maxConcurrent ??
    (Number.parseInt(process.env.CODEMODE_MAX_CONCURRENT || "", 10) || DEFAULT_MAX_CONCURRENT);
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const apiBaseUrl = options.apiBaseUrl ?? process.env.BPS_API_BASE_URL ?? DEFAULTS.API_BASE_URL;
  const allStatsBaseUrl = options.allStatsBaseUrl ?? process.env.BPS_ALLSTATS_BASE_URL;
  const defaultLang = (options.defaultLang ??
    process.env.BPS_DEFAULT_LANG ??
    DEFAULTS.DEFAULT_LANG) as "ind" | "eng";
  const defaultDomain =
    options.defaultDomain ?? process.env.BPS_DEFAULT_DOMAIN ?? DEFAULTS.DEFAULT_DOMAIN;
  const cacheEnabled =
    options.cacheEnabled ?? process.env.BPS_CACHE_ENABLED !== "false";
  const cacheMaxEntries =
    options.cacheMaxEntries ??
    (Number.parseInt(process.env.BPS_CACHE_MAX_ENTRIES || "", 10) || DEFAULTS.CACHE_MAX_ENTRIES);
  const logLevel = (options.logLevel ??
    process.env.BPS_LOG_LEVEL ??
    DEFAULTS.LOG_LEVEL) as "debug" | "info" | "warn" | "error";
  const version = options.version ?? pkg.version;

  setLogLevel(logLevel);

  const cache: ICacheProvider | null =
    options.cache !== undefined
      ? options.cache
      : cacheEnabled
        ? new InMemoryCache(cacheMaxEntries)
        : null;

  // Do NOT bind a per-user API key to the shared FileStore; only use an explicit sync key if configured.
  const ownedFileStore =
    options.store === undefined
      ? new FileStore(
          options.workerUrl ?? process.env.BPS_WORKER_URL ?? "",
          options.syncApiKey ?? process.env.BPS_SYNC_API_KEY ?? "",
          options.dataDir ?? process.env.BPS_DATA_DIR
        )
      : null;
  const store: IPersistentStore | null = options.store !== undefined ? options.store : ownedFileStore;

  const executeOptions: ExecuteOptions = {
    ...readCodeModeLimitsFromEnv(),
    ...options.executeOptions,
  };
  const executor: CodeExecutor = options.executor ?? new QuickJSExecutor(executeOptions);

  let activeRequests = 0;

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const method = (req.method || "GET").toUpperCase();

    // Liveness probe
    if (url.pathname === "/healthz" && method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        service: "bps-mcp-codemode",
        version,
      });
      return;
    }

    // Readiness probe — ensures QuickJS WASM initializes cleanly
    if (url.pathname === "/readyz" && method === "GET") {
      try {
        await ensureQuickJSReady();
        sendJson(res, 200, {
          status: "ready",
          quickjs: true,
          activeRequests,
          maxConcurrent,
        });
      } catch (error) {
        sendJson(res, 503, {
          status: "not_ready",
          error: error instanceof Error ? error.message : "QuickJS failed to initialize",
        });
      }
      return;
    }

    if (url.pathname !== "/mcp/code") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      sendJson(res, 405, { error: "Method not allowed" }, { Allow: "POST, GET, DELETE" });
      return;
    }

    // 1. Fail-closed shared secret authentication
    const providedSecret = getHeader(req, "x-codemode-secret");
    if (!verifySharedSecret(providedSecret, sharedSecret)) {
      sendJson(res, 401, { error: "Unauthorized: invalid or missing X-CodeMode-Secret." });
      return;
    }

    // 2. Per-request BYOK BPS API key (never persisted to disk)
    const bpsApiKey = getHeader(req, "x-bps-api-key")?.trim();
    if (!bpsApiKey) {
      sendJson(res, 401, { error: "Unauthorized: missing X-BPS-API-Key header." });
      return;
    }

    // 3. Concurrency limiter
    if (activeRequests >= maxConcurrent) {
      sendJson(
        res,
        429,
        { error: "Too many concurrent Code Mode requests. Try again shortly." },
        { "Retry-After": "5" }
      );
      return;
    }

    activeRequests++;
    let transport: StreamableHTTPServerTransport | null = null;
    let mcpServer: ReturnType<typeof createCodeModeServer>["server"] | null = null;

    try {
      let parsedBody: unknown;
      if (method === "POST") {
        parsedBody = await readJsonBody(req, maxBodyBytes);
      }

      const config: Config = {
        authType: "api-key",
        apiKey: bpsApiKey,
        apiBaseUrl,
        allStatsBaseUrl,
        defaultLang,
        defaultDomain,
        cacheEnabled,
        cacheMaxEntries,
        logLevel,
        codeMode: true,
      };

      const auth = new ApiKeyProvider(bpsApiKey);
      ({ server: mcpServer } = createCodeModeServer(config, auth, cache, store, version, {
        executor,
        executeOptions,
      }));

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        if (!res.headersSent) {
          sendJson(res, 413, { error: `Request body exceeds ${maxBodyBytes} byte limit.` });
        }
        return;
      }
      if (error instanceof InvalidJsonError) {
        if (!res.headersSent) {
          sendJson(res, 400, { error: "Invalid JSON payload." });
        }
        return;
      }
      logger.error("Code Mode HTTP request error", error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : "Internal server error",
        });
      }
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
      try {
        await transport?.close();
      } catch {
        // Ignore close errors
      }
      try {
        await mcpServer?.close();
      } catch {
        // Ignore close errors
      }
    }
  });

  const flushStore = (): void => {
    try {
      ownedFileStore?.flushNow();
    } catch {
      // Best-effort flush on shutdown
    }
  };

  return { server, flushStore };
}

function isMainEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainEntrypoint()) {
  const port = Number.parseInt(process.env.PORT || "", 10) || DEFAULT_PORT;
  const host = process.env.HOST || "0.0.0.0";

  if (!process.env.CODEMODE_SHARED_SECRET) {
    logger.warn(
      "CODEMODE_SHARED_SECRET is not set — /mcp/code will reject all requests (fail-closed) until configured."
    );
  }

  const { server, flushStore } = createCodeModeHttpServer();

  server.listen(port, host, () => {
    logger.info(`BPS MCP Code Mode HTTP server listening on http://${host}:${port}/mcp/code`);
  });

  // Warm up QuickJS WASM asynchronously in the background
  void ensureQuickJSReady().catch((err) => {
    logger.error("Failed to warm up QuickJS WASM", err);
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down Code Mode HTTP server...`);
    flushStore();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
