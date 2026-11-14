import { describe, it, expect } from "vitest";
import { htmlTableToMarkdown, stripHtml } from "../../../src/utils/html.js";

describe("HTML helpers", () => {
  it("converts an HTML table to markdown and removes styles", () => {
    const html = `
      <style>.x { color: red }</style>
      <table>
        <tr><th>Bulan</th><th>Nilai</th></tr>
        <tr><td>Januari</td><td>3,55</td></tr>
      </table>`;
    const markdown = htmlTableToMarkdown(html);
    expect(markdown).toContain("| Bulan | Nilai |");
    expect(markdown).toContain("| Januari | 3,55 |");
    expect(markdown).not.toContain("color: red");
  });

  it("returns a clear note for BPS Excel framesets", () => {
    const html = `<html><head><meta name="Excel Workbook Frameset"></head><frameset><frame src="sheet.htm"></frameset></html>`;
    const markdown = htmlTableToMarkdown(html);
    expect(markdown).toContain("file Excel/frameset");
    expect(markdown).not.toContain("frameset><frame");
  });

  it("strips HTML from abstracts and decodes entities", () => {
    const text = stripHtml("<p>Inflasi <b>3,23</b> persen &amp; naik</p>");
    expect(text).toBe("Inflasi 3,23 persen & naik");
  });
});
