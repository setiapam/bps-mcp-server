import { describe, it, expect, vi } from "vitest";
import type { BpsClient } from "../../../src/client/bps-client.js";
import type { IPersistentStore } from "../../../src/services/persistent-store.js";
import {
  computeRelevanceScore,
  detectMeasureHint,
  resolveVariableForYears,
  searchVariables,
} from "../../../src/services/variable-search.js";

class MemoryStore implements IPersistentStore {
  constructor(private readonly data: Record<string, string> = {}) {}
  async get(key: string) {
    return this.data[key] ?? null;
  }
  async set(key: string, value: string) {
    this.data[key] = value;
  }
  async delete(key: string) {
    delete this.data[key];
  }
  async getAll() {
    return { ...this.data };
  }
  async merge(entries: Record<string, string>) {
    for (const [key, value] of Object.entries(entries)) {
      if (!(key in this.data)) this.data[key] = value;
    }
  }
}

const AMOUNT_TITLE = "Jumlah Penduduk Miskin Menurut Provinsi Tahunan";
const RATE_TITLE = "Persentase Penduduk Miskin Menurut Provinsi";

describe("detectMeasureHint", () => {
  it("recognises headcount wording", () => {
    expect(detectMeasureHint("jumlah penduduk miskin")).toEqual({ amount: true, rate: false });
    expect(detectMeasureHint("berapa orang miskin")).toEqual({ amount: true, rate: false });
  });

  it("recognises rate wording", () => {
    expect(detectMeasureHint("persentase penduduk miskin")).toEqual({ amount: false, rate: true });
    expect(detectMeasureHint("tingkat pengangguran terbuka")).toEqual({ amount: false, rate: true });
  });

  it("keeps ambiguous wording neutral", () => {
    expect(detectMeasureHint("data kemiskinan")).toEqual({ amount: false, rate: false });
  });
});

describe("computeRelevanceScore amount vs rate", () => {
  it("prefers a headcount table for 'jumlah penduduk miskin'", () => {
    const amount = computeRelevanceScore("jumlah penduduk miskin", AMOUNT_TITLE, "Kemiskinan", "");
    const rate = computeRelevanceScore("jumlah penduduk miskin", RATE_TITLE, "Kemiskinan", "");
    expect(amount).toBeGreaterThan(rate);
  });

  it("prefers a rate table for 'persentase penduduk miskin'", () => {
    const amount = computeRelevanceScore("persentase penduduk miskin", AMOUNT_TITLE, "Kemiskinan", "");
    const rate = computeRelevanceScore("persentase penduduk miskin", RATE_TITLE, "Kemiskinan", "");
    expect(rate).toBeGreaterThan(amount);
  });

  it("does not invent a preference without measure words", () => {
    const amount = computeRelevanceScore("penduduk miskin", AMOUNT_TITLE, "Kemiskinan", "");
    const rate = computeRelevanceScore("penduduk miskin", RATE_TITLE, "Kemiskinan", "");
    expect(amount).toBeGreaterThan(0);
    expect(rate).toBeGreaterThan(0);
  });
});

describe("searchVariables subject sweep", () => {
  it("uses the curated subject map without listing subjects", async () => {
    const client = {
      listSubjects: vi.fn(),
      listVariables: vi.fn().mockResolvedValue({
        data: [
          { var_id: 131, title: AMOUNT_TITLE, sub_name: "Kemiskinan", unit: "Ribu Jiwa" },
          { var_id: 339, title: "Jumlah Penduduk Miskin menurut Provinsi Semesteran", sub_name: "Kemiskinan" },
          { var_id: 344, title: RATE_TITLE, sub_name: "Kemiskinan", unit: "Persen" },
        ],
        page: { pages: 1 },
      }),
    } as unknown as BpsClient;

    const candidates = await searchVariables(client, "3500", "kemiskinan", { year: 2023 });

    expect(client.listSubjects).not.toHaveBeenCalled();
    expect(client.listVariables).toHaveBeenCalledWith("3500", 23, 2023, 1, 100);
    expect(candidates.map((candidate) => candidate.var_id)).toContain(131);
  });

  it("falls back to the subject index when the curated map finds nothing", async () => {
    const client = {
      listSubjects: vi.fn().mockResolvedValue({
        data: [
          { sub_id: 27, title: "Agama dan Kepercayaan" },
          { sub_id: 12, title: "Kependudukan" },
        ],
        page: { pages: 1 },
      }),
      listVariables: vi.fn().mockImplementation(async (_domain: string, subject?: number) => ({
        data:
          subject === 27
            ? [{ var_id: 900, title: "Pemeluk Agama Menurut Provinsi", sub_name: "Agama" }]
            : [],
        page: { pages: 1 },
      })),
    } as unknown as BpsClient;

    const candidates = await searchVariables(client, "0000", "pemeluk agama");

    expect(client.listSubjects).toHaveBeenCalled();
    expect(candidates.map((candidate) => candidate.var_id)).toContain(900);
  });
});

