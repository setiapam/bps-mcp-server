import { describe, it, expect } from "vitest";
import type { BpsDynamicDataResponse } from "../../../src/client/types.js";
import {
  extractVervarId,
  filterRelevantVervar,
  getAggregateValue,
  selectAggregateTurvar,
  selectAggregateVervar,
} from "../../../src/services/dynamic-data-utils.js";

function povertyResponse(): BpsDynamicDataResponse {
  return {
    status: "OK",
    "data-availability": "available",
    data: null,
    var: [{ var_id: 936, title: "Persentase Penduduk Miskin Provinsi Jawa Barat", sub_id: 23, sub_name: "Kemiskinan" }],
    vervar: [{ kode_vervar: 3200, label_vervar: "Provinsi Jawa Barat" }],
    turvar: [
      { kode_turvar: 1, label_turvar: "Perkotaan" },
      { kode_turvar: 2, label_turvar: "Perdesaan" },
      { kode_turvar: 3, label_turvar: "Perkotaan + Perdesaan" },
    ],
    tahun: [{ th_id: 123, th_name: "2023" }],
    turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
    datacontent: {
      "3200936112363": 7.19,
      "3200936212363": 9.3,
      "3200936312363": 7.62,
    },
  };
}

describe("dynamic data aggregate selection", () => {
  it("picks the combined derived variable (Perkotaan + Perdesaan)", () => {
    const response = povertyResponse();
    expect(selectAggregateTurvar(response)).toBe("3");
    expect(getAggregateValue(response, "3200", "Jawa Barat")).toBe(7.62);
  });

  it("picks the national aggregate and excludes province rows", () => {
    const response: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "available",
      data: null,
      var: [{ var_id: 184, title: "Persentase Penduduk Miskin (P0) Menurut Daerah", sub_id: 23, sub_name: "Kemiskinan" }],
      vervar: [
        { val: 1, label: "Kota" },
        { val: 2, label: "Desa" },
        { val: 3, label: "Kota+Desa" },
      ],
      turvar: [{ val: "0", label: "Tidak ada" }],
      tahun: [{ val: 123, label: "2023" }],
      turtahun: [{ val: 63, label: "Tahunan" }],
      datacontent: {
        "1184012363": 7.29,
        "2184012363": 12.22,
        "3184012363": 9.36,
      },
    };
    expect(selectAggregateVervar(response, "0000")).toBe("3");
    expect(getAggregateValue(response, "0000")).toBe(9.36);
  });

  it("uses the longest vervar prefix to avoid 3 vs 30 collisions", () => {
    const response = {
      status: "OK",
      "data-availability": "available",
      data: null,
      var: [{ val: 1, label: "x" }],
      vervar: [
        { val: 3, label: "Three" },
        { val: 30, label: "Thirty" },
      ],
      turvar: [{ val: "0", label: "Tidak ada" }],
      tahun: [],
      turtahun: [],
      datacontent: { "3010120": 1, "3100120": 2 },
    } as BpsDynamicDataResponse;
    expect(extractVervarId("3010120", response)).toBe("30");
    expect(extractVervarId("3100120", response)).toBe("3");
  });

  it("picks the requested province instead of the Indonesia row", () => {
    const response: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "available",
      data: null,
      var: [{ var_id: 344, title: "Persentase Penduduk Miskin Menurut Provinsi", sub_id: 23, sub_name: "Kemiskinan" }],
      vervar: [
        { kode_vervar: 9999, label_vervar: "INDONESIA" },
        { kode_vervar: 3200, label_vervar: "Jawa Barat" },
        { kode_vervar: 3500, label_vervar: "Jawa Timur" },
      ],
      turvar: [{ kode_turvar: 0, label_turvar: "Tidak ada" }],
      tahun: [{ th_id: 123, th_name: "2023" }],
      turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
      datacontent: {
        "9999344012363": 9.36,
        "3200344012363": 7.62,
        "3500344012363": 10.35,
      },
    };

    expect(selectAggregateVervar(response, "3500", "Jawa Timur")).toBe("3500");
    expect(getAggregateValue(response, "3500", "Jawa Timur")).toBe(10.35);
    expect(selectAggregateVervar(response, "0000", "Indonesia")).toBe("9999");
  });

  it("does not label a national-only table as a province", () => {
    const response: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "available",
      data: null,
      var: [{ var_id: 344, title: "Persentase Penduduk Miskin Menurut Provinsi" }],
      vervar: [{ kode_vervar: 9999, label_vervar: "Indonesia" }],
      turvar: [{ kode_turvar: 0, label_turvar: "Tidak ada" }],
      tahun: [{ th_id: 123, th_name: "2023" }],
      turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
      datacontent: { "9999344012363": 9.36 },
    };

    expect(selectAggregateVervar(response, "3500", "Jawa Timur")).toBeNull();
    expect(getAggregateValue(response, "3500", "Jawa Timur")).toBeNull();
  });

  it("collapses large region breakdowns but keeps small Kota/Desa breakdowns", () => {
    const small = povertyResponse();
    expect(filterRelevantVervar(small, "3200", "Jawa Barat")).toBe(small);

    const large: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "available",
      data: null,
      var: [{ var_id: 192, title: "Persentase Penduduk Miskin", sub_id: 23, sub_name: "Kemiskinan" }],
      vervar: Array.from({ length: 34 }, (_, index) => ({
        kode_vervar: 1100 + index * 100,
        label_vervar: `PROVINSI ${index}`,
      })),
      turvar: [{ kode_turvar: 0, label_turvar: "Tidak ada" }],
      tahun: [{ th_id: 123, th_name: "2023" }],
      turtahun: [{ turth_id: 63, turth_name: "Tahunan" }],
      datacontent: Object.fromEntries(
        Array.from({ length: 34 }, (_, index) => [
          `${1100 + index * 100}192012363`,
          index,
        ])
      ),
    };
    (large.vervar as unknown as Array<{ kode_vervar: number; label_vervar: string }>).push({
      kode_vervar: 9999,
      label_vervar: "INDONESIA",
    });
    (large.datacontent as Record<string, number>)["9999192012363"] = 8.07;

    const filtered = filterRelevantVervar(large, "0000");
    expect(Object.keys(filtered.datacontent ?? {})).toEqual(["9999192012363"]);
    expect(filtered.vervar).toHaveLength(1);
    expect(getAggregateValue(large, "0000")).toBe(8.07);
  });
});
