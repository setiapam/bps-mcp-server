import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config/index.js";
import type { IAuthProvider } from "../auth/types.js";
import type { ICacheProvider } from "../services/cache.js";
import type { IPersistentStore } from "../services/persistent-store.js";
import { BpsClient } from "../client/bps-client.js";
import { AllStatsClient } from "../client/allstats-client.js";
import { DomainResolver } from "../services/domain-resolver.js";
import { appendAttribution } from "../services/attribution.js";
import { registerResources } from "../resources/domain.resources.js";
import { registerPrompts } from "../prompts/analysis.prompts.js";
import {
  readCodeModeLimitsFromEnv,
  type CodeExecutor,
  type ExecuteOptions,
} from "./executor.js";
import { createBpsCodeApi } from "./bps-api.js";
import {
  CODE_MODE_SERVER_INSTRUCTIONS,
  EXECUTE_BPS_CODE_DESCRIPTION,
} from "./types-doc.js";

export interface CreateCodeModeServerOptions {
  executor: CodeExecutor;
  executeOptions?: ExecuteOptions;
}

/**
 * Create a Code Mode MCP server exposing the single `execute_bps_code` tool
 * backed by all 39 BPS API methods + resources & prompts.
 *
 * Accepts any `CodeExecutor` (QuickJSExecutor locally/k3s, or a future
 * Cloudflare DynamicWorkerExecutor) so this module stays WASM-free.
 */
export function createCodeModeServer(
  config: Config,
  auth: IAuthProvider,
  cache: ICacheProvider | null,
  store?: IPersistentStore | null,
  version?: string,
  options?: CreateCodeModeServerOptions
): { server: McpServer; client: BpsClient; resolver: DomainResolver } {
  if (!options?.executor) {
    throw new Error("createCodeModeServer requires an executor instance.");
  }

  const server = new McpServer(
    {
      name: "bps-statistics",
      version: version || "0.0.0",
    },
    {
      instructions: CODE_MODE_SERVER_INSTRUCTIONS,
    }
  );

  const client = new BpsClient(auth, cache, config);
  const allStatsClient = new AllStatsClient(cache, config.allStatsBaseUrl);
  const resolver = new DomainResolver(client);

  const bpsFns = createBpsCodeApi({
    client,
    allStatsClient,
    resolver,
    config,
    cache,
    store: store ?? null,
  });

  const limits = {
    ...readCodeModeLimitsFromEnv(),
    ...options.executeOptions,
  };

  server.tool(
    "execute_bps_code",
    EXECUTE_BPS_CODE_DESCRIPTION,
    {
      code: z
        .string()
        .min(1)
        .describe("Skrip JavaScript asinkron terhadap objek global `bps` (ES2022+)."),
    },
    async ({ code }) => {
      const execResult = await options.executor.execute(code, bpsFns, limits);

      if (execResult.error) {
        const errorPayload: Record<string, unknown> = {
          error: execResult.error,
          meta: {
            durationMs: execResult.durationMs,
            callsUsed: execResult.callsUsed,
            truncated: Boolean(execResult.truncated),
          },
        };
        if (execResult.logs.length > 0) {
          errorPayload.logs = execResult.logs;
        }
        return {
          content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
          isError: true,
        };
      }

      const payload: Record<string, unknown> = {
        result: execResult.result ?? null,
      };
      if (execResult.logs.length > 0) {
        payload.logs = execResult.logs;
      }
      payload.meta = {
        durationMs: execResult.durationMs,
        callsUsed: execResult.callsUsed,
        truncated: Boolean(execResult.truncated),
      };

      const text = appendAttribution(JSON.stringify(payload, null, 2), config.defaultLang);
      return {
        content: [{ type: "text", text }],
      };
    }
  );

  registerResources(server, client, resolver);
  registerPrompts(server);

  return { server, client, resolver };
}
