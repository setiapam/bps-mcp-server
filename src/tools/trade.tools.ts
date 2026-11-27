import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { appendAttribution } from "../services/attribution.js";
import { BpsNotFoundError, formatErrorForUser } from "../utils/error.js";
import {
  getTradeDataService,
  MissingTradeTargetError,
  type TradeDataResult,
} from "../services/trade-service.js";

function formatTradeData(result: TradeDataResult): string {
  if (result.rowCount === 0) {
    return `## Data ${result.sourceLabel} — HS ${result.requestedCode}\n\nTidak ada data untuk tahun ${result.year} dan periode ${result.period}.`;
  }

  const top = result.byCountry.slice(0, 20);
  const lines = [
    `## Data ${result.sourceLabel} — HS ${result.hsCode}${result.chapterTitle ? ` (${result.chapterTitle})` : ""}`,
    `**Tahun:** ${result.year} | **Periode:** ${result.period === "2" ? "Tahunan" : "Bulanan (diagregasi setahun)"}`,
    `**Baris data:** ${result.rowCount} | **Negara:** ${result.byCountry.length}`,
    "",
    `**Total nilai:** ${result.totalValue.toLocaleString("id-ID")} US$`,
    `**Total berat bersih:** ${result.totalWeight.toLocaleString("id-ID")} kg`,
    "",
    "| # | Negara | Nilai (US$) | Berat (kg) |",
    "| --- | --- | --- | --- |",
  ];

  for (let index = 0; index < top.length; index++) {
    const aggregate = top[index];
    lines.push(
      `| ${index + 1} | ${aggregate.country} | ${aggregate.value.toLocaleString("id-ID")} | ${aggregate.weight.toLocaleString("id-ID")} |`
    );
  }

  if (result.byCountry.length > top.length) {
    lines.push("", `_Menampilkan ${top.length} dari ${result.byCountry.length} negara, diurutkan berdasarkan nilai._`);
  }

  if (result.hsCode !== result.requestedCode) {
    lines.push(
      "",
      `_Kode HS ${result.requestedCode} tidak tersedia di WebAPI BPS; data ditampilkan pada tingkat bab 2 digit (HS ${result.hsCode})._`
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
        const result = await getTradeDataService(client, {
          source,
          hs_code,
          commodity,
          komoditas,
          hs_type,
          year,
          period,
        });

        const body = formatTradeData(result);
        const notes = [result.commodityNote, result.narrowNote].filter(Boolean);
        const text = appendAttribution(body + (notes.length > 0 ? `\n\n_${notes.join(" ")}_` : ""));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        if (error instanceof MissingTradeTargetError) {
          return {
            content: [{ type: "text", text: error.message }],
            isError: true,
          };
        }
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
