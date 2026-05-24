// Unit test: verify agama keyword mapping and scoring logic
import { describe, it, expect } from "vitest";
import { normalizeKeyword } from "../../src/services/learning.js";

describe("Agama keyword optimization", () => {
  describe("normalizeKeyword", () => {
    it("should normalize 'pemeluk agama' to 'agama'", () => {
      expect(normalizeKeyword("pemeluk agama")).toBe("agama");
    });

    it("should normalize 'statistik pemeluk agama di kab jombang' to contain 'agama' and 'jombang'", () => {
      const result = normalizeKeyword("statistik pemeluk agama di kab jombang jawa timur");
      expect(result).toContain("agama");
      expect(result).toContain("jombang");
      expect(result).not.toContain("pemeluk");
      expect(result).not.toContain("statistik");
    });

    it("should normalize 'religi' to 'religi' (alias resolves later in resolveCanonical)", () => {
      expect(normalizeKeyword("religi")).toBe("religi");
    });

    it("should normalize 'keagamaan' to 'keagamaan'", () => {
      expect(normalizeKeyword("keagamaan")).toBe("keagamaan");
    });

    it("should strip noise words from religion query", () => {
      const result = normalizeKeyword("berapa statistik terkait pemeluk agama di kab jombang jawa timur");
      expect(result).not.toContain("berapa");
      expect(result).not.toContain("statistik");
      expect(result).not.toContain("terkait");
      expect(result).not.toContain("pemeluk");
      expect(result).not.toContain("di");
      expect(result).toContain("agama");
      expect(result).toContain("jombang");
    });

    it("should strip 'menurut' from queries like 'penduduk menurut agama'", () => {
      const result = normalizeKeyword("penduduk menurut agama");
      expect(result).toBe("penduduk agama");
      expect(result).not.toContain("menurut");
    });

    it("should strip 'berdasarkan' from queries", () => {
      const result = normalizeKeyword("penduduk berdasarkan agama");
      expect(result).toBe("penduduk agama");
      expect(result).not.toContain("berdasarkan");
    });
  });
});
