import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { appendAttribution } from "../services/attribution.js";
import { BpsNotFoundError, formatErrorForUser } from "../utils/error.js";
import { logger } from "../utils/logger.js";

interface TradeRow {
  value?: number | string;
  netweight?: number | string;
  ctr?: string;
  pod?: string;
  kodehs?: string;
  bulan?: string;
}

/**
 * Commodity name → 2-digit HS chapter. BPS' dataexim endpoint only returns
 * data for chapters (`jenishs=1`), so a 4-10 digit code has to fall back to
 * its chapter anyway; resolving the name here saves the caller a search call.
 */
const COMMODITY_CHAPTERS: Record<string, { code: string; label: string }> = {
  kopi: { code: "09", label: "Kopi, teh, dan rempah-rempah" },
  teh: { code: "09", label: "Kopi, teh, dan rempah-rempah" },
  rempah: { code: "09", label: "Kopi, teh, dan rempah-rempah" },
  cengkeh: { code: "09", label: "Kopi, teh, dan rempah-rempah" },
  lada: { code: "09", label: "Kopi, teh, dan rempah-rempah" },
  beras: { code: "10", label: "Serealia" },
  gandum: { code: "10", label: "Serealia" },
  jagung: { code: "10", label: "Serealia" },
  buah: { code: "08", label: "Buah-buahan dan kacang-kacangan" },
  sayur: { code: "07", label: "Sayuran" },
  daging: { code: "02", label: "Daging dan jeroan" },
  ikan: { code: "03", label: "Ikan dan udang" },
  udang: { code: "03", label: "Ikan dan udang" },
  tuna: { code: "03", label: "Ikan dan udang" },
  sawit: { code: "15", label: "Lemak dan minyak hewani/nabati" },
  cpo: { code: "15", label: "Lemak dan minyak hewani/nabati" },
  minyak: { code: "15", label: "Lemak dan minyak hewani/nabati" },
  gula: { code: "17", label: "Gula dan kembang gula" },
  kakao: { code: "18", label: "Kakao dan olahannya" },
  cokelat: { code: "18", label: "Kakao dan olahannya" },
  pupuk: { code: "31", label: "Pupuk" },
  obat: { code: "30", label: "Produk farmasi" },
  farmasi: { code: "30", label: "Produk farmasi" },
  karet: { code: "40", label: "Karet dan barang dari karet" },
  kayu: { code: "44", label: "Kayu dan barang dari kayu" },
  pulp: { code: "47", label: "Pulp dan kertas daur ulang" },
  kertas: { code: "48", label: "Kertas dan karton" },
  tekstil: { code: "61", label: "Pakaian jadi (bukan rajutan)" },
  pakaian: { code: "61", label: "Pakaian jadi (bukan rajutan)" },
  alas: { code: "64", label: "Alas kaki" },
  sepatu: { code: "64", label: "Alas kaki" },
  baja: { code: "72", label: "Besi dan baja" },
  besi: { code: "72", label: "Besi dan baja" },
  tembaga: { code: "74", label: "Tembaga dan barang dari tembaga" },
  nikel: { code: "75", label: "Nikel dan barang dari nikel" },
  aluminium: { code: "76", label: "Aluminium dan barang dari aluminium" },
  batubara: { code: "27", label: "Bahan bakar mineral" },
  minyakbumi: { code: "27", label: "Bahan bakar mineral" },
  migas: { code: "27", label: "Bahan bakar mineral" },
  gas: { code: "27", label: "Bahan bakar mineral" },
  emas: { code: "71", label: "Logam mulia dan permata" },
  perak: { code: "71", label: "Logam mulia dan permata" },
  permata: { code: "71", label: "Logam mulia dan permata" },
  mesin: { code: "84", label: "Mesin dan peralatan mekanis" },
  elektronik: { code: "85", label: "Mesin listrik dan elektronik" },
  kendaraan: { code: "87", label: "Kendaraan dan bagiannya" },
  mobil: { code: "87", label: "Kendaraan dan bagiannya" },
  furnitur: { code: "94", label: "Furnitur" },
  mebel: { code: "94", label: "Furnitur" },
  mainan: { code: "95", label: "Mainan dan peralatan olahraga" },
};

function lookupCommodity(name: string): { code: string; label: string } | null {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, "");
  if (COMMODITY_CHAPTERS[normalized]) return COMMODITY_CHAPTERS[normalized];
  for (const [key, value] of Object.entries(COMMODITY_CHAPTERS)) {
    if (normalized.includes(key) || key.includes(normalized)) return value;
  }
  return null;
}

