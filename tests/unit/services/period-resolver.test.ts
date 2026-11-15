import { describe, it, expect, vi } from "vitest";
import { parseYearSpec, resolvePeriodsForSpec } from "../../../src/services/period-resolver.js";
import type { BpsClient } from "../../../src/client/bps-client.js";

describe("parseYearSpec", () => {
  it("returns no spec for empty input", () => {
    expect(parseYearSpec(undefined)).toEqual({ hasSpec: false, years: [], periodIds: [] });
    expect(parseYearSpec("   ").hasSpec).toBe(false);
  });

  it("parses comma, semicolon and space separated years ascending", () => {
    expect(parseYearSpec("2023, 2021;2022").years).toEqual(["2021", "2022", "2023"]);
    expect(parseYearSpec("2021 2022").years).toEqual(["2021", "2022"]);
  });

  it("expands ranges written in several ways", () => {
    expect(parseYearSpec("2021-2023").years).toEqual(["2021", "2022", "2023"]);
    expect(parseYearSpec("2021 s.d. 2023").years).toEqual(["2021", "2022", "2023"]);
    expect(parseYearSpec("2021 sampai 2022").years).toEqual(["2021", "2022"]);
  });

  it("keeps raw period ids separate from years", () => {
    const spec = parseYearSpec("2021,126");
    expect(spec.years).toEqual(["2021"]);
    expect(spec.periodIds).toEqual(["126"]);
  });
});

function createPeriodClient(): BpsClient {
  return {
    listPeriods: vi.fn().mockResolvedValue([
      { th_id: 126, th_name: "2026" },
      { th_id: 125, th_name: "2025" },
      { th_id: 124, th_name: "2025 (September)" },
      { th_id: 123, th_name: "2024" },
      { th_id: 122, th_name: "2023" },
    ]),
  } as unknown as BpsClient;
}

describe("resolvePeriodsForSpec", () => {
  it("maps years to period ids and prefers the annual series", async () => {
    const resolved = await resolvePeriodsForSpec(createPeriodClient(), "3500", 421, "2025");
    expect(resolved.entries).toEqual([{ id: "125", label: "2025", year: "2025" }]);
    expect(resolved.missingYears).toEqual([]);
  });

  it("reports years that have no data instead of returning nothing", async () => {
    const resolved = await resolvePeriodsForSpec(createPeriodClient(), "3500", 421, "2020-2021");
    expect(resolved.entries).toEqual([]);
    expect(resolved.missingYears).toEqual(["2020", "2021"]);
    expect(resolved.availableYears).toEqual(["2023", "2024", "2025", "2026"]);
  });

  it("accepts raw period ids", async () => {
    const resolved = await resolvePeriodsForSpec(createPeriodClient(), "3500", 421, "126");
    expect(resolved.entries).toEqual([{ id: "126", label: "2026", year: "2026" }]);
  });

  it("falls back to the latest period when no spec is given", async () => {
    const resolved = await resolvePeriodsForSpec(createPeriodClient(), "3500", 421, undefined);
    expect(resolved.hasSpec).toBe(false);
    expect(resolved.entries[0].id).toBe("126");
  });
});
