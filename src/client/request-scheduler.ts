/**
 * Global request scheduler.
 *
 * BPS WebAPI rate-limits aggressively: a burst of parallel requests (an LLM
 * happily fires 30 at once) immediately returns HTTP 429 and every subsequent
 * call fails for a while. Agents cannot be trusted to self-throttle, so the
 * throttle lives in the client.
 *
 * Requests are queued, run at most `maxConcurrent` at a time, and spaced by
 * `minGapMs` to keep the requests-per-second rate low.
 */
export class RequestScheduler {
  private active = 0;
  /** Earliest timestamp at which the next request may start. */
  private nextSlotAt = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number = 4,
    private readonly minGapMs: number = 40
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** Current number of queued tasks (useful for diagnostics/tests). */
  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;

    if (this.minGapMs > 0) {
      // Reserve a slot atomically so parallel acquisitions are spaced too,
      // not just queued: otherwise N tasks that grab a free slot at the same
      // moment all fire at once.
      const now = Date.now();
      const startAt = Math.max(now, this.nextSlotAt);
      this.nextSlotAt = startAt + this.minGapMs;
      const wait = startAt - now;
      if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Shared scheduler instance used by every BpsClient request. */
export const defaultScheduler = new RequestScheduler(
  readPositiveInt(readEnv("BPS_MAX_CONCURRENCY"), 3),
  readPositiveInt(readEnv("BPS_MIN_REQUEST_GAP_MS"), 250)
);

/** Read an env var without assuming `process` exists (Cloudflare Workers). */
function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
