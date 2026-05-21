/**
 * Persistent learning store for variable and period mappings.
 * Separate from ICacheProvider — not affected by cache_clear.
 */
export interface IPersistentStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Return all entries (for sync). */
  getAll(): Promise<Record<string, string>>;
  /** Merge remote entries into local store. */
  merge(entries: Record<string, string>): Promise<void>;
}
