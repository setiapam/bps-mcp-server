import { describe, it, expect, vi } from "vitest";
import type { BpsClient } from "../../../src/client/bps-client.js";
import type { DomainResolver } from "../../../src/services/domain-resolver.js";
import {
  formatKabkotaRanking,
  rankKabkota,
  type KabkotaRankingResult,
} from "../../../src/services/kabkota-ranking.js";

/**
 * Sulawesi Selatan-style table: the indicator lives in `turvar`, so the
 * service must pick TPT and not TPAK.
 */
function sulselResponse() {
  return {
    status: "OK",
    "data-availability": "available",
    data: null,
    var: [{ var_id: 466, title: "Tingkat Pengangguran Terbuka (Agustus)", unit: "Persen" }],
    vervar: [
      { kode_vervar: "001", label_vervar: "Makassar" },
      { kode_vervar: "002", label_vervar: "Palopo" },
      { kode_vervar: "003", label_vervar: "Bitung" },
      { kode_vervar: "7300", label_vervar: "SULAWESI SELATAN" },
    ],
    turvar: [
      { kode_turvar: "1", label_turvar: "Tingkat Pengangguran Terbuka (TPT)" },
      { kode_turvar: "2", label_turvar: "Tingkat Partisipasi Angkatan Kerja (TPAK)" },
    ],
    tahun: [{ th_id: 126, th_name: "2026" }],
    turtahun: [{ turth_id: 0, turth_name: "Tahunan" }],
    datacontent: {
      "00146611260": 9.67,
      "00146621260": 70.1,
      "00246611260": 7.51,
      "00246621260": 65.2,
      // 9.154 is an unemployment *count* published in the percent column.
      "00346611260": 9154,
      "00346621260": 60.4,
      "730046611260": 4.23,
    },
  };
}

/** Jawa Tengah-style table: the province row is labelled with a prefix. */
function jatengResponse() {
  return {
    status: "OK",
    "data-availability": "available",
    data: null,
    var: [{ var_id: 64, title: "TPT Menurut Kabupaten/Kota", unit: "Persen" }],
    vervar: [
      { kode_vervar: "001", label_vervar: "3301 Kabupaten Cilacap" },
      { kode_vervar: "002", label_vervar: "3329 Kabupaten Brebes" },
      { kode_vervar: "3300", label_vervar: "3300 PROVINSI JAWA TENGAH" },
    ],
    turvar: [],
    tahun: [{ th_id: 125, th_name: "2025" }],
    turtahun: [],
    datacontent: {
      "001641250": 7.4,
      "002641250": 8.07,
      "3300641250": 4.66,
    },
  };
}

function createMockClient(): BpsClient {
  return {
    getDynamicData: vi.fn().mockImplementation(async (domain: string) => {
      if (domain === "7300") return sulselResponse();
      if (domain === "3300") return jatengResponse();
      // Province that only publishes province totals.
      return { status: "OK", var: [], vervar: [], turvar: [], tahun: [], turtahun: [], datacontent: {} };
    }),
    listPeriods: vi.fn().mockResolvedValue([{ th_id: 126, th_name: "2026" }]),
    listVariables: vi.fn().mockResolvedValue({ data: [], page: { pages: 1 } }),
    listSubjects: vi.fn().mockResolvedValue({ data: [], page: { pages: 1 } }),
  } as unknown as BpsClient;
}

function createMockResolver(): DomainResolver {
  return {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getDomains: () => [
      { domain_id: "7300", domain_name: "Sulawesi Selatan" },
      { domain_id: "3300", domain_name: "Jawa Tengah" },
      { domain_id: "5100", domain_name: "Bali" },
      { domain_id: "7301", domain_name: "Kepulauan Selayar" },
    ],
    resolve: vi.fn().mockImplementation(async (query: string) => {
      if (/sulawesi selatan|sulsel/i.test(query)) return { domainId: "7300", domainName: "Sulawesi Selatan" };
      if (/jawa tengah|jateng/i.test(query)) return { domainId: "3300", domainName: "Jawa Tengah" };
      return null;
    }),
  } as unknown as DomainResolver;
}

describe("rankKabkota", () => {
  it("merges kabupaten/kota from several provinces into one ranking", async () => {
    const result = await rankKabkota(createMockClient(), createMockResolver(), {
      query: "tingkat pengangguran tertinggi",
      topN: 10,
      order: "highest",
    });

    expect(result.totalRegions).toBe(4);
    expect(result.rows[0]).toMatchObject({
      region: "Makassar",
      province: "Sulawesi Selatan",
      value: 9.67,
      period: "2026",
    });
    expect(result.rows.map((row) => row.region)).toEqual([
      "Makassar",
      "Kabupaten Brebes",
      "Palopo",
      "Kabupaten Cilacap",
    ]);
    expect(result.provincesCovered).toBe(2);
  });

  it("picks the TPT series instead of TPAK", async () => {
    const result = await rankKabkota(createMockClient(), createMockResolver(), {
      query: "pengangguran",
      topN: 10,
      order: "highest",
    });

    const makassar = result.rows.find((row) => row.region === "Makassar");
    expect(makassar?.value).toBe(9.67);
    expect(makassar?.series).toContain("TPT");
  });

  it("drops the province aggregate row and impossible percentages", async () => {
    const result = await rankKabkota(createMockClient(), createMockResolver(), {
      query: "pengangguran",
      topN: 10,
      order: "highest",
    });

    const regions = result.rows.map((row) => row.region.toLowerCase());
    expect(regions.some((region) => region.includes("sulawesi selatan"))).toBe(false);
    expect(regions.some((region) => region.includes("jawa tengah"))).toBe(false);
    expect(regions).not.toContain("bitung");
  });

  it("reports provinces that only publish province totals", async () => {
    const result = await rankKabkota(createMockClient(), createMockResolver(), {
      query: "pengangguran",
      topN: 10,
      order: "highest",
    });

    const provinces = result.missing.map((item) => item.province);
    expect(provinces).toContain("Bali");
  });

  it("honours order=lowest and top_n", async () => {
    const result = await rankKabkota(createMockClient(), createMockResolver(), {
      query: "pengangguran",
      topN: 2,
      order: "lowest",
    });

    expect(result.rows.map((row) => row.region)).toEqual(["Kabupaten Cilacap", "Palopo"]);
    expect(result.totalRegions).toBe(4);
  });

  it("restricts the sweep to the requested provinces", async () => {
    const client = createMockClient();
    const result = await rankKabkota(client, createMockResolver(), {
      query: "pengangguran",
      topN: 10,
      order: "highest",
      provinces: ["Jawa Tengah"],
    });

    expect(result.rows.every((row) => row.domain === "3300")).toBe(true);
    expect(result.provincesConsidered).toBe(1);
    expect(client.getDynamicData).toHaveBeenCalledTimes(1);
  });
});

