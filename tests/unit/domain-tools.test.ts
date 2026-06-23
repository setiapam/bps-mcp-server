import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDomainTools } from "../../src/tools/domain.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import type { DomainResolver } from "../../src/services/domain-resolver.js";

function createMockClient(): BpsClient {
  return {
    listDomains: vi.fn().mockResolvedValue({ data: [] }),
  } as unknown as BpsClient;
}

function createMockResolver(): DomainResolver {
  return {} as unknown as DomainResolver;
}

describe("domain tools", () => {
  let server: McpServer;
  let mockClient: BpsClient;
  let mockResolver: DomainResolver;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0" });
    mockClient = createMockClient();
    mockResolver = createMockResolver();
    registerDomainTools(server, mockClient, mockResolver);
  });

  it("should validate and fail when type='kabbyprov' and prov is missing", async () => {
    const tool = (server as any)._registeredTools?.list_domains;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      type: "kabbyprov",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("prov");
    expect(mockClient.listDomains).not.toHaveBeenCalled();
  });
});
