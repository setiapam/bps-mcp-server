import { describe, it, expect, vi } from "vitest";
import {
  computeRelevanceScore,
  expandQueryTerms,
  getSubjectIdsForKeyword,
  resolveVariableForYears,
} from "../../../src/services/variable-search.js";
import type { BpsClient } from "../../../src/client/bps-client.js";
import type { IPersistentStore } from "../../../src/services/persistent-store.js";

function createStore(): IPersistentStore {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
    getAll: async () => Object.fromEntries(data),
    merge: async (entries) => { for (const [key, value] of Object.entries(entries)) data.set(key, value); },
  };
}

describe("variable relevance scoring", () => {
  it("returns 0 when the title has no keyword match (no generic-bonus winner)", () => {
    // This exact case previously selected a population variable for "pemeluk agama"
    // because short titles containing "jumlah" received bonuses.
    const score = computeRelevanceScore(
      "pemeluk agama",
      "Jumlah Penduduk Menurut Kecamatan",
      "Kependudukan"
    );
    expect(score).toBe(0);
  });

  it("matches morphological roots (kemiskinan → miskin)", () => {
    expect(expandQueryTerms("kemiskinan")).toContain("miskin");
    const score = computeRelevanceScore(
      "kemiskinan",
      "Persentase Penduduk Miskin Provinsi Jawa Barat",
      "Kemiskinan"
    );
    expect(score).toBeGreaterThan(0);
  });

  it("prefers the percentage poverty indicator over garis/indeks", () => {
    const percentage = computeRelevanceScore(
      "kemiskinan",
      "Persentase Penduduk Miskin (P0) Menurut Provinsi dan Daerah",
      "Kemiskinan"
    );
    const line = computeRelevanceScore(
      "kemiskinan",
      "Garis Kemiskinan Menurut Provinsi dan Daerah",
      "Kemiskinan"
    );
    const index = computeRelevanceScore(
      "kemiskinan",
      "Indeks Keparahan Kemiskinan Menurut Kabupaten/Kota",
      "Kemiskinan"
    );
    expect(percentage).toBeGreaterThan(line);
    expect(percentage).toBeGreaterThan(index);
  });

  it("prefers Garis Kemiskinan when the query asks for it", () => {
    const line = computeRelevanceScore(
      "garis kemiskinan rupiah per kapita per bulan",
      "Garis Kemiskinan Menurut Provinsi (Rupiah/Kapita/Bulan)",
      "Kemiskinan"
    );
    const percentage = computeRelevanceScore(
      "garis kemiskinan rupiah per kapita per bulan",
      "Persentase Penduduk Miskin (P0) Menurut Provinsi",
      "Kemiskinan"
    );
    expect(line).toBeGreaterThan(percentage);
  });

  it("prefers the newest IPM method and penalises components", () => {
    const newMethod = computeRelevanceScore(
      "ipm",
      "Indeks Pembangunan Manusia (Hasil Long Form SP2020) Menurut Kabupaten/Kota",
      "Indeks Pembangunan Manusia"
    );
    const oldMethod = computeRelevanceScore(
      "ipm",
      "Indeks Pembangunan Manusia (IPM) Menurut Kabupaten Kota (UHH Hasil SP2010*)",
      "Indeks Pembangunan Manusia"
    );
    const component = computeRelevanceScore(
      "ipm",
      "[Metode Baru] Komponen IPM Menurut Kabupaten/Kota di Jawa Barat",
      "Indeks Pembangunan Manusia"
    );
    expect(newMethod).toBeGreaterThan(oldMethod);
    expect(newMethod).toBeGreaterThan(component);
  });

  it("penalises kabupaten breakdowns unless requested", () => {
    const aggregate = computeRelevanceScore(
      "kemiskinan",
      "Persentase Penduduk Miskin Provinsi Jawa Barat",
      "Kemiskinan"
    );
    const breakdown = computeRelevanceScore(
      "kemiskinan",
      "Persentase Penduduk Miskin Menurut Kabupaten/Kota di Jawa Barat",
      "Kemiskinan"
    );
    expect(aggregate).toBeGreaterThan(breakdown);
  });

  it("maps keywords to stable subject IDs", () => {
    expect(getSubjectIdsForKeyword("kemiskinan")).toContain(23);
    expect(getSubjectIdsForKeyword("inflasi")).toContain(3);
    expect(getSubjectIdsForKeyword("tenaga kerja")).toContain(6);
  });
});

describe("year-aware variable resolution", () => {
  it("skips a higher-scored variable that has no data for the requested year", async () => {
    const client = {
      listSubjects: vi.fn().mockResolvedValue({ data: [{ sub_id: 26, title: "Indeks Pembangunan Manusia" }] }),
      listVariables: vi.fn().mockResolvedValue({
        data: [
          {
            var_id: 132,
            title: "Indeks Pembangunan Manusia Menurut Provinsi",
            sub_name: "Indeks Pembangunan Manusia",
          },
          {
            var_id: 615,
            title: "Indeks Pembangunan Manusia (Hasil Long Form SP2020) Menurut Kabupaten/Kota",
            sub_name: "Indeks Pembangunan Manusia",
          },
        ],
        page: { pages: 1 },
      }),
      listPeriods: vi.fn().mockImplementation(async (_domain: string, varId: number) =>
        varId === 132
          ? [{ th_id: 119, th_name: "2019" }]
          : [{ th_id: 123, th_name: "2023" }]
      ),
    } as unknown as BpsClient;

    const resolved = await resolveVariableForYears(client, createStore(), "IPM", "3500", ["2023"]);
    expect(resolved?.varData.var_id).toBe(615);
    expect(resolved?.matchedYears).toEqual(["2023"]);
  });
});
