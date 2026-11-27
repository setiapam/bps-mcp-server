#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { loadConfig } from "./config/index.js";
import { createAuthProvider } from "./auth/factory.js";
import { InMemoryCache } from "./services/cache.js";
import { FileStore } from "./services/file-store.js";
import { createServer } from "./server.js";
import { startStdioTransport } from "./transport/stdio.js";
import { setLogLevel, logger } from "./utils/logger.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    logger.info(
      config.codeMode
        ? "BPS MCP Server starting in Code Mode (QuickJS sandbox)..."
        : "BPS MCP Server starting..."
    );
    logger.debug("Config loaded", {
      authType: config.authType,
      apiBaseUrl: config.apiBaseUrl,
      defaultLang: config.defaultLang,
      defaultDomain: config.defaultDomain,
      cacheEnabled: config.cacheEnabled,
      codeMode: config.codeMode,
    });

    const auth = createAuthProvider(config);
    const cache = config.cacheEnabled ? new InMemoryCache(config.cacheMaxEntries) : null;
    const store = new FileStore(undefined, config.apiKey);

    let server;
    if (config.codeMode) {
      // Lazy-load QuickJS WASM + Code Mode modules so standard stdio mode pays zero overhead.
      const [{ createCodeModeServer }, { QuickJSExecutor }, { readCodeModeLimitsFromEnv }] =
        await Promise.all([
          import("./codemode/server.js"),
          import("./codemode/quickjs-executor.js"),
          import("./codemode/executor.js"),
        ]);
      const executor = new QuickJSExecutor(readCodeModeLimitsFromEnv());
      ({ server } = createCodeModeServer(config, auth, cache, store, pkg.version, { executor }));
    } else {
      ({ server } = createServer(config, auth, cache, store, pkg.version));
    }

    // The learned-variable store writes with a debounce; flush it on shutdown
    // so mappings are not lost when the MCP client closes the process.
    const flushStore = (): void => {
      try {
        store.flushNow();
      } catch {
        // Best effort during shutdown.
      }
    };
    process.once("exit", flushStore);
    process.once("SIGINT", () => {
      flushStore();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      flushStore();
      process.exit(0);
    });

    await startStdioTransport(server);
  } catch (error) {
    logger.error("Failed to start BPS MCP Server", error);
    process.exit(1);
  }
}

main();
