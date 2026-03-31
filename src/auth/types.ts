export interface AuthResult {
  authenticated: boolean;
  type: "api-key" | "oauth2";
}

export interface IAuthProvider {
  authenticate(): Promise<AuthResult>;
  getHeaders(): Promise<Record<string, string>>;
  getQueryParams(): Promise<Record<string, string>>;
  isExpired(): boolean;
  refresh(): Promise<void>;
  getType(): "api-key" | "oauth2";
}
