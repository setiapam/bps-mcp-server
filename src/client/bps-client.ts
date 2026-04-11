import type { IAuthProvider } from "../auth/types.js";
import type { ICacheProvider } from "../services/cache.js";
import type { Config } from "../config/index.js";
import {
  buildListUrl,
  buildViewUrl,
  buildDomainUrl,
  buildTradeUrl,
  buildInteropUrl,
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

/** Browser-like User-Agent to avoid BPS Perimeter WAF signature blocks */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

/** Default fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for transient errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff in milliseconds */
const RETRY_BASE_DELAY_MS = 500;

export class BpsClient {
  private readonly baseUrl: string;
  private readonly defaultLang: string;
  private readonly defaultDomain: string;

  /** In-flight request deduplication map: cacheKey → pending Promise */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly auth: IAuthProvider,
    private readonly cache: ICacheProvider | null,
    config: Config
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
        logger.debug(`Cache hit: ${cacheKey}`);
        return JSON.parse(cached) as T;
      }
    }

    // Deduplicate concurrent requests for the same cache key
    const existing = this.inflight.get(cacheKey);
    if (existing) {
      logger.debug(`Dedup hit: ${cacheKey}`);
      return existing as Promise<T>;
    }

    const promise = this.fetchWithRetry<T>(url, cacheKey, ttl);
    this.inflight.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private async fetchWithRetry<T>(url: string, cacheKey: string, ttl?: number): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.doFetch<T>(url, cacheKey, ttl);
      } catch (error) {
        lastError = error;

        // Only retry on transient server errors (5xx)
        const isRetryable =
          error instanceof BpsApiError &&
          error.statusCode !== undefined &&
          error.statusCode >= 500;

        if (!isRetryable || attempt === MAX_RETRIES - 1) {
          throw error;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`Retrying (${attempt + 1}/${MAX_RETRIES}) after ${delay}ms: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
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
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401 || res.status === 403) {
      throw new BpsAuthError();
    }

    if (!res.ok) {
      throw new BpsApiError(
        `BPS API error: ${res.status} ${res.statusText}`,
        res.status,
        url
      );
    }

    const json = await res.json() as T;

    // BPS API returns status field - check for errors
    const apiResponse = json as Record<string, unknown>;
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
    const allParams: Record<string, string | number | undefined> = {
      domain: params.domain ?? this.defaultDomain,
      ...params,
      lang: params.lang ?? this.defaultLang,
      ...auth,
    };

    const url = buildListUrl(this.baseUrl, model, allParams);
    const cacheKey = `list:${model}:${JSON.stringify(allParams)}`;
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
    const allParams: Record<string, string | number | undefined> = {
      domain: params.domain ?? this.defaultDomain,
      ...params,
      lang: params.lang ?? this.defaultLang,
      ...auth,
    };

    const url = buildViewUrl(this.baseUrl, model, allParams);
    const cacheKey = `view:${model}:${JSON.stringify(allParams)}`;
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
    const params: Record<string, string | number | undefined> = {
      type,
      prov: provId,
      lang: this.defaultLang,
      ...auth,
    };

    const url = buildDomainUrl(this.baseUrl, params);
    const cacheKey = `domain:${JSON.stringify(params)}`;
    const res = await this.fetchJson<{ data: [PageInfo, BpsDomain[]] }>(url, cacheKey, 24 * 60 * 60);
    return this.extractPaginated(res);
  }

  // ========== Subjects ==========

  async listSubjects(domain?: string, subcat?: number): Promise<{ data: BpsSubject[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsSubject[]] }>(
      MODELS.SUBJECT,
      { domain, subcat },
      24 * 60 * 60
    );
    return this.extractPaginated(res);
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

  async listVerticalVariables(domain?: string, varId?: number): Promise<BpsVerticalVariable[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsVerticalVariable[]] }>(
      MODELS.VERTICAL_VARIABLE,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listDerivedVariables(domain?: string, varId?: number): Promise<BpsDerivedVariable[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsDerivedVariable[]] }>(
      MODELS.DERIVED_VARIABLE,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listPeriods(domain?: string, varId?: number): Promise<BpsPeriod[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsPeriod[]] }>(
      MODELS.PERIOD,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listDerivedPeriods(domain?: string, varId?: number): Promise<BpsDerivedPeriod[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsDerivedPeriod[]] }>(
      MODELS.DERIVED_PERIOD,
      { domain, var: varId },
      12 * 60 * 60
    );
    return this.extractPaginated(res).data;
  }

  async listUnits(domain?: string): Promise<BpsUnit[]> {
    const res = await this.listRequest<{ data: [PageInfo, BpsUnit[]] }>(
      MODELS.UNIT,
      { domain },
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
    return this.listRequest<BpsDynamicDataResponse>(
      MODELS.DATA,
      { domain, var: varId, th, turvar, vervar, turth },
      60 * 60
    );
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
    const cacheKey = `trade:${JSON.stringify(params)}`;
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

  async listCsaSubjects(domain?: string, subcat?: number): Promise<{ data: BpsCsaSubject[]; page?: PageInfo }> {
    const res = await this.listRequest<{ data: [PageInfo, BpsCsaSubject[]] }>(
      MODELS.CSA_SUBJECT,
      { domain, subcat },
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

  async getCsaTable(domain: string, id: string): Promise<BpsCsaTableDetail> {
    const res = await this.viewRequest<{ data: BpsCsaTableDetail }>(
      MODELS.CSA_TABLE,
      { domain, id },
      6 * 60 * 60
    );
    return res.data;
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
