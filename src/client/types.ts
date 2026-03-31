/** Generic BPS API response wrapper */
export interface BpsApiResponse<T> {
  status: string;
  "data-availability": string;
  data: T;
  message?: string;
}

/** Paginated BPS API response */
export interface BpsPaginatedResponse<T> {
  status: string;
  "data-availability": string;
  data: [PageInfo, T[]];
  message?: string;
}

export interface PageInfo {
  page: number;
  pages: number;
  total: number;
  per_page: number;
  count: number;
}

/** Domain/Region */
export interface BpsDomain {
  domain_id: string;
  domain_name: string;
  domain_url: string;
}

/** Subject */
export interface BpsSubject {
  sub_id: number;
  title: string;
  subcat_id?: number;
  subcat?: string;
  ntabel?: number;
  nvar?: number;
}

/** Subject Category */
export interface BpsSubjectCategory {
  subcat_id: number;
  title: string;
}

/** Variable */
export interface BpsVariable {
  var_id: number;
  title: string;
  sub_id: number;
  sub_name: string;
  def?: string;
  notes?: string;
  unit?: string;
  graph_id?: number;
  graph_name?: string;
}

/** Vertical Variable */
export interface BpsVerticalVariable {
  kode_vervar: number;
  label_vervar: string;
  group_vervar: number;
  name_group_vervar: string;
}

/** Derived Variable */
export interface BpsDerivedVariable {
  kode_turvar: number;
  label_turvar: string;
  group_turvar: number;
  name_group_turvar: string;
}

/** Period */
export interface BpsPeriod {
  th_id: number;
  th_name: string;
  val: number;
}

/** Derived Period */
export interface BpsDerivedPeriod {
  turth_id: number;
  turth_name: string;
}

/** Unit */
export interface BpsUnit {
  unit_id: number;
  unit: string;
}

/** Dynamic data response */
export interface BpsDynamicDataResponse {
  status: string;
  "data-availability": string;
  data: unknown; // varies by endpoint
  datacontent?: Record<string, number | string>;
  vervar?: BpsVerticalVariable[];
  turvar?: BpsDerivedVariable[];
  tahun?: BpsPeriod[];
  turtahun?: BpsDerivedPeriod[];
  var?: BpsVariable[];
  labelvervar?: string;
  turvar_label?: string;
  message?: string;
}

/** Static Table */
export interface BpsStaticTable {
  table_id: number;
  title: string;
  subj_id: number;
  subj?: string;
  updt_date: string;
  size: string;
  excel?: string;
}

/** Static Table Detail */
export interface BpsStaticTableDetail {
  table_id: number;
  title: string;
  subj_id: number;
  subj?: string;
  table: string; // HTML table content
  updt_date: string;
  size: string;
  excel?: string;
}

/** Press Release */
export interface BpsPressRelease {
  brs_id: number;
  title: string;
  subj_id: number;
  subj?: string;
  rl_date: string;
  abstract?: string;
  pdf?: string;
  size?: string;
}

/** Publication */
export interface BpsPublication {
  pub_id: string;
  title: string;
  issn?: string;
  sch_date: string;
  rl_date: string;
  abstract?: string;
  cover?: string;
  pdf?: string;
  size?: string;
}

/** Strategic Indicator */
export interface BpsStrategicIndicator {
  indicator_id: number;
  title: string;
  sub_id: number;
  sub_name: string;
  data?: Record<string, number | string>;
}

/** Trade HS data */
export interface BpsTradeData {
  hs_code: string;
  description: string;
  data?: Record<string, number>;
}
