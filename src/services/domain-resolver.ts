import type { BpsClient } from "../client/bps-client.js";
import type { BpsDomain } from "../client/types.js";
import { DOMAIN_ALIASES } from "../config/domain-aliases.js";
import { logger } from "../utils/logger.js";

/** Maximum number of cached resolve results */
const RESOLVE_CACHE_MAX = 100;

export class DomainResolver {
  private domains: BpsDomain[] = [];
  private nameIndex = new Map<string, string>(); // lowercase name → domain_id
  private codeIndex = new Map<string, BpsDomain>(); // domain_id → BpsDomain
  private loaded = false;

  /** LRU cache for resolve results to avoid repeated fuzzy matching */
  private resolveCache = new Map<string, { domainId: string; domainName: string } | null>();

  constructor(private readonly client: BpsClient) {}

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.loadDomains();
  }

  private async loadDomains(): Promise<void> {
    try {
      const result = await this.client.listDomains("all");
      this.domains = result.data;
      this.nameIndex.clear();
      this.codeIndex.clear();
      this.resolveCache.clear();

      for (const d of this.domains) {
        this.nameIndex.set(d.domain_name.toLowerCase(), d.domain_id);
        this.codeIndex.set(d.domain_id, d);
      }

      this.loaded = true;
      logger.info(`Domain resolver loaded ${this.domains.length} domains`);
    } catch (error) {
      logger.error("Failed to load domains", error);
      throw error;
    }
  }

  /**
   * Resolve a query (name, alias, or code) to a BPS domain code.
   * Returns null if no match found.
   */
  async resolve(query: string): Promise<{ domainId: string; domainName: string } | null> {
    await this.ensureLoaded();

    const q = query.trim().toLowerCase();

    // Check resolve cache first
    if (this.resolveCache.has(q)) {
      return this.resolveCache.get(q)!;
    }

    const result = this.resolveUncached(q, query);

    // Cache the result (LRU eviction when full)
    if (this.resolveCache.size >= RESOLVE_CACHE_MAX) {
      const firstKey = this.resolveCache.keys().next().value;
      if (firstKey !== undefined) {
        this.resolveCache.delete(firstKey);
      }
    }
    this.resolveCache.set(q, result);

    return result;
  }

  private resolveUncached(q: string, originalQuery: string): { domainId: string; domainName: string } | null {
    // 1. Direct code match (O(1) via Map)
    const byCode = this.codeIndex.get(q);
    if (byCode) return { domainId: byCode.domain_id, domainName: byCode.domain_name };

    // 2. Alias match
    const aliasId = DOMAIN_ALIASES[q];
    if (aliasId) {
      const byAlias = this.codeIndex.get(aliasId);
      if (byAlias) return { domainId: byAlias.domain_id, domainName: byAlias.domain_name };
      return { domainId: aliasId, domainName: originalQuery };
    }

    // 3. Exact name match
    const exactId = this.nameIndex.get(q);
    if (exactId) {
      const d = this.codeIndex.get(exactId)!;
      return { domainId: d.domain_id, domainName: d.domain_name };
    }

    // 4. Partial/contains match
    for (const [name, id] of this.nameIndex) {
      if (name.includes(q) || q.includes(name)) {
        const d = this.codeIndex.get(id)!;
        return { domainId: d.domain_id, domainName: d.domain_name };
      }
    }

    // 5. Fuzzy match (Levenshtein with early termination)
    let bestMatch: { domainId: string; domainName: string } | null = null;
    let bestDistance = Infinity;
    const maxDistance = Math.max(3, Math.floor(q.length * 0.4));

    for (const [name, id] of this.nameIndex) {
      const dist = levenshtein(q, name, maxDistance);
      if (dist < bestDistance && dist <= maxDistance) {
        bestDistance = dist;
        const d = this.codeIndex.get(id)!;
        bestMatch = { domainId: d.domain_id, domainName: d.domain_name };
      }
    }

    return bestMatch;
  }

  /** Get all loaded domains */
  getDomains(): BpsDomain[] {
    return this.domains;
  }
}

/**
 * Compute Levenshtein distance with optional early termination.
 * Returns Infinity if the distance exceeds maxDistance (when provided),
 * allowing callers to skip unnecessary computation.
 */
function levenshtein(a: string, b: string, maxDistance?: number): number {
  const m = a.length;
  const n = b.length;

  // Quick length-difference check
  if (maxDistance !== undefined && Math.abs(m - n) > maxDistance) {
    return Infinity;
  }

  // Use single-row optimization to reduce memory from O(m*n) to O(n)
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;

    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }

    // Early termination: if every value in the row exceeds maxDistance,
    // the final distance will too
    if (maxDistance !== undefined) {
      let rowMin = curr[0];
      for (let j = 1; j <= n; j++) {
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > maxDistance) return Infinity;
    }

    [prev, curr] = [curr, prev];
  }

  return prev[n];
}
