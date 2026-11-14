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

  try {
    const $ = cheerio.load(html);
    $("style, script").remove();
    const table = $("table").first();
    if (table.length === 0) {
      if (/<frameset|<frame\b|<iframe\b|Excel Workbook Frameset/i.test(html)) {
        return "_Tabel ini disajikan BPS sebagai file Excel/frameset. Gunakan link Excel atau get_static_table untuk detailnya._";
      }
      return stripHtml(html);
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

    if (rows.length === 0) return stripHtml(html);

    const headerIndex = rows.findIndex((cells) => cells.filter(Boolean).length >= 2);
    if (headerIndex === -1) return stripHtml(html);

    const allCols = Math.max(...rows.map((cells) => cells.length));
    const colCount = Math.min(allCols, maxCols);
    const header = rows[headerIndex].slice(0, colCount);
    while (header.length < colCount) header.push("");
    const body = rows.slice(headerIndex + 1);

    const lines: string[] = [];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);

    const shown = body.slice(0, maxRows);
    for (const cells of shown) {
      const row = cells.slice(0, colCount);
      while (row.length < colCount) row.push("");
      lines.push(`| ${row.join(" | ")} |`);
    }

    if (allCols > colCount) {
      lines.push("", `_Kolom dipotong dari ${allCols} menjadi ${colCount}._`);
    }
    if (body.length > shown.length) {
      lines.push("", `_Menampilkan ${shown.length} dari ${body.length} baris tabel._`);
    }

    return lines.join("\n");
  } catch {
    return stripHtml(html);
  }
}
