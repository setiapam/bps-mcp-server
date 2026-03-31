import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import type { DomainResolver } from "../services/domain-resolver.js";

function firstValue(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

export function registerResources(
  server: McpServer,
  client: BpsClient,
  resolver: DomainResolver
): void {
  server.resource(
    "provinces",
    "bps://domains/provinces",
    { description: "Daftar seluruh provinsi di Indonesia beserta kode domain BPS" },
    async () => {
      const result = await client.listDomains("prov");
      const lines = result.data.map(
        (d) => `${d.domain_id}\t${d.domain_name}`
      );
      return {
        contents: [
          {
            uri: "bps://domains/provinces",
            mimeType: "text/plain",
            text: `kode_domain\tnama\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.resource(
    "regencies-by-province",
    new ResourceTemplate("bps://domains/regencies/{prov_id}", {
      list: async () => {
        const provinces = await client.listDomains("prov");
        return {
          resources: provinces.data.map((p) => ({
            uri: `bps://domains/regencies/${p.domain_id}`,
            name: `Kab/Kota di ${p.domain_name}`,
            description: `Daftar kabupaten/kota di provinsi ${p.domain_name}`,
            mimeType: "text/plain" as const,
          })),
        };
      },
    }),
    { description: "Daftar kabupaten/kota untuk provinsi tertentu" },
    async (uri, variables) => {
      const provId = firstValue(variables.prov_id);
      const result = await client.listDomains("kabbyprov", provId);
      const lines = result.data.map(
        (d) => `${d.domain_id}\t${d.domain_name}`
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `kode_domain\tnama\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.resource(
    "subjects-by-domain",
    new ResourceTemplate("bps://subjects/{domain}", {
      list: undefined,
    }),
    { description: "Daftar subjek statistik untuk domain/wilayah tertentu" },
    async (uri, variables) => {
      const domain = firstValue(variables.domain);
      const result = await client.listSubjects(domain);
      const lines = result.data.map(
        (s) => `${s.sub_id}\t${s.title}${s.ntabel ? ` (${s.ntabel} tabel)` : ""}`
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `sub_id\tjudul\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );
}
