import { describe, it, expect } from "vitest";
import { searchQueryFallbacks } from "../../../src/services/search-query.js";

describe("searchQueryFallbacks", () => {
  it("maps derived nouns to the root BPS indexes", () => {
    expect(searchQueryFallbacks("kemiskinan")[0]).toBe("miskin");
    expect(searchQueryFallbacks("pendidikan")[0]).toBe("didik");
    expect(searchQueryFallbacks("pembangunan")[0]).toBe("bangun");
    expect(searchQueryFallbacks("pengangguran")[0]).toBe("tpt");
  });

  it("takes the head noun of a multi-word query first", () => {
    expect(searchQueryFallbacks("angka kemiskinan")[0]).toBe("kemiskinan");
    expect(searchQueryFallbacks("angka kemiskinan")).toContain("miskin");
  });

  it("strips affixes for words outside the curated map", () => {
    expect(searchQueryFallbacks("perkebunan")).toContain("kebun");
  });

  it("uses synonyms when nothing can be stripped", () => {
    expect(searchQueryFallbacks("inflasi")).toContain("ihk");
  });

  it("returns nothing for an empty query and at most three candidates", () => {
    expect(searchQueryFallbacks("")).toEqual([]);
    expect(searchQueryFallbacks("tingkat kemiskinan penduduk").length).toBeLessThanOrEqual(3);
  });
});
