import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { formatList } from "../services/data-formatter.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerCensusTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "list_census_events",
    "Daftar kegiatan sensus BPS (Sensus Penduduk, Sensus Ekonomi, Sensus Pertanian, dll). Gunakan ID kegiatan untuk mengambil topik dan data sensus.",
    {},
    async () => {
      try {
        const result = await client.listCensusEvents();
        const text = formatList(
          result,
          (e) => `**${e.kegiatan}** (ID: ${e.id}) — Tahun: ${e.tahun_kegiatan}`,
          "Daftar Kegiatan Sensus"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "list_census_topics",
    "Daftar topik data yang tersedia untuk kegiatan sensus tertentu. Gunakan list_census_events untuk mendapatkan ID kegiatan.",
    {
      kegiatan: z.string().describe("ID kegiatan sensus (dari list_census_events)"),
    },
    async ({ kegiatan }) => {
      try {
        const result = await client.listCensusTopics(kegiatan);
        const text = formatList(
          result,
          (t) => `**${t.topik}** (ID: ${t.id}) — ${t.topic}`,
          "Daftar Topik Sensus"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
