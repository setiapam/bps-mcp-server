// Unit test: verify stopwords-iso integration and keyword normalization
import { describe, it, expect } from "vitest";
import { normalizeKeyword } from "../../src/services/learning.js";

describe("Stopwords-ISO integration", () => {
  describe("normalizeKeyword", () => {
    it("should strip Indonesian stopwords from religion query", () => {
      const result = normalizeKeyword("berapa statistik terkait pemeluk agama di kab jombang jawa timur");
      expect(result).toContain("agama");
      expect(result).toContain("jombang");
      expect(result).toContain("jawa");
      expect(result).toContain("timur");
      expect(result).not.toContain("berapa");
      expect(result).not.toContain("statistik");
      expect(result).not.toContain("terkait");
      expect(result).not.toContain("pemeluk");
      expect(result).not.toContain("di");
      expect(result).not.toContain("kab");
    });

    it("should strip 'menurut' and 'berdasarkan' (BPS prepositions)", () => {
      expect(normalizeKeyword("penduduk menurut agama")).toBe("penduduk agama");
      expect(normalizeKeyword("penduduk berdasarkan agama")).toBe("penduduk agama");
    });

    it("should handle English queries", () => {
      const result = normalizeKeyword("what is the population of jakarta");
      expect(result).toContain("population");
      expect(result).toContain("jakarta");
      expect(result).not.toContain("what");
      expect(result).not.toContain("is");
      expect(result).not.toContain("the");
      expect(result).not.toContain("of");
    });

    it("should normalize 'pemeluk agama' to 'agama'", () => {
      expect(normalizeKeyword("pemeluk agama")).toBe("agama");
    });

    it("should normalize 'keagamaan' to 'keagamaan'", () => {
      expect(normalizeKeyword("keagamaan")).toBe("keagamaan");
    });

    it("should strip comprehensive noise from complex query", () => {
      // Note: "tengah" is in stopwords-iso ID list, so it gets stripped
      // This is fine because region resolution is handled separately by domain resolver
      const result = normalizeKeyword("jumlah penduduk berdasarkan agama di kabupaten klaten jawa tengah");
      expect(result).toBe("penduduk agama klaten jawa");
    });

    it("should preserve important keywords while stripping noise", () => {
      expect(normalizeKeyword("angka kemiskinan terbaru di indonesia")).toBe("kemiskinan indonesia");
      expect(normalizeKeyword("statistik ipm jawa timur terbaru")).toBe("ipm jawa timur");
      expect(normalizeKeyword("data pengangguran terbuka tahun 2023")).toBe("pengangguran terbuka 2023");
    });
  });
});
