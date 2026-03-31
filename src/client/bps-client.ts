import type { IAuthProvider } from "../auth/types.js";
import type { ICacheProvider } from "../services/cache.js";
import type { Config } from "../config/index.js";
import { buildUrl, ENDPOINTS } from "./endpoints.js";
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
  PageInfo,
} from "./types.js";
import { BpsApiError, BpsAuthError, BpsNotFoundError } from "../utils/error.js";
import { logger } from "../utils/logger.js";

export class BpsClient {
  private readonly baseUrl: string;
  private readonly defaultLang: string;
  private readonly defaultDomain: string;

  constructor(
    private readonly auth: IAuthProvider,
    private readonly cache: ICacheProvider | null,
    config: Config
  ) {
    this.baseUrl = config.apiBaseUrl;
    this.defaultLang = config.defaultLang;
    this.defaultDomain = config.defaultDomain;
  }

  private async request<T>(endpoint: string, params: Record<string, string | number | undefined> = {}, ttl?: number): Promise<T> {
    const authParams = await this.auth.getQueryParams();
    const authHeaders = await this.auth.getHeaders();

    const allParams: Record<string, string | number | undefined> = {
      ...params,
      ...authParams,
      lang: params.lang ?? this.defaultLang,
    };

    const url = buildUrl(this.baseUrl, endpoint, allParams);

    // Check cache
    const cacheKey = `${endpoint}:${JSON.stringify(allParams)}`;
    if (this.cache && ttl) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        logger.debug(`Cache hit: ${cacheKey}`);
        return JSON.parse(cached) as T;
      }
    }

    logger.debug(`Fetching: ${url}`);

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new BpsAuthError();
    }

    if (!res.ok) {
      throw new BpsApiError(
        `BPS API error: ${res.status} ${res.statusText}`,
        res.status,
        endpoint
      );
    }

    const json = await res.json() as T;

    // BPS API returns status field - check for errors
    const apiResponse = json as Record<string, unknown>;
    if (apiResponse.status === "400" || apiResponse["data-availability"] === "list-not-available") {
      throw new BpsNotFoundError(endpoint);
    }

    // Cache result
    if (this.cache && ttl) {
      await this.cache.set(cacheKey, JSON.stringify(json), ttl);
    }

    return json;
  }

  // ========== Domain ==========

  async listDomains(
    type: "all" | "prov" | "kab" | "kabbyprov" = "all",
    provId?: string
  ): Promise<{ data: BpsDomain[]; page?: PageInfo }> {
    const params: Record<string, string | number | undefined> = {
      type,
      prov: provId,
    };

    const res = await this.request<{ data: [PageInfo, BpsDomain[]] }>(
      ENDPOINTS.DOMAIN_LIST,
      params,
      24 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsDomain[]) ?? [] };
  }

  // ========== Subjects ==========

  async listSubjects(domain?: string, subcat?: number): Promise<{ data: BpsSubject[]; page?: PageInfo }> {
    const res = await this.request<{ data: [PageInfo, BpsSubject[]] }>(
      ENDPOINTS.SUBJECT_LIST,
      { domain: domain ?? this.defaultDomain, subcat },
      24 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsSubject[]) ?? [] };
  }

  async listSubjectCategories(domain?: string): Promise<BpsSubjectCategory[]> {
    const res = await this.request<{ data: [PageInfo, BpsSubjectCategory[]] }>(
      ENDPOINTS.SUBJECT_CATEGORY_LIST,
      { domain: domain ?? this.defaultDomain },
      24 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return res.data[1];
    }

    return (res.data as unknown as BpsSubjectCategory[]) ?? [];
  }

  // ========== Variables ==========

  async listVariables(
    domain?: string,
    subject?: number,
    year?: number,
    page?: number,
    perPage?: number
  ): Promise<{ data: BpsVariable[]; page?: PageInfo }> {
    const res = await this.request<{ data: [PageInfo, BpsVariable[]] }>(
      ENDPOINTS.VARIABLE_LIST,
      {
        domain: domain ?? this.defaultDomain,
        subject,
        year,
        page,
        perpage: perPage,
      },
      12 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsVariable[]) ?? [] };
  }

  async listVerticalVariables(domain?: string, varId?: number): Promise<BpsVerticalVariable[]> {
    const res = await this.request<{ data: [PageInfo, BpsVerticalVariable[]] }>(
      ENDPOINTS.VERTICAL_VARIABLE_LIST,
      { domain: domain ?? this.defaultDomain, var: varId },
      12 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return res.data[1];
    }

    return (res.data as unknown as BpsVerticalVariable[]) ?? [];
  }

  async listDerivedVariables(domain?: string, varId?: number): Promise<BpsDerivedVariable[]> {
    const res = await this.request<{ data: [PageInfo, BpsDerivedVariable[]] }>(
      ENDPOINTS.DERIVED_VARIABLE_LIST,
      { domain: domain ?? this.defaultDomain, var: varId },
      12 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return res.data[1];
    }

    return (res.data as unknown as BpsDerivedVariable[]) ?? [];
  }

  async listPeriods(domain?: string, varId?: number): Promise<BpsPeriod[]> {
    const res = await this.request<{ data: [PageInfo, BpsPeriod[]] }>(
      ENDPOINTS.PERIOD_LIST,
      { domain: domain ?? this.defaultDomain, var: varId },
      12 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return res.data[1];
    }

    return (res.data as unknown as BpsPeriod[]) ?? [];
  }

  async listDerivedPeriods(domain?: string, varId?: number): Promise<BpsDerivedPeriod[]> {
    const res = await this.request<{ data: [PageInfo, BpsDerivedPeriod[]] }>(
      ENDPOINTS.DERIVED_PERIOD_LIST,
      { domain: domain ?? this.defaultDomain, var: varId },
      12 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return res.data[1];
    }

    return (res.data as unknown as BpsDerivedPeriod[]) ?? [];
  }

  async listUnits(domain?: string): Promise<BpsUnit[]> {
    const res = await this.request<{ data: [PageInfo, BpsUnit[]] }>(
      ENDPOINTS.UNIT_LIST,
      { domain: domain ?? this.defaultDomain },
      24 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return res.data[1];
    }

    return (res.data as unknown as BpsUnit[]) ?? [];
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
    const res = await this.request<BpsDynamicDataResponse>(
      ENDPOINTS.DYNAMIC_DATA,
      { domain, var: varId, th, turvar, vervar, turth },
      60 * 60
    );

    return res;
  }

  // ========== Static Tables ==========

  async listStaticTables(
    domain?: string,
    keyword?: string,
    year?: number,
    month?: number,
    page?: number
  ): Promise<{ data: BpsStaticTable[]; page?: PageInfo }> {
    const res = await this.request<{ data: [PageInfo, BpsStaticTable[]] }>(
      ENDPOINTS.STATIC_TABLE_LIST,
      {
        domain: domain ?? this.defaultDomain,
        keyword,
        year,
        month,
        page,
      },
      6 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsStaticTable[]) ?? [] };
  }

  async getStaticTable(domain: string, id: number): Promise<BpsStaticTableDetail> {
    const res = await this.request<{ data: BpsStaticTableDetail }>(
      ENDPOINTS.STATIC_TABLE_DETAIL,
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
    const res = await this.request<{ data: [PageInfo, BpsPressRelease[]] }>(
      ENDPOINTS.PRESS_RELEASE_LIST,
      {
        domain: domain ?? this.defaultDomain,
        keyword,
        year,
        month,
        page,
      },
      30 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsPressRelease[]) ?? [] };
  }

  async getPressRelease(domain: string, id: number): Promise<BpsPressRelease> {
    const res = await this.request<{ data: BpsPressRelease }>(
      ENDPOINTS.PRESS_RELEASE_DETAIL,
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
    const res = await this.request<{ data: [PageInfo, BpsPublication[]] }>(
      ENDPOINTS.PUBLICATION_LIST,
      {
        domain: domain ?? this.defaultDomain,
        keyword,
        year,
        month,
        page,
      },
      6 * 60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsPublication[]) ?? [] };
  }

  async getPublication(domain: string, id: string): Promise<BpsPublication> {
    const res = await this.request<{ data: BpsPublication }>(
      ENDPOINTS.PUBLICATION_DETAIL,
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
    const res = await this.request<{ data: [PageInfo, BpsStrategicIndicator[]] }>(
      ENDPOINTS.STRATEGIC_INDICATOR_LIST,
      { domain: domain ?? this.defaultDomain, var: varId, page },
      60 * 60
    );

    if (Array.isArray(res.data) && res.data.length === 2) {
      return { data: res.data[1], page: res.data[0] };
    }

    return { data: (res.data as unknown as BpsStrategicIndicator[]) ?? [] };
  }

  // ========== Trade ==========

  async getTradeData(
    source: 1 | 2,
    hsCode: string,
    hsType: string,
    year: string,
    period: string
  ): Promise<unknown> {
    return this.request(
      ENDPOINTS.TRADE_DATA,
      { sumber: source, kodeHS: hsCode, jenisHS: hsType, tahun: year, periode: period },
      60 * 60
    );
  }

  // ========== Search ==========

  async search(
    domain: string,
    keyword: string,
    type?: string,
    page?: number
  ): Promise<unknown> {
    return this.request(
      ENDPOINTS.SEARCH,
      { domain, keyword, type, page },
      30 * 60
    );
  }
}
