#!/usr/bin/env node

import { loadConfig } from "./config/index.js";
import { createAuthProvider } from "./auth/factory.js";
import { InMemoryCache } from "./services/cache.js";
import { createServer } from "./server.js";
import { startStdioTransport } from "./transport/stdio.js";
import { setLogLevel, logger } from "./utils/logger.js";

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
    const { server } = createServer(config, auth, cache);

    await startStdioTransport(server);
  } catch (error) {
    logger.error("Failed to start BPS MCP Server", error);
    process.exit(1);
  }
}

main();
