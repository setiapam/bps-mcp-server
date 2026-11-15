import type { IAuthProvider } from "../auth/types.js";
import type { ICacheProvider } from "../services/cache.js";
import type { Config } from "../config/index.js";
import {
  buildListUrl,
  buildViewUrl,
  buildDomainUrl,
  buildTradeUrl,
  buildInteropUrl,
  normalizePathParam,
  MODELS,
} from "./endpoints.js";
import type {
  BpsDomain,
  BpsSubject,
  BpsSubjectCategory,
  BpsVariable,
  BpsVerticalVariable,
  BpsDerivedVariable,
  BpsPeriod,
  BpsDerivedPeriod,
  BpsUnit,
  BpsDynamicDataResponse,
  BpsStaticTable,
  BpsStaticTableDetail,
  BpsPressRelease,
  BpsPublication,
  BpsStrategicIndicator,
  BpsInfographic,
  BpsInfographicDetail,
  BpsNews,
  BpsNewsDetail,
  BpsGlossaryTerm,
  BpsCsaSubjectCategory,
  BpsCsaSubject,
  BpsCsaTable,
  BpsCsaTableDetail,
  BpsCensusEvent,
  BpsCensusTopic,
  PageInfo,
} from "./types.js";
import { BpsApiError, BpsAuthError, BpsNotFoundError } from "../utils/error.js";
import { logger } from "../utils/logger.js";
import { getPeriodId, getVariableId, getVervarId } from "./fields.js";
import { defaultScheduler, type RequestScheduler } from "./request-scheduler.js";

/** Browser-like User-Agent to avoid BPS Perimeter WAF signature blocks */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

/** Default fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for transient errors */
const MAX_RETRIES = 3;

/** Rate limiting deserves more patience than a transient server error. */
const MAX_RATE_LIMIT_RETRIES = 5;

/** Base delay for exponential backoff in milliseconds */
const RETRY_BASE_DELAY_MS = 500;

/** BPS rejects requests with more than 3 periods in one call. */
const MAX_PERIODS_PER_REQUEST = 3;

/** Read a Response body as text, with a JSON fallback for lightweight mocks. */
async function readResponseText(res: Response): Promise<string> {
  if (typeof res.text === "function") return res.text();
  if (typeof res.json === "function") {
    try {
      return JSON.stringify(await res.json());
    } catch {
      return "";
    }
  }
  return "";
}

/** Extract a useful message from a BPS error body (JSON or HTML). */
function extractApiError(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    const errors = parsed.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as Record<string, unknown>;
      if (typeof first.detail === "string" && first.detail.trim()) return first.detail.trim();
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // BPS sometimes returns an HTML WAF page instead of JSON.
  }
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : undefined;
}

