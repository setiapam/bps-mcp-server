import { describe, it, expect } from "vitest";
import { formatDynamicData, formatList } from "../../../src/services/data-formatter.js";
import type { BpsDynamicDataResponse } from "../../../src/client/types.js";
import dynamicDataFixture from "../../fixtures/dynamic-data.json";

describe("formatDynamicData", () => {
  it("should format dynamic data response into readable text", () => {
    const result = formatDynamicData(
      dynamicDataFixture as unknown as BpsDynamicDataResponse,
      "Indonesia"
    );

    expect(result).toContain("Jumlah Penduduk");
    expect(result).toContain("Indonesia");
    expect(result).toContain("Sumber: Badan Pusat Statistik");
  });

  it("should include period labels in output", () => {
    const result = formatDynamicData(
      dynamicDataFixture as unknown as BpsDynamicDataResponse,
      "Indonesia"
    );

    expect(result).toContain("2021");
    expect(result).toContain("2022");
    expect(result).toContain("2023");
  });

  it("should include unit information", () => {
    const result = formatDynamicData(
      dynamicDataFixture as unknown as BpsDynamicDataResponse,
      "Indonesia"
    );

    expect(result).toContain("Jiwa");
  });

  it("should handle empty datacontent", () => {
    const emptyResponse: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "available",
      data: null,
      datacontent: {},
    };

    const result = formatDynamicData(emptyResponse, "Indonesia");
    expect(result).toContain("Tidak ada data");
    expect(result).toContain("Sumber: Badan Pusat Statistik");
  });

  it("should handle undefined datacontent", () => {
    const noDataResponse: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "not-available",
      data: null,
      datacontent: undefined,
    };

    const result = formatDynamicData(noDataResponse, "Indonesia");
    expect(result).toContain("Tidak ada data");
  });

  it("should use English when lang is eng", () => {
    const emptyResponse: BpsDynamicDataResponse = {
      status: "OK",
      "data-availability": "available",
      data: null,
      datacontent: {},
    };

    const result = formatDynamicData(emptyResponse, "Indonesia", "eng");
    expect(result).toContain("No data found");
    expect(result).toContain("Source: Statistics Indonesia");
  });

  it("should produce markdown table format", () => {
    const result = formatDynamicData(
      dynamicDataFixture as unknown as BpsDynamicDataResponse,
      "Indonesia"
    );

    expect(result).toContain("|");
    expect(result).toContain("---");
  });
});

describe("formatList", () => {
  it("should format items into numbered list", () => {
    const items = ["Alpha", "Beta", "Gamma"];
    const result = formatList(items, (item) => item, "Test Items");

    expect(result).toContain("## Test Items");
    expect(result).toContain("1. Alpha");
    expect(result).toContain("2. Beta");
    expect(result).toContain("3. Gamma");
    expect(result).toContain("Sumber: Badan Pusat Statistik");
  });

  it("should handle empty list in Indonesian", () => {
    const result = formatList([], (item: string) => item, "Data Kosong");
    expect(result).toContain("Tidak ada data kosong yang ditemukan");
    expect(result).toContain("Sumber: Badan Pusat Statistik");
  });

  it("should handle empty list in English", () => {
    const result = formatList([], (item: string) => item, "Empty Data", "eng");
    expect(result).toContain("No empty data found");
    expect(result).toContain("Source: Statistics Indonesia");
  });

  it("should apply custom formatter to each item", () => {
    const items = [
      { id: 1, name: "Foo" },
      { id: 2, name: "Bar" },
    ];
    const result = formatList(items, (item) => `[${item.id}] ${item.name}`, "Objects");

    expect(result).toContain("1. [1] Foo");
    expect(result).toContain("2. [2] Bar");
  });
});
