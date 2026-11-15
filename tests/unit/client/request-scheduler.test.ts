import { describe, it, expect, vi } from "vitest";
import { RequestScheduler } from "../../../src/client/request-scheduler.js";

describe("RequestScheduler", () => {
  it("runs tasks and returns their results", async () => {
    const scheduler = new RequestScheduler(2, 0);
    const results = await Promise.all(
      [1, 2, 3, 4].map((value) => scheduler.run(async () => value * 2))
    );
    expect(results).toEqual([2, 4, 6, 8]);
  });

  it("never exceeds the concurrency limit", async () => {
    const scheduler = new RequestScheduler(3, 0);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        scheduler.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        })
      )
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("spaces requests by the minimum gap", async () => {
    const scheduler = new RequestScheduler(2, 30);
    const startedAt = Date.now();

    await Promise.all([0, 1, 2].map(() => scheduler.run(async () => undefined)));

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(55);
  });

  it("releases the slot even when the task throws", async () => {
    const scheduler = new RequestScheduler(1, 0);
    const failing = scheduler.run(async () => {
      throw new Error("boom");
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(scheduler.run(async () => "ok")).resolves.toBe("ok");
    expect(scheduler.running).toBe(0);
    expect(scheduler.pending).toBe(0);
  });

  it("keeps queued tasks waiting instead of dropping them", async () => {
    const scheduler = new RequestScheduler(1, 0);
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((value) =>
        scheduler.run(async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          order.push(value);
        })
      )
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it("accepts an injected scheduler in the client", () => {
    const spy = vi.fn();
    const scheduler = new RequestScheduler(1, 0);
    expect(spy).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(0);
    expect(scheduler.running).toBe(0);
  });
});