/** Read the Retry-After header (seconds) from a response, if present. */
function readRetryAfter(res: Response): number | undefined {
  const header = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeUnique<T>(
  target: T[],
  source: T[] | undefined,
  keyOf: (item: T) => string
): void {
  if (!source) return;
  const seen = new Set(target.map(keyOf));
  for (const item of source) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

function mergeDynamicData(
  target: BpsDynamicDataResponse,
  source: BpsDynamicDataResponse
): void {
  if (!target.datacontent) target.datacontent = {};
  Object.assign(target.datacontent, source.datacontent ?? {});

  target.var = target.var ?? [];
  target.vervar = target.vervar ?? [];
  target.tahun = target.tahun ?? [];
  target.turvar = target.turvar ?? [];
  target.turtahun = target.turtahun ?? [];

  mergeUnique(target.var, source.var, (v) => String(v.var_id ?? (v as unknown as Record<string, unknown>).val ?? ""));
  mergeUnique(target.vervar, source.vervar, (v) => String(v.kode_vervar ?? v.kode_ver_id ?? v.val ?? ""));
  mergeUnique(target.tahun, source.tahun, (v) => String(v.th_id ?? v.val ?? v.th_name ?? v.label ?? ""));
  mergeUnique(target.turvar, source.turvar, (v) => String(v.kode_turvar ?? v.kode_tur_id ?? v.val ?? ""));
  mergeUnique(target.turtahun, source.turtahun, (v) => String(v.turth_id ?? v.val ?? v.turth_name ?? v.label ?? ""));

  target.labelvervar = target.labelvervar ?? source.labelvervar;
  target.turvar_label = target.turvar_label ?? source.turvar_label;
  if (source["data-availability"] === "available") {
    target["data-availability"] = "available";
  }
  if (!target.message && source.message) target.message = source.message;
}

export class BpsClient {
  private readonly baseUrl: string;
  private readonly defaultLang: string;
  private readonly defaultDomain: string;

  /** In-flight request deduplication map: cacheKey → pending Promise */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly auth: IAuthProvider,
    private readonly cache: ICacheProvider | null,
    config: Config,
    private readonly scheduler: RequestScheduler = defaultScheduler
  ) {
    this.baseUrl = config.apiBaseUrl;
    this.defaultLang = config.defaultLang;
    this.defaultDomain = config.defaultDomain;
  }

  private async fetchJson<T>(url: string, cacheKey: string, ttl?: number): Promise<T> {
    // Check cache
    if (this.cache && ttl) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        try {
          logger.debug(`Cache hit: ${cacheKey}`);
          return JSON.parse(cached) as T;
        } catch {
          logger.warn(`Ignoring corrupt cache entry: ${cacheKey}`);
          await this.cache.delete(cacheKey);
        }
      }
    }

    // Deduplicate concurrent requests for the same cache key
    const existing = this.inflight.get(cacheKey);
    if (existing) {
      logger.debug(`Dedup hit: ${cacheKey}`);
      return existing as Promise<T>;
    }

    // The scheduler keeps agents from hammering BPS into a 429 storm.
    const promise = this.scheduler.run<T>(() => this.fetchWithRetry<T>(url, cacheKey, ttl));
    this.inflight.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private async fetchWithRetry<T>(url: string, cacheKey: string, ttl?: number): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.doFetch<T>(url, cacheKey, ttl);
      } catch (error) {
        // Retry transient server errors, and be extra patient with BPS rate
        // limiting (429) since it can last several seconds. A 500 whose body
        // says the endpoint is unregistered/unavailable is permanent: retrying
        // it only burns calls and seconds (the glossary endpoint does this).
        const status = error instanceof BpsApiError ? error.statusCode : undefined;
        const isRateLimited = status === 429;
        const permanentOutage =
          error instanceof BpsApiError &&
          /service is currently unavailable|have yet to be registered in the routes/i.test(error.message);
        const isRetryable =
          !permanentOutage && (isRateLimited || (status !== undefined && (status >= 500 || status === 408)));
        const maxAttempts = isRateLimited ? MAX_RATE_LIMIT_RETRIES : MAX_RETRIES;

        if (!isRetryable || attempt >= maxAttempts - 1) {
          throw error;
        }

        // Prefer the server's Retry-After hint over blind exponential backoff,
        // but cap it: a 60s BPS stall would block the whole tool call.
        const retryAfterMs =
          error instanceof BpsApiError && error.retryAfterSeconds
            ? Math.min(error.retryAfterSeconds, 10) * 1000
            : 0;
        const backoff = isRateLimited
          ? 2_000 * Math.pow(2, attempt)
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        const delay = Math.max(retryAfterMs, backoff);
        logger.warn(`Retrying (${attempt + 1}/${maxAttempts}) after ${delay}ms: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async doFetch<T>(url: string, cacheKey: string, ttl?: number): Promise<T> {
    logger.debug(`Fetching: ${url}`);

    const authHeaders = await this.auth.getHeaders();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          ...authHeaders,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new BpsApiError(`Request timeout after ${FETCH_TIMEOUT_MS}ms`, 408, url);
      }
      
      // Dynamic fallback to proxy on network failure
      if (url.includes("https://webapi.bps.go.id/v1")) {
        try {
          const { setWafBlockedStatus } = await import("../utils/routing-fallback.js");
          setWafBlockedStatus(true);
        } catch {
          // ignore
        }
        const proxyBase = "https://bps-api.murphi.my.id/v1";
        const rewrittenUrl = url.replace("https://webapi.bps.go.id/v1", proxyBase);
        logger.warn(`Direct access network error (${error}). Retrying via proxy: ${rewrittenUrl}`);
        
        res = await fetch(rewrittenUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            ...authHeaders,
          },
          signal: controller.signal,
        });
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 403 || res.status === 1020) {
      const text = await res.text();
      const isWaf = text.includes("cloudflare") || text.includes("WAF") || text.includes("Access Denied") || text.includes("error-code");
      if (isWaf && url.includes("https://webapi.bps.go.id/v1")) {
        try {
          const { setWafBlockedStatus } = await import("../utils/routing-fallback.js");
          setWafBlockedStatus(true);
        } catch {
          // ignore
        }
        const proxyBase = "https://bps-api.murphi.my.id/v1";
        const rewrittenUrl = url.replace("https://webapi.bps.go.id/v1", proxyBase);
        logger.warn(`Direct access WAF block detected (status ${res.status}). Retrying via proxy: ${rewrittenUrl}`);
        
        const retryRes = await fetch(rewrittenUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            ...authHeaders,
          },
          signal: controller.signal,
        });
        
        if (retryRes.status === 401 || retryRes.status === 403) {
          throw new BpsAuthError();
        }
        if (!retryRes.ok) {
          const detail = extractApiError(await readResponseText(retryRes));
          throw new BpsApiError(
            detail ?? `HTTP ${retryRes.status} ${retryRes.statusText} (proxied)`,
            retryRes.status,
            rewrittenUrl
          );
        }
        res = retryRes;
      } else {
        throw new BpsAuthError();
      }
    } else if (res.status === 401) {
      throw new BpsAuthError();
    }

    if (!res.ok) {
      const detail = extractApiError(await readResponseText(res));
      throw new BpsApiError(
        detail ?? `HTTP ${res.status} ${res.statusText}`,
        res.status,
        url,
        readRetryAfter(res)
      );
    }

    let json: T;
    try {
      json = JSON.parse(await readResponseText(res)) as T;
    } catch (parseError) {
      if (url.includes("https://webapi.bps.go.id/v1")) {
        try {
          const { setWafBlockedStatus } = await import("../utils/routing-fallback.js");
          setWafBlockedStatus(true);
        } catch {
          // ignore
        }
        const proxyBase = "https://bps-api.murphi.my.id/v1";
        const rewrittenUrl = url.replace("https://webapi.bps.go.id/v1", proxyBase);
        logger.warn(`JSON parsing failed (could be WAF block with empty/HTML body). Retrying via proxy: ${rewrittenUrl}`);

        const retryRes = await fetch(rewrittenUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            ...authHeaders,
          },
          signal: controller.signal,
        });

        if (!retryRes.ok) {
          const detail = extractApiError(await readResponseText(retryRes));
          throw new BpsApiError(
            detail ?? `HTTP ${retryRes.status} ${retryRes.statusText} (proxied after parse failure)`,
            retryRes.status,
            rewrittenUrl
          );
        }

        try {
          json = JSON.parse(await readResponseText(retryRes)) as T;
        } catch (retryParseError) {
          throw new BpsApiError(
            `Failed to parse proxied BPS response as JSON: ${retryParseError instanceof Error ? retryParseError.message : String(retryParseError)}`,
            retryRes.status,
            rewrittenUrl
          );
        }
      } else {
        throw new BpsApiError(
          `Failed to parse BPS API response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          res.status,
          url
        );
      }
    }

    // BPS API returns status field - check for errors
    const apiResponse = json as Record<string, unknown>;
    if (typeof apiResponse.status === "string" && /^error$/i.test(apiResponse.status)) {
      throw new BpsApiError(
        String(apiResponse.message ?? "BPS API returned an error"),
        res.status,
        url
      );
    }
    if (apiResponse.status === "400" || apiResponse["data-availability"] === "list-not-available") {
      throw new BpsNotFoundError(cacheKey);
    }

    // Cache result
    if (this.cache && ttl) {
      await this.cache.set(cacheKey, JSON.stringify(json), ttl);
    }

    return json;
  }

  private async authParams(): Promise<Record<string, string>> {
    return this.auth.getQueryParams();
  }

  /**
   * Perform a list request: /api/list/model/{model}/...
   */
  private async listRequest<T>(
    model: string,
    params: Record<string, string | number | undefined>,
    ttl?: number
  ): Promise<T> {
    const auth = await this.authParams();
    const baseParams: Record<string, string | number | undefined> = {
      domain: params.domain ?? this.defaultDomain,
      ...params,
      lang: params.lang ?? this.defaultLang,
    };
    const allParams = { ...baseParams, ...auth };

    const url = buildListUrl(this.baseUrl, model, allParams);
    const cacheKey = `list:${model}:${JSON.stringify(baseParams)}`;
    return this.fetchJson<T>(url, cacheKey, ttl);
  }

  /**
   * Perform a view request: /api/view/model/{model}/...
   */
  private async viewRequest<T>(
    model: string,
    params: Record<string, string | number | undefined>,
    ttl?: number
  ): Promise<T> {
    const auth = await this.authParams();
    const baseParams: Record<string, string | number | undefined> = {
      domain: params.domain ?? this.defaultDomain,
      ...params,
      lang: params.lang ?? this.defaultLang,
    };
    const allParams = { ...baseParams, ...auth };

    const url = buildViewUrl(this.baseUrl, model, allParams);
    const cacheKey = `view:${model}:${JSON.stringify(baseParams)}`;
    return this.fetchJson<T>(url, cacheKey, ttl);
  }

  private extractPaginated<T>(res: { data: [PageInfo, T[]] }): { data: T[]; page?: PageInfo } {
    if (Array.isArray(res.data) && res.data.length === 2 && typeof res.data[0] === "object" && "page" in res.data[0]) {
      return { data: res.data[1], page: res.data[0] };
    }
    // Fallback: data might be a flat array in some edge cases
    return { data: (res.data as unknown as T[]) ?? [] };
  }

  // ========== Domain ==========

  async listDomains(
    type: "all" | "prov" | "kab" | "kabbyprov" = "all",
    provId?: string
  ): Promise<{ data: BpsDomain[]; page?: PageInfo }> {
    const auth = await this.authParams();
    const baseParams = { type, prov: provId, lang: this.defaultLang };
    const params: Record<string, string | number | undefined> = {
      ...baseParams,
      ...auth,
    };

    const url = buildDomainUrl(this.baseUrl, params);
    const cacheKey = `domain:${type}:${provId || "all"}`;
    const res = await this.fetchJson<{ data: [PageInfo, BpsDomain[]] }>(url, cacheKey, 24 * 60 * 60);
    return this.extractPaginated(res);
  }

  // ========== Subjects ==========

  async listSubjects(
    domain?: string,
    subcat?: number,
    page?: number
  ): Promise<{ data: BpsSubject[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsSubject[]] }>(
      MODELS.SUBJECT,
      { domain, subcat, page },
      24 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  /**
   * Fetch every subject page. The API returns 10 items per page, so a single
   * `listSubjects()` call only exposes a fraction of the national subjects.
   */
  async listAllSubjects(domain?: string, subcat?: number): Promise<BpsSubject[]> {
    const first = await this.listSubjects(domain, subcat, 1);
    const all = [...first.data];
    const pages = Math.min(first.page?.pages ?? 1, 20);
    for (let page = 2; page <= pages; page++) {
      const next = await this.listSubjects(domain, subcat, page);
      if (next.data.length === 0) break;
      all.push(...next.data);
    }
    return dedupeBy(all, (s) => String(s.sub_id));
  }

  async listSubjectCategories(domain?: string): Promise<BpsSubjectCategory[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsSubjectCategory[]] }>(
      MODELS.SUBJECT_CATEGORY,
      { domain },
      24 * 60 * 60
    );
    const result = this.extractPaginated(res);
    return result.data;
  }

  // ========== Variables ==========

  async listVariables(
    domain?: string,
    subject?: number,
    year?: number,
    page?: number,
    perPage?: number
  ): Promise<{ data: BpsVariable[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsVariable[]] }>(
      MODELS.VARIABLE,
      { domain, subject, year, page, perpage: perPage },
      12 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  /** Fetch up to `maxPages` variable pages for one subject (API caps at 10/page). */
  async listAllVariables(
    domain?: string,
    subject?: number,
    year?: number,
    maxPages = 10
  ): Promise<BpsVariable[]> {
    const first = await this.listVariables(domain, subject, year, 1, 100);
    const all = [...first.data];
    const pages = Math.min(first.page?.pages ?? 1, maxPages);
    for (let page = 2; page <= pages; page++) {
      const next = await this.listVariables(domain, subject, year, page, 100);
      if (next.data.length === 0) break;
      all.push(...next.data);
    }
    return dedupeBy(all, (v) => String(v.var_id));
  }

  async listVerticalVariables(domain?: string, varId?: number): Promise<BpsVerticalVariable[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsVerticalVariable[]] }>(
      MODELS.VERTICAL_VARIABLE,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  /**
   * Fetch every vertical-variable page. The API returns 10 rows per page, so a
   * single call silently hides most kabupaten/kota categories (Sulawesi
   * Selatan has 24, for example).
   */
  async listAllVerticalVariables(
    domain?: string,
    varId?: number,
    maxPages = 20
  ): Promise<BpsVerticalVariable[]> {
    const first = await this.listRequest<{ data: [PageInfo, BpsVerticalVariable[]] }>(
      MODELS.VERTICAL_VARIABLE,
      { domain, var: varId, page: 1 },
      12 * 60 * 60
    );
    const firstPage = this.extractPaginated(first);
    const all = [...firstPage.data];
    const pages = Math.min(firstPage.page?.pages ?? 1, maxPages);
    for (let page = 2; page <= pages; page++) {
      const res = await this.listRequest<{ data: [PageInfo, BpsVerticalVariable[]] }>(
        MODELS.VERTICAL_VARIABLE,
        { domain, var: varId, page },
        12 * 60 * 60
      );
      const next = this.extractPaginated(res).data;
      if (next.length === 0) break;
      all.push(...next);
    }
    return dedupeBy(all, (v) => String(getVervarId(v)));
  }

  async listAllDerivedVariables(
    domain?: string,
    varId?: number,
    maxPages = 10
  ): Promise<BpsDerivedVariable[]> {
    const first = await this.listRequest<{ data: [PageInfo, BpsDerivedVariable[]] }>(
      MODELS.DERIVED_VARIABLE,
      { domain, var: varId, page: 1 },
      12 * 60 * 60
    );
    const firstPage = this.extractPaginated(first);
    const all = [...firstPage.data];
    const pages = Math.min(firstPage.page?.pages ?? 1, maxPages);
    for (let page = 2; page <= pages; page++) {
      const res = await this.listRequest<{ data: [PageInfo, BpsDerivedVariable[]] }>(
        MODELS.DERIVED_VARIABLE,
        { domain, var: varId, page },
        12 * 60 * 60
      );
      const next = this.extractPaginated(res).data;
      if (next.length === 0) break;
      all.push(...next);
    }
    return dedupeBy(all, (v) => String(v.kode_turvar ?? v.kode_tur_id ?? v.val ?? ""));
  }

  async listDerivedVariables(domain?: string, varId?: number): Promise<BpsDerivedVariable[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsDerivedVariable[]] }>(
      MODELS.DERIVED_VARIABLE,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listPeriods(domain?: string, varId?: number, page?: number): Promise<BpsPeriod[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsPeriod[]] }>(
      MODELS.PERIOD,
      { domain, var: varId, page },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  /** Fetch every period page (important for long historical ranges). */
  async listAllPeriods(domain?: string, varId?: number, maxPages = 10): Promise<BpsPeriod[]> {
    const firstPage = await this.listRequest<{ data: [PageInfo, BpsPeriod[]] }>(
      MODELS.PERIOD,
      { domain, var: varId, page: 1 },
      12 * 60 * 60
    );
    const first = this.extractPaginated(firstPage);
    const all = [...first.data];
    if (all.length === 0) return all;

    const pages = Math.min(first.page?.pages ?? 1, maxPages);
    for (let page = 2; page <= pages; page++) {
      const next = await this.listPeriods(domain, varId, page);
      if (next.length === 0) break;
      all.push(...next);
    }
    return dedupeBy(all, (p) => String(p.th_id ?? p.val ?? p.th ?? p.label ?? ""));
  }

  async listDerivedPeriods(domain?: string, varId?: number): Promise<BpsDerivedPeriod[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsDerivedPeriod[]] }>(
      MODELS.DERIVED_PERIOD,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listUnits(domain?: string, page?: number): Promise<BpsUnit[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsUnit[]] }>(
      MODELS.UNIT,
      { domain, page },
      24 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  // ========== Dynamic Data ==========

  async getDynamicData(
    domain: string,
    varId: string,
    th?: string,
    turvar?: string,
    vervar?: string,
    turth?: string
  ): Promise<BpsDynamicDataResponse> {
    const normalizedVar = normalizePathParam("var", varId);
    const normalizedTh = th ? normalizePathParam("th", th) : undefined;
    const periods = normalizedTh ? normalizedTh.split(";").filter(Boolean) : [];

    // The API rejects more than 3 periods in one request. Split and merge.
    if (periods.length <= MAX_PERIODS_PER_REQUEST) {
      return this.listRequest<BpsDynamicDataResponse>(
        MODELS.DATA,
        { domain, var: normalizedVar, th: normalizedTh, turvar, vervar, turth },
        60 * 60
      );
    }

    let merged: BpsDynamicDataResponse | null = null;
    let lastError: unknown = null;

    for (let index = 0; index < periods.length; index += MAX_PERIODS_PER_REQUEST) {
      const chunk = periods.slice(index, index + MAX_PERIODS_PER_REQUEST).join(";");
      try {
        const response = await this.listRequest<BpsDynamicDataResponse>(
          MODELS.DATA,
          { domain, var: normalizedVar, th: chunk, turvar, vervar, turth },
          60 * 60
        );
        if (!merged) {
          merged = response;
        } else {
          mergeDynamicData(merged, response);
        }
      } catch (error) {
        // A missing period should not discard the other chunks.
        if (error instanceof BpsNotFoundError) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    if (!merged) {
      if (lastError instanceof Error) throw lastError;
      throw new BpsNotFoundError(`data:${domain}:${normalizedVar}`);
    }
    return merged;
  }

  // ========== Static Tables ==========

  async listStaticTables(
    domain?: string,
    keyword?: string,
    year?: number,
    month?: number,
    page?: number
  ): Promise<{ data: BpsStaticTable[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsStaticTable[]] }>(
      MODELS.STATIC_TABLE,
      { domain, keyword, year, month, page },
      6 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  async getStaticTable(domain: string, id: number): Promise<BpsStaticTableDetail> {
    const res = await this.viewRequest<{ data: BpsStaticTableDetail }>(
      MODELS.STATIC_TABLE,
      { domain, id },
      6 * 60 * 60
    );
    return res.data;
  }

  // ========== Press Releases ==========

  async listPressReleases(
    domain?: string,
    keyword?: string,
    year?: number,
    month?: number,
    page?: number
  ): Promise<{ data: BpsPressRelease[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsPressRelease[]] }>(
      MODELS.PRESS_RELEASE,
      { domain, keyword, year, month, page },
      30 * 60
    );
    return this.extractPaginated(res);
  }

  async getPressRelease(domain: string, id: number): Promise<BpsPressRelease> {
    const res = await this.viewRequest<{ data: BpsPressRelease }>(
      MODELS.PRESS_RELEASE,
      { domain, id },
      30 * 60
    );
    return res.data;
  }

  // ========== Publications ==========

  async listPublications(
    domain?: string,
    keyword?: string,
    year?: number,
    month?: number,
    page?: number
  ): Promise<{ data: BpsPublication[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsPublication[]] }>(
      MODELS.PUBLICATION,
      { domain, keyword, year, month, page },
      6 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  async getPublication(domain: string, id: string): Promise<BpsPublication> {
    const res = await this.viewRequest<{ data: BpsPublication }>(
      MODELS.PUBLICATION,
      { domain, id },
      6 * 60 * 60
    );
    return res.data;
  }

  // ========== Strategic Indicators ==========

  async listStrategicIndicators(
    domain?: string,
    varId?: number,
    page?: number
  ): Promise<{ data: BpsStrategicIndicator[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsStrategicIndicator[]] }>(
      MODELS.STRATEGIC_INDICATOR,
      { domain, var: varId, page },
      60 * 60
    );
    return this.extractPaginated(res);
  }

  // ========== Trade ==========

  async getTradeData(
    source: 1 | 2,
    hsCode: string,
    hsType: string,
    year: string,
    period: string
  ): Promise<unknown> {
    const auth = await this.authParams();
    const params: Record<string, string | number | undefined> = {
      sumber: source,
      kodehs: hsCode,
      jenishs: hsType,
      tahun: year,
      periode: period,
      lang: this.defaultLang,
      ...auth,
    };

    const url = buildTradeUrl(this.baseUrl, params);
    const cacheKey = `trade:${source}:${hsCode}:${hsType}:${year}:${period}`;
    return this.fetchJson(url, cacheKey, 60 * 60);
  }

  // ========== Infographics ==========

  async listInfographics(
    domain?: string,
    keyword?: string,
    page?: number
  ): Promise<{ data: BpsInfographic[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsInfographic[]] }>(
      MODELS.INFOGRAPHIC,
      { domain, keyword, page },
      6 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  async getInfographic(domain: string, id: number): Promise<BpsInfographicDetail> {
    const res = await this.viewRequest<{ data: BpsInfographicDetail }>(
      MODELS.INFOGRAPHIC,
      { domain, id },
      6 * 60 * 60
    );
    return res.data;
  }

  // ========== News ==========

  async listNews(
    domain?: string,
    keyword?: string,
    page?: number
  ): Promise<{ data: BpsNews[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsNews[]] }>(
      MODELS.NEWS,
      { domain, keyword, page },
      30 * 60
    );
    return this.extractPaginated(res);
  }

  async getNews(domain: string, id: number): Promise<BpsNewsDetail> {
    const res = await this.viewRequest<{ data: BpsNewsDetail }>(
      MODELS.NEWS,
      { domain, id },
      30 * 60
    );
    return res.data;
  }

  // ========== Glossary (Glosarium) ==========

  async listGlossary(
    domain?: string,
    keyword?: string,
    page?: number
  ): Promise<{ data: BpsGlossaryTerm[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsGlossaryTerm[]] }>(
      MODELS.GLOSSARY,
      { domain, keyword, page },
      24 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  // ========== CSA (Classification of Statistical Activities) ==========

  async listCsaSubjectCategories(domain?: string): Promise<BpsCsaSubjectCategory[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsCsaSubjectCategory[]] }>(
      MODELS.CSA_SUBJECT_CATEGORY,
      { domain },
      24 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listCsaSubjects(
    domain?: string,
    subcat?: number,
    page?: number
  ): Promise<{ data: BpsCsaSubject[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsCsaSubject[]] }>(
      MODELS.CSA_SUBJECT,
      { domain, subcat, page },
      24 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  async listCsaTables(
    domain?: string,
    subject?: number,
    page?: number
  ): Promise<{ data: BpsCsaTable[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsCsaTable[]] }>(
      MODELS.CSA_TABLE,
      { domain, subject, page },
      6 * 60 * 60
    );
    return this.extractPaginated(res);
  }

  async getCsaTable(
    domain: string,
    id: string
  ): Promise<BpsCsaTableDetail | BpsDynamicDataResponse> {
    const res = await this.viewRequest<{
      data?: BpsCsaTableDetail;
      var?: BpsVariable[];
      datacontent?: Record<string, number | string>;
    }>(
      MODELS.CSA_TABLE,
      { domain, id },
      6 * 60 * 60
    );

    // Older responses expose a pre-rendered HTML table.
    if (res.data) return res.data;

    // Current CSA view returns a dynamic table (metadata + empty datacontent).
    // Resolve its variable, pick the latest period, then use the data endpoint.
    const varId = getVariableId(res.var?.[0]);
    if (!varId) {
      throw new BpsApiError("Tabel CSA tidak memiliki metadata variabel yang bisa dibaca", 502, id);
    }

    const periods = await this.listPeriods(domain, Number(varId), 1);
    const periodId = periods[0] ? getPeriodId(periods[0]) : undefined;
    const data = await this.getDynamicData(domain, varId, periodId || undefined);
    data.var = data.var ?? res.var;
    return data;
  }

  // ========== Census (Sensus) via Interoperabilitas ==========

  async listCensusEvents(): Promise<BpsCensusEvent[]> {
    const auth = await this.authParams();
    const url = buildInteropUrl(this.baseUrl, "sensus", { id: 37, ...auth });
    const cacheKey = `census:events`;
    const res = await this.fetchJson<{ data: [PageInfo, BpsCensusEvent[]] }>(url, cacheKey, 24 * 60 * 60);
    return this.extractPaginated(res).data;
  }

  async listCensusTopics(kegiatan: string): Promise<BpsCensusTopic[]> {
    const auth = await this.authParams();
    const url = buildInteropUrl(this.baseUrl, "sensus", { id: 38, kegiatan, ...auth });
    const cacheKey = `census:topics:${kegiatan}`;
    const res = await this.fetchJson<{ data: [PageInfo, BpsCensusTopic[]] }>(url, cacheKey, 24 * 60 * 60);
    return this.extractPaginated(res).data;
  }

  // ========== Search ==========

  async search(
    domain: string,
    keyword: string,
    model?: string,
    page?: number
  ): Promise<{ data: unknown[]; page?: PageInfo }> {
    const listModel = model ?? MODELS.STATIC_TABLE;
    const res = await this.listRequest<{ data: [PageInfo, unknown[]] }>(
      listModel,
      { domain, keyword, page },
      30 * 60
    );
    return this.extractPaginated(res);
  }
}
