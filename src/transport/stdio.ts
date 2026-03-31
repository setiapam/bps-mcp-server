import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";

export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  logger.info("Starting BPS MCP Server (stdio transport)");

  await server.connect(transport);

  logger.info("BPS MCP Server connected via stdio");
}
