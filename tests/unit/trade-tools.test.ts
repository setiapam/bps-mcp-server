import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTradeTools } from "../../src/tools/trade.tools.js";
import type { BpsClient } from "../../src/client/bps-client.js";
import { BpsNotFoundError } from "../../src/utils/error.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ text: string }>;
    isError?: boolean;
  }>;
};

const COFFEE_ROW = {
  jenishs: "hs2022",
  value: 248.775,
  netweight: 28,
  kodehs: "[09] Kopi, teh, dan rempah-rempah",
  pod: "ACHMAD YANI (U)",
  ctr: "Jepang",
  tahun: 2024,
};

function createClient(): BpsClient {
  return {
    getTradeData: vi.fn().mockImplementation(async (_source, code, hsType) => {
      if (code === "0901" && hsType === "2") {
        throw new BpsNotFoundError("trade:1:0901:2:2024:2");
      }
      if (code === "09") return { data: [COFFEE_ROW] };
      return { data: [] };
    }),
  } as unknown as BpsClient;
}

function registered(client: BpsClient): RegisteredTool {
  const server = new McpServer({ name: "test", version: "1.0" });
  registerTradeTools(server, client);
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools.get_trade_data;
}

describe("get_trade_data", () => {
  let client: BpsClient;

  beforeEach(() => {
    client = createClient();
  });

  it("resolves a commodity name to its HS chapter", async () => {
    const tool = registered(client);
    const result = await tool.handler({ commodity: "kopi", year: "2024" });

    expect(client.getTradeData).toHaveBeenCalledWith(1, "09", "1", "2024", "2");
    expect(result.content[0].text).toContain("Kopi, teh, dan rempah-rempah");
    expect(result.content[0].text).toContain('Komoditas "kopi" dipetakan ke HS 09');
    expect(result.content[0].text).toContain("Jepang");
  });

  it("accepts 'impor' as the source", async () => {
    const tool = registered(client);
    await tool.handler({ commodity: "kopi", source: "impor", year: "2024" });
    expect(client.getTradeData).toHaveBeenCalledWith(2, "09", "1", "2024", "2");
  });

  it("falls back to the 2-digit chapter for a missing 4-digit code", async () => {
    const tool = registered(client);
    const result = await tool.handler({ hs_code: "0901", year: "2024" });
    const text = result.content[0].text;

    expect(client.getTradeData).toHaveBeenNthCalledWith(1, 1, "0901", "2", "2024", "2");
    expect(client.getTradeData).toHaveBeenNthCalledWith(2, 1, "09", "1", "2024", "2");
    expect(text).toContain("Data Ekspor — HS 09");
    expect(text).toContain("tingkat bab 2 digit");
  });

  it("asks for a code or commodity when neither is given", async () => {
    const tool = registered(client);
    const result = await tool.handler({ year: "2024" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("hs_code");
    expect(client.getTradeData).not.toHaveBeenCalled();
  });
});
