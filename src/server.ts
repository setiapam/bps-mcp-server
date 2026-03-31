import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config/index.js";
import type { IAuthProvider } from "./auth/types.js";
import type { ICacheProvider } from "./services/cache.js";
import { BpsClient } from "./client/bps-client.js";
import { DomainResolver } from "./services/domain-resolver.js";
import { registerDomainTools } from "./tools/domain.tools.js";
import { registerDynamicDataTools } from "./tools/dynamic-data.tools.js";
import { registerStaticTableTools } from "./tools/static-table.tools.js";
import { registerPublicationTools } from "./tools/publication.tools.js";
import { registerReferenceTools } from "./tools/reference.tools.js";
import { registerTradeTools } from "./tools/trade.tools.js";
import { registerSearchTools } from "./tools/search.tools.js";
import { registerUtilityTools } from "./tools/utility.tools.js";
import { registerInfographicTools } from "./tools/infographic.tools.js";
import { registerCensusTools } from "./tools/census.tools.js";
import { registerCsaTools } from "./tools/csa.tools.js";
import { registerNewsTools } from "./tools/news.tools.js";
import { registerGlossaryTools } from "./tools/glossary.tools.js";

export function createServer(
  config: Config,
  auth: IAuthProvider,
  cache: ICacheProvider | null
): { server: McpServer; client: BpsClient; resolver: DomainResolver } {
  const server = new McpServer({
    name: "bps-statistics",
    version: "0.1.0",
  });

  const client = new BpsClient(auth, cache, config);
  const resolver = new DomainResolver(client);

  registerDomainTools(server, client, resolver);
  registerDynamicDataTools(server, client, config);
  registerStaticTableTools(server, client);
  registerPublicationTools(server, client);
  registerReferenceTools(server, client);
  registerTradeTools(server, client);
  registerSearchTools(server, client);
  registerInfographicTools(server, client);
  registerCensusTools(server, client);
  registerCsaTools(server, client);
  registerNewsTools(server, client);
  registerGlossaryTools(server, client);
  registerUtilityTools(server, cache);

  return { server, client, resolver };
}
