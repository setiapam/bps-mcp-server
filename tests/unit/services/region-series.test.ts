import { describe, it, expect, vi } from "vitest";
import { hasRegionRow, pickRegionVervarId } from "../../../src/services/region-series.js";
import type { BpsDynamicDataResponse } from "../../../src/client/types.js";
import type { BpsClient } from "../../../src/client/bps-client.js";

const baseResponse = {
  status: "OK",
  "data-availability": "available",
  data: null,
  var: [{ var_id: 344, title: "Persentase Penduduk Miskin Menurut Provinsi" }],
  tahun: [{ th_id: 125, th_name: "2025" }],
  turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
} as unknown as BpsDynamicDataResponse;

describe("pickRegionVervarId", () => {
  it("rejects a national-only table when a province is requested", () => {
    const response: BpsDynamicDataResponse = {
      ...baseResponse,
      vervar: [{ kode_vervar: 9999, label_vervar: "Indonesia" }],
      datacontent: { "999934412563": 8.47 },
    };
    expect(pickRegionVervarId(response, "3500", "Jawa Timur")).toBeNull();
    expect(hasRegionRow(response, "3500", "Jawa Timur")).toBe(false);
  });

  it("accepts the province row when the table contains all provinces", () => {
    const response: BpsDynamicDataResponse = {
      ...baseResponse,
      vervar: [
        { kode_vervar: 9999, label_vervar: "Indonesia" },
        { kode_vervar: 3500, label_vervar: "Jawa Timur" },
      ],
      datacontent: { "999934412563": 8.47, "350034412563": 8.07 },
    };
    expect(pickRegionVervarId(response, "3500", "Jawa Timur")).toBe("3500");
    expect(hasRegionRow(response, "3500", "Jawa Timur")).toBe(true);
  });

  it("matches labels with a 'Provinsi' prefix", () => {
    const response: BpsDynamicDataResponse = {
      ...baseResponse,
      vervar: [{ kode_vervar: 3200, label_vervar: "Provinsi Jawa Barat" }],
      datacontent: { "320034412563": 6.54 },
    };
    expect(pickRegionVervarId(response, "3200", "Jawa Barat")).toBe("3200");
  });

  it("uses the Indonesia row for national requests", () => {
    const response: BpsDynamicDataResponse = {
      ...baseResponse,
      vervar: [{ kode_vervar: 9999, label_vervar: "INDONESIA" }],
      datacontent: { "999934412563": 8.47 },
    };
    expect(pickRegionVervarId(response, "0000", "Indonesia")).toBe("9999");
  });
});

describe("buildRegionSeries multi-year", () => {
  it("returns every requested year for a province in one pass", async () => {
    const { buildRegionSeries } = await import("../../../src/services/region-series.js");
    const client = {
      listPeriods: vi.fn().mockResolvedValue([
        { th_id: 126, th_name: "2026" },
        { th_id: 125, th_name: "2025" },
        { th_id: 124, th_name: "2024" },
        { th_id: 123, th_name: "2023" },
      ]),
      listSubjects: vi.fn().mockResolvedValue({ data: [{ sub_id: 23, title: "Kemiskinan" }] }),
      listVariables: vi.fn().mockResolvedValue({
        data: [
          {
            var_id: 421,
            title: "Jumlah Penduduk Miskin menurut Kabupaten/Kota di Jawa Timur",
            sub_name: "Kemiskinan",
            unit: "Ribu Jiwa",
          },
        ],
        page: { pages: 1 },
      }),
      getDynamicData: vi.fn().mockImplementation(async (_domain: string, _varId: string, th?: string) => {
        const ids = (th ?? "").split(";").filter(Boolean);
        const values: Record<string, number> = { "123": 4188.81, "124": 3982.69, "125": 3875.88, "126": 3712.23 };
        const datacontent: Record<string, number> = {};
        for (const id of ids) datacontent[`3500421${id}63`] = values[id];
        return {
          ...baseResponse,
          var: [{ var_id: 421, title: "Jumlah Penduduk Miskin menurut Kabupaten/Kota di Jawa Timur" }],
          vervar: [{ kode_vervar: 3500, label_vervar: "Jawa Timur" }],
          tahun: ids.map((id) => ({ th_id: Number(id), th_name: String(1999 + Number(id) - 100) })),
          datacontent,
        };
      }),
    } as unknown as BpsClient;

    const series = await buildRegionSeries(client, null, "jumlah penduduk miskin", "Jawa Timur", "3500", "Jawa Timur", {
      years: ["2023", "2024", "2025", "2026"],
    });

    expect(series.varId).toBe(421);
    expect(series.points.map((point) => point.year)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(series.points[3].value).toBe(3712.23);
    expect(series.missingYears).toEqual([]);
  });
});
