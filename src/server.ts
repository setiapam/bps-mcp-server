import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config/index.js";
import type { IAuthProvider } from "./auth/types.js";
import type { ICacheProvider } from "./services/cache.js";
import type { IPersistentStore } from "./services/persistent-store.js";
import { BpsClient } from "./client/bps-client.js";
import { AllStatsClient } from "./client/allstats-client.js";
import { DomainResolver } from "./services/domain-resolver.js";
import { registerDomainTools } from "./tools/domain.tools.js";
import { registerDynamicDataTools } from "./tools/dynamic-data.tools.js";
import { registerStaticTableTools } from "./tools/static-table.tools.js";
import { registerPublicationTools } from "./tools/publication.tools.js";
import { registerReferenceTools } from "./tools/reference.tools.js";
import { registerTradeTools } from "./tools/trade.tools.js";
import { registerSearchTools } from "./tools/search.tools.js";
import { registerAllStatsTools } from "./tools/allstats.tools.js";
import { registerUtilityTools } from "./tools/utility.tools.js";
import { registerSmartTools } from "./tools/smart.tools.js";
import { registerAnalysisTools } from "./tools/analysis.tools.js";
import { registerInfographicTools } from "./tools/infographic.tools.js";
import { registerCensusTools } from "./tools/census.tools.js";
import { registerCsaTools } from "./tools/csa.tools.js";
import { registerNewsTools } from "./tools/news.tools.js";
import { registerGlossaryTools } from "./tools/glossary.tools.js";
import { registerResources } from "./resources/domain.resources.js";
import { registerPrompts } from "./prompts/analysis.prompts.js";

/**
 * Routing rules sent to the client at initialize time.
 *
 * BPS has no national kabupaten/kota table, so a model that "just searches"
 * ends up sweeping 30+ provincial domains and burning ~150 tool calls. The
 * dedicated tools already do that sweep internally — these instructions exist
 * so the model picks them instead of rebuilding the sweep by hand.
 */
const SERVER_INSTRUCTIONS = `Server ini menyediakan data BPS (WebAPI + AllStats).

ATURAN ROUTING (penting, hemat panggilan):
1. Peringkat/top-N wilayah ("10 kabupaten/kota ... tertinggi", "5 provinsi termiskin")
   -> get_ranking. Parameter 'level' WAJIB diisi:
   - level="kabkota" bila jawaban perlu kabupaten/kota. Satu panggilan sudah
     menyapu tabel tiap provinsi dan menyeragamkan tahun (period_mode="common").
   - level="provinsi" untuk peringkat provinsi.
   JANGAN menyusun peringkat kabupaten/kota manual dengan list_variables /
   get_dynamic_data per provinsi: hasilnya 100+ panggilan dan tahunnya campur.
2. Angka satu wilayah ("pengangguran Jawa Timur") -> find_data; tren satu wilayah -> get_trend.
3. Bandingkan 2+ wilayah -> compare_data. Perbandingan multi-tahun
   ("5 tahun terakhir") juga compare_data: isi years="2021-2025" atau
   start_year/end_year — satu panggilan menghasilkan tabel wilayah x tahun.
   JANGAN memanggil get_trend per wilayah untuk perbandingan.
4. Butuh angka mentah dari var_id yang sudah diketahui -> get_dynamic_data.
   Parameter th menerima TAHUN langsung ('2021-2025'), tidak perlu list_periods.
   Pakai format="json" bila hasilnya akan diolah lagi.
5. Mencari variabel/tabel/publikasi -> find_variable, search, allstats_search.

CATATAN DATA: periode antar provinsi tidak seragam (2024-2026). Selalu sebutkan
tahun data saat menyajikan angka, dan jangan menyebut data lama sebagai "terkini".
Bila suatu wilayah tidak punya rincian kabupaten/kota, get_ranking(level="kabkota")
sudah melaporkannya di bagian cakupan — jangan mengulanginya manual.`;

export function createServer(
  config: Config,
  auth: IAuthProvider,
  cache: ICacheProvider | null,
  store?: IPersistentStore | null,
  version?: string
): { server: McpServer; client: BpsClient; resolver: DomainResolver } {
  const server = new McpServer(
    {
      name: "bps-statistics",
      version: version || "0.0.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  const client = new BpsClient(auth, cache, config);
  const allStatsClient = new AllStatsClient(cache, config.allStatsBaseUrl);
  const resolver = new DomainResolver(client);

  // WebAPI-based tools
  registerDomainTools(server, client, resolver);
  registerDynamicDataTools(server, client, config);
  registerStaticTableTools(server, client);
  registerPublicationTools(server, client);
  registerReferenceTools(server, client);
  registerTradeTools(server, client);
  registerInfographicTools(server, client);
  registerCensusTools(server, client);
  registerCsaTools(server, client);
  registerNewsTools(server, client);
  registerGlossaryTools(server, client, allStatsClient);

  // Search tools — WebAPI with AllStats fallback
  registerSearchTools(server, client, allStatsClient);

  // AllStats-only tools (search engine + deep search)
  registerAllStatsTools(server, allStatsClient);

  // Smart AI-friendly tools (one-shot data retrieval)
  registerSmartTools(server, client, resolver, config, store ?? null);

  // Analysis tools (compare, trend, ranking)
  registerAnalysisTools(server, client, resolver, config, store ?? null);

  // Utility
  registerUtilityTools(server, cache);

  // Resources & Prompts
  registerResources(server, client, resolver);
  registerPrompts(server);

  return { server, client, resolver };
}
