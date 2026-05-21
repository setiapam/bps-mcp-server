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

    logger.info("BPS MCP Server starting...");
    logger.debug("Config loaded", {
      authType: config.authType,
      apiBaseUrl: config.apiBaseUrl,
      defaultLang: config.defaultLang,
      defaultDomain: config.defaultDomain,
      cacheEnabled: config.cacheEnabled,
    });

    const auth = createAuthProvider(config);
    const cache = config.cacheEnabled ? new InMemoryCache(config.cacheMaxEntries) : null;
    const store = new FileStore();
    const { server } = createServer(config, auth, cache, store, pkg.version);

    await startStdioTransport(server);
  } catch (error) {
    logger.error("Failed to start BPS MCP Server", error);
    process.exit(1);
  }
}

main();
