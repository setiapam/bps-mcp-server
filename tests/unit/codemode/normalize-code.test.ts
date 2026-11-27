import { describe, it, expect } from "vitest";
import { normalizeCode } from "../../../src/codemode/normalize-code.js";

describe("normalizeCode", () => {
  it("strips markdown js/ts/plain code fences", () => {
    const js = normalizeCode("```js\nreturn 42;\n```");
    expect(js).toContain("return 42;");
    expect(js).not.toContain("```");

    const ts = normalizeCode("```typescript\nconst x: number = 7; return x;\n```");
    expect(ts).not.toContain("```");
    expect(ts).not.toContain(": number");

    const plain = normalizeCode("```\nreturn 'ok';\n```");
    expect(plain).not.toContain("```");
  });

  it("wraps async arrow function expressions", () => {
    const out = normalizeCode("async () => { return 1 + 2; };");
    expect(out).toContain("async () => { return 1 + 2; }");
    expect(out).toContain("await (");
  });

  it("wraps async function expressions", () => {
    const out = normalizeCode("async function() { return 'hello'; }");
    expect(out).toContain("async function() { return 'hello'; }");
    expect(out).toContain("await (");
  });

  it("wraps top-level statements in an async IIFE", () => {
    const out = normalizeCode("const a = await bps.listDomains({});\nreturn a;");
    expect(out.startsWith("(async () => {")).toBe(true);
    expect(out).toContain("const a = await bps.listDomains({});");
  });

  it("strips TypeScript type annotations defensively", () => {
    const out = normalizeCode(
      "interface Row { value: number }\nconst rows: Row[] = [{ value: 10 }];\nreturn rows[0].value as number;"
    );
    expect(out).not.toContain("interface Row");
    expect(out).not.toContain(": Row[]");
    expect(out).not.toContain("as number");
    expect(out).toContain("return rows[0].value");
  });

  it("throws on empty input", () => {
    expect(() => normalizeCode("   ")).toThrow(/empty/i);
    expect(() => normalizeCode("```js\n\n```")).toThrow(/empty/i);
  });
});
