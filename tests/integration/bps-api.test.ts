import { describe, it, expect, beforeAll } from "vitest";
import { ApiKeyProvider } from "../../src/auth/api-key.provider.js";
import { BpsClient } from "../../src/client/bps-client.js";
import { InMemoryCache } from "../../src/services/cache.js";
import { loadConfig } from "../../src/config/index.js";

const BPS_API_KEY = process.env.BPS_API_KEY;

const describeIntegration = BPS_API_KEY ? describe : describe.skip;

describeIntegration("BPS API Integration", () => {
  let client: BpsClient;

  beforeAll(() => {
    const config = loadConfig({
      BPS_API_KEY: BPS_API_KEY!,
      BPS_LOG_LEVEL: "error",
    } as unknown as NodeJS.ProcessEnv);
    const auth = new ApiKeyProvider(BPS_API_KEY!);
    const cache = new InMemoryCache();
    client = new BpsClient(auth, cache, config);
  });

  it("should list provinces (domains)", async () => {
    const result = await client.listDomains("prov");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("domain_id");
    expect(result.data[0]).toHaveProperty("domain_name");
  }, 15_000);

  it("should list subjects for national domain", async () => {
    const result = await client.listSubjects("0000");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("sub_id");
    expect(result.data[0]).toHaveProperty("title");
  }, 15_000);

  it("should search data", async () => {
    const result = await client.search("0000", "penduduk");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
  }, 15_000);

  it("should list static tables", async () => {
    const result = await client.listStaticTables("0000");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("table_id");
    expect(result.data[0]).toHaveProperty("title");
  }, 15_000);

  it("should list press releases", async () => {
    const result = await client.listPressReleases("0000");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("brs_id");
    expect(result.data[0]).toHaveProperty("title");
  }, 15_000);

  it("should list strategic indicators", async () => {
    const result = await client.listStrategicIndicators("0000");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("indicator_id");
    expect(result.data[0]).toHaveProperty("title");
  }, 15_000);
});
