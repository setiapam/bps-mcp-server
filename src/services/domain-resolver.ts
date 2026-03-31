import type { BpsClient } from "../client/bps-client.js";
import type { BpsDomain } from "../client/types.js";
import { DOMAIN_ALIASES } from "../config/domain-aliases.js";
import { logger } from "../utils/logger.js";

export class DomainResolver {
  private domains: BpsDomain[] = [];
  private nameIndex = new Map<string, string>(); // lowercase name → domain_id
  private loaded = false;

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

      for (const d of this.domains) {
        this.nameIndex.set(d.domain_name.toLowerCase(), d.domain_id);
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

    // 1. Direct code match
    const byCode = this.domains.find((d) => d.domain_id === q);
    if (byCode) return { domainId: byCode.domain_id, domainName: byCode.domain_name };

    // 2. Alias match
    const aliasId = DOMAIN_ALIASES[q];
    if (aliasId) {
      const byAlias = this.domains.find((d) => d.domain_id === aliasId);
      if (byAlias) return { domainId: byAlias.domain_id, domainName: byAlias.domain_name };
      return { domainId: aliasId, domainName: query };
    }

    // 3. Exact name match
    const exactId = this.nameIndex.get(q);
    if (exactId) {
      const d = this.domains.find((d) => d.domain_id === exactId)!;
      return { domainId: d.domain_id, domainName: d.domain_name };
    }

    // 4. Partial/contains match
    for (const [name, id] of this.nameIndex) {
      if (name.includes(q) || q.includes(name)) {
        const d = this.domains.find((d) => d.domain_id === id)!;
        return { domainId: d.domain_id, domainName: d.domain_name };
      }
    }

    // 5. Fuzzy match (simple Levenshtein)
    let bestMatch: { domainId: string; domainName: string } | null = null;
    let bestDistance = Infinity;
    const maxDistance = Math.max(3, Math.floor(q.length * 0.4));

    for (const [name, id] of this.nameIndex) {
      const dist = levenshtein(q, name);
      if (dist < bestDistance && dist <= maxDistance) {
        bestDistance = dist;
        const d = this.domains.find((d) => d.domain_id === id)!;
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

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
