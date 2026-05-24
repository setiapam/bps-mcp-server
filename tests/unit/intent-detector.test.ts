import { describe, it, expect } from "vitest";
import { detectIntent, generateResultHints } from "../../src/services/intent-detector.js";

describe("Intent Detector", () => {
  describe("detectIntent", () => {
    it("should detect single_value intent for simple query", () => {
      const result = detectIntent("angka kemiskinan", "Jawa Timur", "2023");
      expect(result.intent).toBe("single_value");
      expect(result.suggestedTool).toBe("find_data");
    });

    it("should detect comparison intent", () => {
      const result = detectIntent("bandingkan kemiskinan jawa timur dan jawa barat", "Indonesia");
      expect(result.intent).toBe("comparison");
      expect(result.suggestedTool).toBe("compare_data");
    });

    it("should detect comparison intent with 'vs'", () => {
      const result = detectIntent("kemiskinan jatim vs jabar 2023", "Indonesia");
      expect(result.intent).toBe("comparison");
      expect(result.suggestedTool).toBe("compare_data");
    });

    it("should detect trend intent with year range", () => {
      const result = detectIntent("tren pengangguran 2019-2024", "Indonesia");
      expect(result.intent).toBe("trend");
      expect(result.suggestedTool).toBe("get_trend");
      expect(result.extractedParams.year).toBe("2019,2024");
    });

    it("should detect trend intent with 'dari...sampai'", () => {
      const result = detectIntent("perkembangan kemiskinan dari 2020 sampai 2023", "Indonesia");
      expect(result.intent).toBe("trend");
      expect(result.suggestedTool).toBe("get_trend");
    });

    it("should detect ranking intent", () => {
      const result = detectIntent("10 provinsi termiskin di indonesia", "Indonesia");
      expect(result.intent).toBe("ranking");
      expect(result.suggestedTool).toBe("get_ranking");
    });

    it("should detect ranking intent with 'peringkat'", () => {
      const result = detectIntent("peringkat ipm seluruh provinsi", "Indonesia");
      expect(result.intent).toBe("ranking");
      expect(result.suggestedTool).toBe("get_ranking");
    });

    it("should detect table intent for religion query", () => {
      const result = detectIntent("pemeluk agama di kab jombang", "Jawa Timur");
      expect(result.intent).toBe("table");
      expect(result.suggestedTool).toBe("find_data"); // find_data has static table fallback
    });

    it("should detect table intent for 'per kecamatan'", () => {
      const result = detectIntent("penduduk per kecamatan di jakarta", "DKI Jakarta");
      expect(result.intent).toBe("table");
      expect(result.suggestedTool).toBe("find_data");
    });

    it("should detect publication intent", () => {
      const result = detectIntent("cari publikasi tentang inflasi", "Indonesia");
      expect(result.intent).toBe("publication");
      expect(result.suggestedTool).toBe("search");
    });

    it("should detect publication intent for BRS", () => {
      const result = detectIntent("berita resmi statistik terbaru", "Indonesia");
      expect(result.intent).toBe("publication");
      expect(result.suggestedTool).toBe("search");
    });

    it("should extract year range from query", () => {
      const result = detectIntent("pengangguran 2020-2023", "Indonesia");
      expect(result.extractedParams.year).toBe("2020,2023");
    });

    it("should extract regions from comparison query", () => {
      const result = detectIntent("antara jawa timur dan jawa barat", "Indonesia");
      expect(result.extractedParams.region1).toBe("jawa timur");
      expect(result.extractedParams.region2).toBe("jawa barat");
    });
  });

  describe("generateResultHints", () => {
    it("should suggest province data for kabupaten result", () => {
      const hints = generateResultHints("kemiskinan", "3517", "Kabupaten Jombang", 184, "Persentase Penduduk Miskin");
      expect(hints.some(h => h.includes("provinsi"))).toBe(true);
    });

    it("should suggest static table for religion query", () => {
      const hints = generateResultHints("pemeluk agama", "3517", "Kabupaten Jombang", 9999, "Agama");
      expect(hints.some(h => h.includes("static_tables"))).toBe(true);
    });

    it("should suggest related indicators for poverty query", () => {
      const hints = generateResultHints("kemiskinan", "0000", "Indonesia", 184, "Persentase Penduduk Miskin");
      // Check for either "gini" or "Gini" (case sensitivity)
      expect(hints.some(h => h.toLowerCase().includes("gini"))).toBe(true);
    });

    it("should suggest related indicators for unemployment query", () => {
      const hints = generateResultHints("pengangguran", "0000", "Indonesia", 543, "TPT");
      expect(hints.some(h => h.includes("tpak") || h.includes("angkatan"))).toBe(true);
    });

    it("should suggest trend for IPM query", () => {
      const hints = generateResultHints("ipm", "3500", "Jawa Timur", 413, "IPM");
      expect(hints.some(h => h.includes("get_trend"))).toBe(true);
    });

    it("should return empty hints for generic query", () => {
      const hints = generateResultHints("data umum", "0000", "Indonesia");
      expect(hints.length).toBe(0);
    });
  });
});
