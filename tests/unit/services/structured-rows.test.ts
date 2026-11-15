import { describe, it, expect } from "vitest";
import {
  buildStructuredPayload,
  toStructuredRows,
} from "../../../src/services/data-formatter.js";
import type { BpsDynamicDataResponse } from "../../../src/client/types.js";
import dynamicDataFixture from "../../fixtures/dynamic-data.json";

const response = {
  status: "OK",
  "data-availability": "available",
  data: null,
  var: [{ var_id: 54, title: "TPT Menurut Kabupaten/Kota", unit: "Persen" }],
  vervar: [
    { kode_vervar: "001", label_vervar: "Sidoarjo" },
    { kode_vervar: "002", label_vervar: "Kota Malang" },
  ],
  turvar: [{ kode_turvar: "0", label_turvar: "Tingkat Pengangguran Terbuka" }],
  tahun: [{ th_id: 125, th_name: "2025" }],
  turtahun: [{ turth_id: "0", turth_name: "Agustus" }],
  datacontent: {
    "0015401250": 5.75,
    "0025401250": 5.69,
  },
} as unknown as BpsDynamicDataResponse;

describe("toStructuredRows", () => {
  it("names every dimension instead of relying on markdown columns", () => {
    const rows = toStructuredRows(response, "3500");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      indicator: "TPT Menurut Kabupaten/Kota",
      category: "Sidoarjo",
      series: "Tingkat Pengangguran Terbuka",
      period: "2025",
      subperiod: "Agustus",
      value: 5.75,
      unit: "Persen",
    });
  });

  it("works with the existing fixture", () => {
    const rows = toStructuredRows(
      dynamicDataFixture as unknown as BpsDynamicDataResponse,
      "0000"
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].indicator).toBeTruthy();
    expect(rows[0].period).toMatch(/\d{4}/);
  });
});

describe("buildStructuredPayload", () => {
  it("returns domain, rows and units", () => {
    const payload = buildStructuredPayload(response, "3500");

    expect(payload.domain).toBe("3500");
    expect(payload.rows).toHaveLength(2);
    expect(payload.units).toEqual(["Persen"]);
  });

  it("flags stale data instead of silently presenting it as current", () => {
    const stale = {
      ...response,
      tahun: [{ th_id: 100, th_name: "2001" }],
      datacontent: { "0015401000": 5.75 },
    } as unknown as BpsDynamicDataResponse;

    const payload = buildStructuredPayload(stale, "3500");
    expect(payload.note).toContain("2001");
  });
});
