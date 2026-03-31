import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "compare_regions",
    "Template untuk membandingkan data statistik antar wilayah",
    {
      region_a: z.string().describe("Nama wilayah pertama (misal: Jawa Timur)"),
      region_b: z.string().describe("Nama wilayah kedua (misal: Jawa Barat)"),
      indicator: z.string().optional().describe("Indikator yang dibandingkan (misal: kemiskinan, pengangguran). Kosongkan untuk ringkasan umum"),
      year: z.string().optional().describe("Tahun data (misal: 2023). Kosongkan untuk data terbaru"),
    },
    async ({ region_a, region_b, indicator, year }) => {
      const indicatorText = indicator ?? "indikator utama (kemiskinan, pengangguran, pertumbuhan ekonomi, IPM)";
      const yearText = year ?? "terbaru yang tersedia";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Bandingkan data statistik ${indicatorText} antara ${region_a} dan ${region_b} untuk tahun ${yearText}.

Langkah:
1. Gunakan tool resolve_domain untuk mendapatkan kode domain kedua wilayah
2. Gunakan tool list_variables atau list_strategic_indicators untuk menemukan variabel yang relevan
3. Gunakan tool get_dynamic_data untuk mengambil data kedua wilayah
4. Sajikan perbandingan dalam format tabel yang mudah dipahami
5. Berikan analisis singkat tentang perbedaan yang ditemukan

Format output yang diharapkan:
- Tabel perbandingan dengan kolom: Indikator | ${region_a} | ${region_b} | Selisih
- Ringkasan analisis 2-3 kalimat`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "trend_analysis",
    "Template untuk analisis tren data statistik multi-tahun",
    {
      region: z.string().describe("Nama wilayah (misal: Indonesia, Jawa Timur)"),
      indicator: z.string().describe("Indikator yang dianalisis (misal: inflasi, kemiskinan, pengangguran)"),
      start_year: z.string().optional().describe("Tahun awal (misal: 2019)"),
      end_year: z.string().optional().describe("Tahun akhir (misal: 2023)"),
    },
    async ({ region, indicator, start_year, end_year }) => {
      const startText = start_year ?? "2019";
      const endText = end_year ?? "2023";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Analisis tren ${indicator} di ${region} dari tahun ${startText} sampai ${endText}.

Langkah:
1. Gunakan tool resolve_domain untuk mendapatkan kode domain wilayah
2. Gunakan tool list_variables atau search untuk menemukan variabel ${indicator}
3. Gunakan tool get_dynamic_data dengan parameter th="${startText},${Number(startText) + 1},${Number(startText) + 2},...,${endText}" untuk mengambil data multi-tahun
4. Sajikan data dalam tabel time-series
5. Identifikasi tren (naik/turun/fluktuatif) dan titik-titik penting

Format output yang diharapkan:
- Tabel: Tahun | Nilai | Perubahan (%)
- Grafik ASCII sederhana jika memungkinkan
- Analisis tren 3-5 kalimat, termasuk faktor-faktor yang mungkin mempengaruhi`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "poverty_profile",
    "Template profil kemiskinan suatu daerah",
    {
      region: z.string().describe("Nama wilayah (misal: Jawa Timur, Surabaya)"),
      year: z.string().optional().describe("Tahun data (misal: 2023)"),
    },
    async ({ region, year }) => {
      const yearText = year ?? "terbaru";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Buatkan profil kemiskinan ${region} tahun ${yearText}.

Langkah:
1. Gunakan resolve_domain untuk mendapatkan kode domain
2. Cari data berikut menggunakan list_variables dan get_dynamic_data:
   - Persentase penduduk miskin
   - Jumlah penduduk miskin (ribu jiwa)
   - Garis kemiskinan (Rp/kapita/bulan)
   - Indeks Kedalaman Kemiskinan (P1)
   - Indeks Keparahan Kemiskinan (P2)
3. Jika tersedia, bandingkan dengan angka nasional
4. Cari BRS terkait kemiskinan menggunakan list_press_releases

Format output:
- Ringkasan data kemiskinan dalam tabel
- Perbandingan dengan rata-rata nasional
- Tren 3 tahun terakhir jika data tersedia
- Sumber BRS terkait`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "economic_overview",
    "Template ringkasan ekonomi daerah",
    {
      region: z.string().describe("Nama wilayah (misal: DKI Jakarta, Bali)"),
      year: z.string().optional().describe("Tahun data (misal: 2023)"),
    },
    async ({ region, year }) => {
      const yearText = year ?? "terbaru";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Buatkan ringkasan ekonomi ${region} tahun ${yearText}.

Langkah:
1. Gunakan resolve_domain untuk mendapatkan kode domain
2. Kumpulkan data indikator ekonomi utama menggunakan list_strategic_indicators dan get_dynamic_data:
   - PDRB (nominal dan riil)
   - Pertumbuhan ekonomi (%)
   - Inflasi (%)
   - Tingkat Pengangguran Terbuka (TPT)
   - Indeks Pembangunan Manusia (IPM)
   - Gini Ratio
3. Jika tersedia, cari data ekspor/impor menggunakan get_trade_data
4. Cari publikasi terkait menggunakan list_publications

Format output:
- Dashboard indikator ekonomi utama (tabel)
- Perbandingan dengan tahun sebelumnya dan nasional
- Highlight 3-5 poin penting
- Sumber data dan publikasi terkait`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    "population_stats",
    "Template statistik kependudukan",
    {
      region: z.string().describe("Nama wilayah (misal: Indonesia, Jawa Barat)"),
      year: z.string().optional().describe("Tahun data (misal: 2023)"),
    },
    async ({ region, year }) => {
      const yearText = year ?? "terbaru";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Tampilkan statistik kependudukan ${region} tahun ${yearText}.

Langkah:
1. Gunakan resolve_domain untuk mendapatkan kode domain
2. Kumpulkan data kependudukan menggunakan get_dynamic_data dan list_strategic_indicators:
   - Jumlah penduduk
   - Laju pertumbuhan penduduk
   - Kepadatan penduduk (jiwa/km²)
   - Rasio jenis kelamin
   - Dependency ratio
   - Angka harapan hidup
3. Jika tersedia, cari data sensus menggunakan list_census_events dan list_census_topics
4. Cari tabel statis terkait menggunakan list_static_tables dengan keyword "penduduk"

Format output:
- Tabel ringkasan demografi
- Perbandingan dengan sensus sebelumnya jika tersedia
- Distribusi umur dan jenis kelamin jika data tersedia
- Sumber data dan catatan metodologi`,
            },
          },
        ],
      };
    }
  );
}
