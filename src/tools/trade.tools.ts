import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BpsClient } from "../client/bps-client.js";
import { appendAttribution } from "../services/attribution.js";
import { formatErrorForUser } from "../utils/error.js";

interface TradeRow {
  value?: number | string;
  netweight?: number | string;
  ctr?: string;
  pod?: string;
  kodehs?: string;
  bulan?: string;
}

function formatTradeData(payload: unknown, sourceLabel: string, hsCode: string, year: string, period: string): string {
  const data = payload as {
    metadata?: Record<string, string>;
    data?: TradeRow[];
  };
  const rows = Array.isArray(data?.data) ? data.data : [];
  if (rows.length === 0) {
    return `## Data ${sourceLabel} — HS ${hsCode}\n\nTidak ada data untuk tahun ${year} dan periode ${period}.`;
  }

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
    `## Data ${sourceLabel} — HS ${hsCode}`,
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

  return lines.join("\n");
}

export function registerTradeTools(server: McpServer, client: BpsClient): void {
  server.tool(
    "get_trade_data",
    "Ambil data perdagangan luar negeri (ekspor/impor) berdasarkan kode HS. Data mencakup nilai dan volume perdagangan Indonesia.",
    {
      source: z.enum(["1", "2"]).describe("Sumber data: '1' untuk ekspor, '2' untuk impor"),
      hs_code: z.string().regex(/^\d{2,10}$/, "Kode HS harus berupa 2-10 digit").describe("Kode HS (Harmonized System). Contoh: '09' atau '0901'"),
      hs_type: z.enum(["1", "2"]).describe("Tipe HS: '1' untuk 2-digit, '2' untuk full-digit (4+ digit)"),
      year: z.string().regex(/^\d{4}$/, "Tahun harus 4 digit").describe("Tahun data. Contoh: '2024'"),
      period: z.enum(["1", "2"]).describe("Periode: '1' untuk bulanan, '2' untuk tahunan"),
    },
    async ({ source, hs_code, hs_type, year, period }) => {
      try {
        const result = await client.getTradeData(
          Number(source) as 1 | 2,
          hs_code,
          hs_type,
          year,
          period
        );
        const sourceLabel = source === "1" ? "Ekspor" : "Impor";
        const text = appendAttribution(formatTradeData(result, sourceLabel, hs_code, year, period));
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: formatErrorForUser(error) }], isError: true };
      }
    }
  );
}