describe("resolveVariableForYears learned fast path", () => {
  const periods = [
    { th_id: 123, th_name: "2023" },
    { th_id: 122, th_name: "2022" },
    { th_id: 121, th_name: "2021" },
    { th_id: 120, th_name: "2020" },
  ];

  function learnedStore(years = ["2020", "2021", "2022", "2023"]) {
    return new MemoryStore({
      "miskin:3500": JSON.stringify({
        var_id: 421,
        title: "Jumlah Penduduk Miskin menurut Kabupaten/Kota di Jawa Timur",
        sub_name: "Kemiskinan",
        unit: "Ribu Jiwa",
        domain: "3500",
      }),
      "period:421:3500:2023": JSON.stringify({ periodId: "123", year: "2023" }),
      "years": JSON.stringify(years),
    });
  }

  it("answers from the learned mapping with one period call", async () => {
    const client = {
      listPeriods: vi.fn().mockResolvedValue(periods),
      listVariables: vi.fn(),
      listSubjects: vi.fn(),
    } as unknown as BpsClient;

    const resolved = await resolveVariableForYears(
      client,
      learnedStore(),
      "kemiskinan",
      "3500",
      ["2023"]
    );

    expect(resolved?.learnedHit).toBe(true);
    expect(resolved?.varData.var_id).toBe(421);
    expect(resolved?.matchedYears).toEqual(["2023"]);
    expect(client.listPeriods).toHaveBeenCalledTimes(1);
    expect(client.listVariables).not.toHaveBeenCalled();
    expect(client.listSubjects).not.toHaveBeenCalled();
  });

  it("accepts a learned series with one missing year instead of searching", async () => {
    const client = {
      listPeriods: vi.fn().mockResolvedValue(periods),
      listVariables: vi.fn(),
      listSubjects: vi.fn(),
    } as unknown as BpsClient;

    const resolved = await resolveVariableForYears(
      client,
      learnedStore(),
      "kemiskinan",
      "3500",
      ["2019", "2020", "2021", "2022", "2023"]
    );

    expect(resolved?.learnedHit).toBe(true);
    expect(resolved?.matchedYears).not.toContain("2019");
    expect(client.listVariables).not.toHaveBeenCalled();
  });

  it("searches when the learned series is stale", async () => {
    const client = {
      listPeriods: vi.fn().mockImplementation(async (_domain: string, varId: number) =>
        varId === 421 ? [{ th_id: 90, th_name: "2015" }] : periods
      ),
      listSubjects: vi.fn().mockResolvedValue({ data: [], page: { pages: 1 } }),
      listVariables: vi.fn().mockResolvedValue({
        data: [{ var_id: 500, title: AMOUNT_TITLE, sub_name: "Kemiskinan", unit: "Ribu Jiwa" }],
        page: { pages: 1 },
      }),
    } as unknown as BpsClient;

    const resolved = await resolveVariableForYears(
      client,
      learnedStore(),
      "kemiskinan",
      "3500",
      ["2023"]
    );

    expect(resolved?.learnedHit).toBeUndefined();
    expect(resolved?.varData.var_id).toBe(500);
    expect(client.listVariables).toHaveBeenCalled();
  });
});
