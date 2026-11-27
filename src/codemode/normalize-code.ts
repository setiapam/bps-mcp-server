import * as nodeModule from "node:module";

type StripTsFn = (
  code: string,
  options?: { mode?: "strip" | "transform"; sourceMap?: boolean; sourceUrl?: string }
) => string;

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // Handle single-line fenced block like ```js return 1 ```
  const inlineFence = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s+([\s\S]*?)\s*```\s*$/);
  if (inlineFence) {
    return inlineFence[1].trim();
  }
  return trimmed;
}

function tryStripTypeScript(code: string): string {
  const stripFn = (nodeModule as unknown as { stripTypeScriptTypes?: StripTsFn })
    .stripTypeScriptTypes;
  if (typeof stripFn !== "function") return code;
  try {
    return stripFn(code, { mode: "strip" });
  } catch {
    // Fall back to original code so QuickJS surfaces any real syntax error cleanly.
    return code;
  }
}

/**
 * Normalize LLM-authored JavaScript/TypeScript snippets into an executable
 * async IIFE expression suitable for QuickJS evaluation.
 *
 * Supports:
 * 1. Markdown code fences (```js / ```ts / ```)
 * 2. Arrow function expressions: `async () => { ... }` or `() => ...`
 * 3. Function expressions: `async function() { ... }` or `function() { ... }`
 * 4. Top-level statements: `const x = await bps.findData(...); return x;`
 * 5. Defensive TypeScript type stripping on Node >= 22.6
 */
export function normalizeCode(rawCode: string): string {
  const unfenced = stripMarkdownFences(rawCode);
  if (!unfenced) {
    throw new Error("Code must not be empty.");
  }

  // Strip optional `export default` prefix if LLM wrote a module-style snippet
  const withoutExport = unfenced.replace(/^export\s+default\s+/, "").trim();
  const withoutTrailingSemi = withoutExport.replace(/;+\s*$/, "").trim();

  // Detect standalone async/sync arrow function or function expression.
  // Be careful NOT to match `function helper() {} ; return helper();` as a single expression.
  const isArrowExpr =
    /^(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*(?::\s*[^=>{]+)?=>/.test(withoutTrailingSemi);
  const isAnonFuncExpr = /^(?:async\s+)?function\s*\([^)]*\)/.test(withoutTrailingSemi);

  let wrapped: string;
  if (isArrowExpr || isAnonFuncExpr) {
    // Wrap in an outer async IIFE that invokes the inner function expression
    // so both sync and async functions always return a Promise.
    wrapped = `(async () => await (${withoutTrailingSemi})())()`;
  } else {
    wrapped = `(async () => {\n${withoutExport}\n})()`;
  }

  return tryStripTypeScript(wrapped);
}