function rowsOf(payload: unknown): TradeRow[] {
  const data = payload as { data?: TradeRow[] };
  return Array.isArray(data?.data) ? data.data : [];
}

function formatTradeData(
  payload: unknown,
  sourceLabel: string,
  requestedCode: string,
  effectiveCode: string,
  year: string,
  period: string
): string {
  const rows = rowsOf(payload);
  if (rows.length === 0) {
    return `## Data ${sourceLabel} — HS ${requestedCode}\n\nTidak ada data untuk tahun ${year} dan periode ${period}.`;
  }

  const chapterTitle = rows.find((row) => row.kodehs)?.kodehs?.trim() ?? "";
  const byCountry = new Map<string, { value: number; weight: number; rows: number }>();
  let totalValue = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const country = row.ctr?.trim() || "(tidak diketahui)";
    const value = Number(row.value);
    const weight = Number(row.netweight);
    const aggregate = byCountry.get(country) ?? { value: 0, weight: 0, rows: 0 };
    if (Number.isFinite(value)) {
      aggregate.value += value;
      totalValue += value;
    }
    if (Number.isFinite(weight)) {
      aggregate.weight += weight;
      totalWeight += weight;
    }
    aggregate.rows++;
    byCountry.set(country, aggregate);
  }

  const top = [...byCountry.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 20);

  const lines = [
    `## Data ${sourceLabel} — HS ${effectiveCode}${chapterTitle ? ` (${chapterTitle})` : ""}`,
    `**Tahun:** ${year} | **Periode:** ${period === "2" ? "Tahunan" : "Bulanan (diagregasi setahun)"}`,
    `**Baris data:** ${rows.length} | **Negara:** ${byCountry.size}`,
    "",
    `**Total nilai:** ${totalValue.toLocaleString("id-ID")} US$`,
    `**Total berat bersih:** ${totalWeight.toLocaleString("id-ID")} kg`,
    "",
    "| # | Negara | Nilai (US$) | Berat (kg) |",
    "| --- | --- | --- | --- |",
  ];

  for (let index = 0; index < top.length; index++) {
    const [country, aggregate] = top[index];
    lines.push(
      `| ${index + 1} | ${country} | ${aggregate.value.toLocaleString("id-ID")} | ${aggregate.weight.toLocaleString("id-ID")} |`
    );
  }

  if (byCountry.size > top.length) {
    lines.push("", `_Menampilkan ${top.length} dari ${byCountry.size} negara, diurutkan berdasarkan nilai._`);
  }

  if (effectiveCode !== requestedCode) {
    lines.push(
      "",
      `_Kode HS ${requestedCode} tidak tersedia di WebAPI BPS; data ditampilkan pada tingkat bab 2 digit (HS ${effectiveCode})._`
    );
  }

  return lines.join("\n");
}

