import type { BpsClient } from "../client/bps-client.js";
import { BpsNotFoundError } from "../utils/error.js";
import { logger } from "../utils/logger.js";

export interface TradeRow {
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
export const COMMODITY_CHAPTERS: Record<string, { code: string; label: string }> = {
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

export function lookupCommodity(name: string): { code: string; label: string } | null {
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

export interface GetTradeDataInput {
  source?: "1" | "2" | "ekspor" | "impor";
  hs_code?: string;
  commodity?: string;
  komoditas?: string;
  hs_type?: "1" | "2";
  year?: string;
  period?: "1" | "2" | "bulanan" | "tahunan";
}

export interface TradeCountryAggregate {
  country: string;
  value: number;
  weight: number;
  rows: number;
}

export interface TradeDataResult {
  source: "ekspor" | "impor";
  sourceCode: 1 | 2;
  sourceLabel: "Ekspor" | "Impor";
  hsCode: string;
  requestedCode: string;
  chapterTitle?: string;
  commodityName?: string;
  commodityLabel?: string;
  commodityNote?: string;
  narrowNote?: string;
  note?: string;
  year: string;
  period: "1" | "2";
  totalValue: number;
  totalWeight: number;
  rowCount: number;
  byCountry: TradeCountryAggregate[];
}

export class MissingTradeTargetError extends Error {
  constructor() {
    super(
      "Isi `hs_code` (2-10 digit) atau `commodity` (mis. \"kopi\", \"cpo\", \"batubara\").\n" +
        `Komoditas yang dikenali: ${[...new Set(Object.values(COMMODITY_CHAPTERS).map((item) => item.label))].slice(0, 12).join(", ")}, dll.`
    );
    this.name = "MissingTradeTargetError";
  }
}

export async function getTradeDataService(
  client: BpsClient,
  input: GetTradeDataInput
): Promise<TradeDataResult> {
  const sourceValue = input.source ?? "1";
  const periodValue = input.period ?? "2";
  const commodityName = input.commodity ?? input.komoditas;
  let requestedCode = input.hs_code ?? "";
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
    throw new MissingTradeTargetError();
  }

  const sourceCode: 1 | 2 = sourceValue === "ekspor" || sourceValue === "1" ? 1 : 2;
  const periodCode: "1" | "2" = periodValue === "tahunan" || periodValue === "2" ? "2" : "1";
  const yearValue = input.year ?? String(new Date().getFullYear() - 1);
  const requestedType = input.hs_type ?? (requestedCode.length <= 2 ? "1" : "2");
  const sourceLabel: "Ekspor" | "Impor" = sourceCode === 1 ? "Ekspor" : "Impor";

  let result: unknown = null;
  let effectiveCode = requestedCode;
  let narrowNote = "";

  try {
    result = await client.getTradeData(
      sourceCode,
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
      sourceCode,
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

  const rows = rowsOf(result);
  const chapterTitle = rows.find((row) => row.kodehs)?.kodehs?.trim() || undefined;
  const byCountryMap = new Map<string, TradeCountryAggregate>();
  let totalValue = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const country = row.ctr?.trim() || "(tidak diketahui)";
    const value = Number(row.value);
    const weight = Number(row.netweight);
    const aggregate = byCountryMap.get(country) ?? { country, value: 0, weight: 0, rows: 0 };
    if (Number.isFinite(value)) {
      aggregate.value += value;
      totalValue += value;
    }
    if (Number.isFinite(weight)) {
      aggregate.weight += weight;
      totalWeight += weight;
    }
    aggregate.rows++;
    byCountryMap.set(country, aggregate);
  }

  const byCountry = [...byCountryMap.values()].sort((a, b) => b.value - a.value);
  const notes = [commodityNote, narrowNote].filter(Boolean);

  return {
    source: sourceCode === 1 ? "ekspor" : "impor",
    sourceCode,
    sourceLabel,
    hsCode: effectiveCode,
    requestedCode,
    chapterTitle,
    commodityName,
    commodityLabel: commodityLabel || undefined,
    commodityNote: commodityNote || undefined,
    narrowNote: narrowNote || undefined,
    note: notes.length > 0 ? notes.join(" ") : undefined,
    year: yearValue,
    period: periodCode,
    totalValue,
    totalWeight,
    rowCount: rows.length,
    byCountry,
  };
}
