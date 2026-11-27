import * as cheerio from "cheerio";

/** Convert HTML fragments (BPS abstracts, descriptions, news) to plain text. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  try {
    const $ = cheerio.load(`<div>${html}</div>`);
    $("script, style").remove();
    return $.root().text().replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export interface ParsedHtmlTable {
  headers: string[];
  rows: string[][];
  totalRows: number;
  totalCols: number;
  isFrameset?: boolean;
}

/**
 * Parse the first HTML table into structured headers + rows.
 */
export function parseHtmlTable(
  html: string | null | undefined,
  maxRows = 200,
  maxCols = 30
): ParsedHtmlTable | null {
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    $("style, script").remove();
    const table = $("table").first();
    if (table.length === 0) {
      if (/<frameset|<frame\b|<iframe\b|Excel Workbook Frameset/i.test(html)) {
        return { headers: [], rows: [], totalRows: 0, totalCols: 0, isFrameset: true };
      }
      return null;
    }

    const rows = table
      .find("tr")
      .toArray()
      .map((row) =>
        $(row)
          .find("th,td")
          .toArray()
          .map((cell) => escapeCell($(cell).text()))
      )
      .filter((cells) => cells.some((cell) => cell !== ""));

    if (rows.length === 0) return null;

    const headerIndex = rows.findIndex((cells) => cells.filter(Boolean).length >= 2);
    if (headerIndex === -1) return null;

    const allCols = Math.max(...rows.map((cells) => cells.length));
    const colCount = Math.min(allCols, maxCols);
    const headers = rows[headerIndex].slice(0, colCount);
    while (headers.length < colCount) headers.push("");
    const body = rows.slice(headerIndex + 1);

    const shown = body.slice(0, maxRows).map((cells) => {
      const row = cells.slice(0, colCount);
      while (row.length < colCount) row.push("");
      return row;
    });

    return {
      headers,
      rows: shown,
      totalRows: body.length,
      totalCols: allCols,
    };
  } catch {
    return null;
  }
}

/**
 * Convert the first HTML table into a compact markdown table.
 * BPS static tables contain a <style> block and Excel-specific classes; raw
 * HTML can be 30 KB+, which wastes a lot of LLM context.
 */
export function htmlTableToMarkdown(
  html: string | null | undefined,
  maxRows = 200,
  maxCols = 30
): string {
  if (!html) return "";

  const parsed = parseHtmlTable(html, maxRows, maxCols);
  if (!parsed) return stripHtml(html);
  if (parsed.isFrameset) {
    return "_Tabel ini disajikan BPS sebagai file Excel/frameset. Gunakan link Excel atau get_static_table untuk detailnya._";
  }

  const lines: string[] = [];
  lines.push(`| ${parsed.headers.join(" | ")} |`);
  lines.push(`| ${parsed.headers.map(() => "---").join(" | ")} |`);

  for (const row of parsed.rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }

  if (parsed.totalCols > parsed.headers.length) {
    lines.push("", `_Kolom dipotong dari ${parsed.totalCols} menjadi ${parsed.headers.length}._`);
  }
  if (parsed.totalRows > parsed.rows.length) {
    lines.push("", `_Menampilkan ${parsed.rows.length} dari ${parsed.totalRows} baris tabel._`);
  }

  return lines.join("\n");
}
