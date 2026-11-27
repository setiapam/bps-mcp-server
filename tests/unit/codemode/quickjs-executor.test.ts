import { describe, it, expect } from "vitest";
import { QuickJSExecutor } from "../../../src/codemode/quickjs-executor.js";

describe("QuickJSExecutor", () => {
  const executor = new QuickJSExecutor();

  it("executes basic async code and returns structured JSON", async () => {
    const res = await executor.execute(
      `const data = await bps.echo({ value: 42 }); return { doubled: data.value * 2 };`,
      {
        echo: async (args) => ({ value: Number(args?.value ?? 0) }),
      }
    );

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ doubled: 84 });
    expect(res.callsUsed).toBe(1);
    expect(res.truncated).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("supports concurrent Promise.all calls", async () => {
    const res = await executor.execute(
      `
      const [a, b, c] = await Promise.all([
        bps.get({ id: 1 }),
        bps.get({ id: 2 }),
        bps.get({ id: 3 }),
      ]);
      return [a.id, b.id, c.id];
      `,
      {
        get: async (args) => {
          await new Promise((r) => setTimeout(r, 10));
          return { id: args?.id };
        },
      }
    );

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual([1, 2, 3]);
    expect(res.callsUsed).toBe(3);
  });

  it("captures console logs and respects maxLogBytes", async () => {
    const res = await executor.execute(
      `
      console.log("hello", { a: 1 });
      console.warn("careful");
      return "ok";
      `,
      {},
      { maxLogBytes: 200 }
    );

    expect(res.error).toBeUndefined();
    expect(res.result).toBe("ok");
    expect(res.logs).toEqual(['hello {"a":1}', "[warn] careful"]);

    const truncatedLogs = await executor.execute(
      `
      for (let i = 0; i < 50; i++) console.log("x".repeat(30));
      return true;
      `,
      {},
      { maxLogBytes: 100 }
    );
    expect(truncatedLogs.logs.at(-1)).toBe("[logs truncated]");
  });

  it("propagates host errors cleanly to guest JS and result.error", async () => {
    const caught = await executor.execute(
      `
      try {
        await bps.fail({});
        return "unreachable";
      } catch (e) {
        return { caught: e.message };
      }
      `,
      {
        fail: async () => {
          throw new Error("BPS upstream 500");
        },
      }
    );
    expect(caught.error).toBeUndefined();
    expect(caught.result).toEqual({ caught: "BPS upstream 500" });

    const uncaught = await executor.execute(`await bps.fail({});`, {
      fail: async () => {
        throw new Error("boom");
      },
    });
    expect(uncaught.error).toContain("boom");
  });

  it("aborts synchronous infinite loops via deadline interrupt", async () => {
    const res = await executor.execute(`while (true) {}`, {}, { timeoutMs: 150 });
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/interrupted|timeout/i);
  });

  it("aborts hung async host calls safely without crashing on late resolve", async () => {
    let release!: () => void;
    const hung = new Promise<void>((r) => {
      release = r;
    });

    const res = await executor.execute(
      `return await bps.hang({});`,
      {
        hang: async () => {
          await hung;
          return { late: true };
        },
      },
      { timeoutMs: 80 }
    );

    expect(res.error).toMatch(/timed out/i);
    // Resolving after VM disposal must not throw unhandled rejections or crash
    release();
    await new Promise((r) => setTimeout(r, 20));
  });

  it("enforces memory limits", async () => {
    const res = await executor.execute(
      `
      const buf = new Uint8Array(4 * 1024 * 1024);
      return buf.length;
      `,
      {},
      { memoryLimitBytes: 2 * 1024 * 1024, timeoutMs: 3000 }
    );
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/memory|out of memory/i);

    // Ensure runtime remains healthy after an OOM failure
    const afterOom = await executor.execute(`return 1 + 1;`, {});
    expect(afterOom.error).toBeUndefined();
    expect(afterOom.result).toBe(2);
  });

  it("enforces max stack size", async () => {
    const res = await executor.execute(
      `
      function recurse(n) { return recurse(n + 1); }
      return recurse(0);
      `,
      {},
      { maxStackSizeBytes: 64 * 1024 }
    );
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/stack|overflow|maximum/i);
  });

  it("enforces maxCalls guardrail", async () => {
    const res = await executor.execute(
      `
      for (let i = 0; i < 5; i++) {
        await bps.ping({});
      }
      return "done";
      `,
      {
        ping: async () => ({ pong: true }),
      },
      { maxCalls: 2 }
    );

    expect(res.error).toMatch(/Maximum API call limit \(2\)/i);
    expect(res.callsUsed).toBe(2);
  });

  it("truncates oversized outputs and flags truncated=true", async () => {
    const res = await executor.execute(
      `return { big: "x".repeat(5000) };`,
      {},
      { maxOutputBytes: 1024 }
    );

    expect(res.error).toBeUndefined();
    expect(res.truncated).toBe(true);
    expect((res.result as { _truncated: boolean })._truncated).toBe(true);
  });

  it("isolates guest from ambient host capabilities", async () => {
    const res = await executor.execute(
      `
      return {
        hasProcess: typeof process !== "undefined",
        hasFetch: typeof fetch !== "undefined",
        hasRequire: typeof require !== "undefined",
        hasSetTimeout: typeof setTimeout !== "undefined",
        hasGlobalThisBps: typeof bps === "object",
      };
      `,
      {}
    );

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({
      hasProcess: false,
      hasFetch: false,
      hasRequire: false,
      hasSetTimeout: false,
      hasGlobalThisBps: true,
    });
  });

  it("supports arrow expressions, markdown fences, and TypeScript annotations", async () => {
    const res = await executor.execute(
      "```ts\nasync () => {\n  const x: number = 21;\n  return x * 2;\n}\n```",
      {}
    );
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(42);
  });
});
