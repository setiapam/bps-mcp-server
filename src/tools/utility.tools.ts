import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ICacheProvider } from "../services/cache.js";

export function registerUtilityTools(server: McpServer, cache: ICacheProvider | null): void {
  server.tool(
    "cache_clear",
    "Bersihkan cache data BPS. Berguna jika ingin memastikan data terbaru diambil langsung dari API.",
    {},
    async () => {
      if (cache) {
        await cache.clear();
        return { content: [{ type: "text", text: "Cache berhasil dibersihkan." }] };
      }
      return { content: [{ type: "text", text: "Cache tidak aktif." }] };
    }
  );
}
