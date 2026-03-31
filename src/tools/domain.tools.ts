import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { DomainResolver } from "../services/domain-resolver.js";
import { formatList } from "../services/data-formatter.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

export function registerDomainTools(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver
): void {
  server.tool(
    "list_domains",
    "Daftar domain/wilayah BPS (provinsi, kabupaten/kota). Gunakan type='prov' untuk provinsi, 'kab' untuk semua kabupaten, 'kabbyprov' untuk kabupaten per provinsi.",
    {
      type: z.enum(["all", "prov", "kab", "kabbyprov"]).default("all").describe("Tipe domain: all, prov (provinsi), kab (kabupaten), kabbyprov (kabupaten per provinsi)"),
      prov: z.string().optional().describe("ID provinsi (wajib jika type=kabbyprov). Contoh: '35' untuk Jawa Timur"),
    },
    async ({ type, prov }) => {
      try {
        const result = await client.listDomains(type, prov);
        const text = formatList(
          result.data,
          (d) => `**${d.domain_name}** (kode: ${d.domain_id})`,
          "Daftar Domain/Wilayah"
        );
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );

  server.tool(
    "resolve_domain",
    "Konversi nama wilayah ke kode domain BPS. Mendukung nama resmi, singkatan (Jatim, Jabar, Jogja), dan fuzzy matching.",
    {
      query: z.string().describe("Nama wilayah yang ingin di-resolve. Contoh: 'Surabaya', 'Jawa Timur', 'Jatim', '3578'"),
    },
    async ({ query }) => {
      try {
        const result = await resolver.resolve(query);
        if (!result) {
          return {
            content: [{
              type: "text",
              text: appendAttribution(`Wilayah "${query}" tidak ditemukan. Coba gunakan nama resmi atau kode BPS.`),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: appendAttribution(
              `**${result.domainName}**\nKode domain: ${result.domainId}\n\nGunakan kode "${result.domainId}" sebagai parameter 'domain' di tool lainnya.`
            ),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