describe("formatKabkotaRanking", () => {
  it("renders a table with period and coverage notes", () => {
    const result: KabkotaRankingResult = {
      rows: [
        {
          region: "Makassar",
          province: "Sulawesi Selatan",
          domain: "7300",
          value: 9.67,
          period: "2026",
          series: "TPT",
          unit: "Persen",
          indicator: "TPT",
        },
      ],
      totalRegions: 1,
      provincesCovered: 1,
      provincesConsidered: 2,
      periods: ["2025", "2026"],
      series: ["TPT", "TPAK"],
      indicatorLabel: "Tingkat Pengangguran Terbuka (TPT)",
      missing: [{ province: "Bali", reason: "hanya angka provinsi" }],
    };

    const text = formatKabkotaRanking(result, { order: "highest", query: "pengangguran" });

    expect(text).toContain("| 1 | Makassar | Sulawesi Selatan | 9,67 | 2026 |");
    expect(text).toContain("Cakupan: 1 kabupaten/kota dari 1 provinsi");
    expect(text).toContain("periode tidak seragam");
    expect(text).toContain("Bali (hanya angka provinsi)");
  });
});

describe("rankKabkota period alignment", () => {
  /** Two provinces: one already has 2026, the other stops at 2025. */
  function clientWithPeriods() {
    const periods: Record<string, Array<{ th_id: number; th_name: string }>> = {
      "7300": [
        { th_id: 126, th_name: "2026" },
        { th_id: 125, th_name: "2025" },
        { th_id: 124, th_name: "2024" },
      ],
      "3300": [
        { th_id: 125, th_name: "2025" },
        { th_id: 124, th_name: "2024" },
      ],
    };

    return {
      listPeriods: vi.fn().mockImplementation(async (domain: string) => periods[domain] ?? []),
      getDynamicData: vi.fn().mockImplementation(async (domain: string) => {
        // Period labels stay as published; the tests assert the requested `th`.
        return domain === "3300" ? jatengResponse() : sulselResponse();
      }),
      listVariables: vi.fn().mockResolvedValue({ data: [], page: { pages: 1 } }),
      listSubjects: vi.fn().mockResolvedValue({ data: [], page: { pages: 1 } }),
    } as unknown as BpsClient;
  }

  function resolverWith(domains: Array<{ domain_id: string; domain_name: string }>) {
    return {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getDomains: () => domains,
      resolve: vi.fn(),
    } as unknown as DomainResolver;
  }

  it("defaults to the newest year shared by the provinces", async () => {
    const client = clientWithPeriods();
    const resolver = resolverWith([
      { domain_id: "7300", domain_name: "Sulawesi Selatan" },
      { domain_id: "3300", domain_name: "Jawa Tengah" },
    ]);

    const result = await rankKabkota(client, resolver, {
      query: "pengangguran",
      topN: 10,
      order: "highest",
    });

    expect(result.targetYear).toBe("2025");
    // Requested period must be the shared year, not each province's latest.
    const requestedPeriods = (client.getDynamicData as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[2]
    );
    expect(requestedPeriods).toEqual(["125", "125"]);
  });

  it("honours an explicit year", async () => {
    const client = clientWithPeriods();
    const resolver = resolverWith([
      { domain_id: "7300", domain_name: "Sulawesi Selatan" },
      { domain_id: "3300", domain_name: "Jawa Tengah" },
    ]);

    const result = await rankKabkota(client, resolver, {
      query: "pengangguran",
      topN: 10,
      order: "highest",
      year: "2024",
    });

    expect(result.targetYear).toBe("2024");
    const requestedPeriods = (client.getDynamicData as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[2]
    );
    expect(requestedPeriods).toEqual(["124", "124"]);
  });

  it("can still request each province's latest period", async () => {
    const client = clientWithPeriods();
    const resolver = resolverWith([
      { domain_id: "7300", domain_name: "Sulawesi Selatan" },
      { domain_id: "3300", domain_name: "Jawa Tengah" },
    ]);

    const result = await rankKabkota(client, resolver, {
      query: "pengangguran",
      topN: 10,
      order: "highest",
      periodMode: "latest",
    });

    expect(result.targetYear).toBeUndefined();
    const requestedPeriods = (client.getDynamicData as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[2]
    );
    expect(requestedPeriods).toEqual(["126", "125"]);
  });
});
