import { describe, it, expect } from "vitest";
import { buildListUrl, normalizePathParam } from "../../../src/client/endpoints.js";

describe("BPS URL building", () => {
  it("normalizes comma-separated values to semicolons", () => {
    expect(normalizePathParam("th", "2020, 2021,2022")).toBe("2020;2021;2022");
    expect(normalizePathParam("var", "184,192")).toBe("184;192");
  });

  it("keeps BPS multi-value and range separators unencoded", () => {
    const url = buildListUrl("https://webapi.bps.go.id/v1", "data", {
      domain: "0000",
      var: "184",
      th: "2020,2021,2022",
      lang: "ind",
      key: "test-key",
    });
    expect(url).toContain("/th/2020;2021;2022/");
    expect(url).not.toContain("%3B");
    expect(url).not.toContain("%2C");
  });

  it("preserves colon ranges", () => {
    const url = buildListUrl("https://webapi.bps.go.id/v1", "data", {
      domain: "0000",
      var: "184",
      th: "2019:2024",
      lang: "ind",
      key: "test-key",
    });
    expect(url).toContain("/th/2019:2024/");
    expect(url).not.toContain("%3A");
  });

  it("encodes values that are not safe path segments", () => {
    const url = buildListUrl("https://webapi.bps.go.id/v1", "statictable", {
      domain: "0000",
      keyword: "penduduk & miskin",
      lang: "ind",
      key: "test-key",
    });
    expect(url).toContain("keyword=penduduk+%26+miskin");
  });
});