export function registerTradeTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "get_trade_data",
    `Ambil data perdagangan luar negeri (ekspor/impor) BPS dalam satu panggilan.

Bisa memakai kode HS 2 digit ATAU nama komoditas (mis. "kopi", "cpo", "batubara",
"nikel"). WebAPI BPS hanya menyediakan data pada tingkat bab 2 digit; bila kode
4-10 digit diminta, server otomatis memakai babnya dan memberi catatan.

Parameter \`source\` menerima "1"/"ekspor" atau "2"/"impor". \`period\`
menerima "2"/"tahunan" (default) atau "1"/"bulanan". \`year\` opsional
(default: tahun lalu).`,
    {
      source: z
        .enum(["1", "2", "ekspor", "impor"])
        .default("1")
        .describe("'1'/'ekspor' untuk ekspor, '2'/'impor' untuk impor"),
      hs_code: z
        .string()
        .regex(/^\d{2,10}$/, "Kode HS harus berupa 2-10 digit")
        .optional()
        .describe("Kode HS (2-10 digit). Contoh: '09' (kopi/teh/rempah) atau '27' (bahan bakar mineral). Isi salah satu dari hs_code/commodity."),
      commodity: z
        .string()
        .optional()
        .describe("Nama komoditas sebagai ganti kode HS. Contoh: kopi, cpo, batubara, nikel, udang, tekstil"),
      komoditas: z.string().optional().describe("Alias untuk 'commodity'."),
      hs_type: z
        .enum(["1", "2"])
        .optional()
        .describe("Opsional. '1' untuk bab 2 digit, '2' untuk kode lengkap. Default dihitung dari panjang kode."),
      year: z
        .string()
        .regex(/^\d{4}$/, "Tahun harus 4 digit")
        .optional()
        .describe("Tahun data (mis. '2024'). Default: tahun lalu."),
      period: z
        .enum(["1", "2", "bulanan", "tahunan"])
        .default("2")
        .describe("'2'/'tahunan' (default) atau '1'/'bulanan'"),
    },
    async ({ source, hs_code, commodity, komoditas, hs_type, year, period }) => {
      try {
        const sourceValue = source ?? "1";
        const periodValue = period ?? "2";
        const commodityName = commodity ?? komoditas;
        let requestedCode = hs_code ?? "";
        let commodityLabel = "";
        let commodityNote = "";

        if (!requestedCode && commodityName) {
          const match = lookupCommodity(commodityName);
          if (match) {
            requestedCode = match.code;
            commodityLabel = match.label;
          }
        }

        if (!requestedCode) {
          return {
            content: [{
              type: "text",
              text:
                "Isi `hs_code` (2-10 digit) atau `commodity` (mis. \"kopi\", \"cpo\", \"batubara\").\n" +
                `Komoditas yang dikenali: ${[...new Set(Object.values(COMMODITY_CHAPTERS).map((item) => item.label))].slice(0, 12).join(", ")}, dll.`,
            }],
            isError: true,
          };
        }

        const sourceCode = sourceValue === "ekspor" || sourceValue === "1" ? 1 : 2;
        const periodCode = periodValue === "tahunan" || periodValue === "2" ? "2" : "1";
        const yearValue = year ?? String(new Date().getFullYear() - 1);
        const requestedType = hs_type ?? (requestedCode.length <= 2 ? "1" : "2");
        const sourceLabel = sourceCode === 1 ? "Ekspor" : "Impor";

        let result: unknown = null;
        let effectiveCode = requestedCode;
        let narrowNote = "";

        try {
          result = await client.getTradeData(
            sourceCode as 1 | 2,
            requestedCode,
            requestedType,
            yearValue,
            periodCode
          );
        } catch (error) {
          // A 4-10 digit code is often simply absent; the chapter may still
          // have data, so fall through to the chapter request below.
          if (!(error instanceof BpsNotFoundError) || requestedCode.length <= 2) throw error;
          logger.debug(`Trade: HS ${requestedCode} not found, trying chapter`);
        }

        // Longer codes return no rows: BPS only publishes chapter-level data
        // here. Fall back to the 2-digit chapter instead of reporting "no data".
        if ((result === null || rowsOf(result).length === 0) && requestedCode.length > 2) {
          const chapter = requestedCode.slice(0, 2);
          logger.debug(`Trade: no rows for HS ${requestedCode}, retrying chapter ${chapter}`);
          const fallback = await client.getTradeData(
            sourceCode as 1 | 2,
            chapter,
            "1",
            yearValue,
            periodCode
          );
          if (rowsOf(fallback).length > 0) {
            result = fallback;
            effectiveCode = chapter;
            narrowNote = `Kode HS ${requestedCode} tidak tersedia di WebAPI BPS; data ditampilkan pada tingkat bab 2 digit (HS ${chapter}).`;
          }
        }

        if (commodityLabel && effectiveCode === requestedCode) {
          commodityNote = `Komoditas "${commodityName}" dipetakan ke HS ${effectiveCode} (${commodityLabel}).`;
        }
        if (commodityName && effectiveCode !== requestedCode) {
          commodityNote = `Komoditas "${commodityName}" dipetakan ke HS ${effectiveCode}.`;
        }

        const body = formatTradeData(
          result,
          sourceLabel,
          requestedCode,
          effectiveCode,
          yearValue,
          periodCode
        );
        const notes = [commodityNote, narrowNote].filter(Boolean);
        const text = appendAttribution(body + (notes.length > 0 ? `\n\n_${notes.join(" ")}_` : ""));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        if (error instanceof BpsNotFoundError) {
          return {
            content: [{
              type: "text",
              text:
                `Tidak ada data ${source ?? "ekspor"} untuk HS ${hs_code ?? commodity ?? "?"} ` +
                `pada tahun ${year ?? String(new Date().getFullYear() - 1)}.\n\n` +
                `Coba tahun lain, atau pakai bab HS 2 digit (mis. "09" untuk kopi/teh/rempah, "27" untuk bahan bakar mineral).`,
            }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
