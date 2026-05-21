import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IPersistentStore } from "./persistent-store.js";
import { logger } from "../utils/logger.js";

const STORE_DIR = join(homedir(), ".bps-mcp");
const STORE_FILE = join(STORE_DIR, "learned-vars.json");
const FLUSH_DELAY_MS = 5_000;
const SYNC_TIMEOUT_MS = 5_000;

const DEFAULT_WORKER_URL = "https://bps-mcp-server.murphi.my.id";

/**
 * File-based persistent store for stdio transport.
 * Reads from disk on init, writes debounced.
 * Syncs with remote Worker for shared learning.
 */
export class FileStore implements IPersistentStore {
  private data: Record<string, string> = {};
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly workerUrl: string;

  constructor(workerUrl?: string) {
    this.workerUrl = workerUrl || process.env.BPS_WORKER_URL || DEFAULT_WORKER_URL;
    this.load();
    this.syncFromWorker();
  }

  private load(): void {
    try {
      if (existsSync(STORE_FILE)) {
        const raw = readFileSync(STORE_FILE, "utf-8");
        this.data = JSON.parse(raw);
        logger.debug(`FileStore: loaded ${Object.keys(this.data).length} entries`);
      }
    } catch {
      logger.warn("FileStore: failed to load, starting fresh");
      this.data = {};
    }
  }

  /** Pull learned data from Worker (background, non-blocking). */
  private syncFromWorker(): void {
    const pull = async (endpoint: string) => {
      const res = await fetch(`${this.workerUrl}${endpoint}`, {
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const json = await res.json() as { entries?: Record<string, string> };
      if (json.entries) await this.merge(json.entries);
    };

    Promise.all([
      pull("/api/learned-vars"),
      pull("/api/learned-periods"),
    ]).then(() => {
      logger.debug(`FileStore: synced from Worker, now ${Object.keys(this.data).length} entries`);
    }).catch(() => {
      logger.debug("FileStore: Worker sync failed (offline mode)");
    });
  }

  /** Push a single entry to Worker (background, fire-and-forget). */
  private pushToWorker(key: string, value: string): void {
    const endpoint = key.startsWith("period:") ? "/api/learned-periods" : "/api/learned-vars";
    fetch(`${this.workerUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    }).catch(() => {
      // Silent fail — local store is the fallback
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, FLUSH_DELAY_MS);
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(STORE_DIR, { recursive: true });
      writeFileSync(STORE_FILE, JSON.stringify(this.data), "utf-8");
      this.dirty = false;
      logger.debug(`FileStore: flushed ${Object.keys(this.data).length} entries`);
    } catch (err) {
      logger.warn("FileStore: flush failed", err);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.data[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data[key] = value;
    this.dirty = true;
    this.scheduleFlush();
    this.pushToWorker(key, value);
  }

  async delete(key: string): Promise<void> {
    if (key in this.data) {
      delete this.data[key];
      this.dirty = true;
      this.scheduleFlush();
    }
  }

  async getAll(): Promise<Record<string, string>> {
    return { ...this.data };
  }

  async merge(entries: Record<string, string>): Promise<void> {
    let changed = false;
    for (const [key, value] of Object.entries(entries)) {
      if (!(key in this.data)) {
        this.data[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this.dirty = true;
      this.scheduleFlush();
    }
  }
}
