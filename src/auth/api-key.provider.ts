import type { AuthResult, IAuthProvider } from "./types.js";

export class ApiKeyProvider implements IAuthProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("BPS_API_KEY is required for api-key auth type");
    }
    this.apiKey = apiKey;
  }

  async authenticate(): Promise<AuthResult> {
    return { authenticated: true, type: "api-key" };
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }

  async getQueryParams(): Promise<Record<string, string>> {
    return { key: this.apiKey };
  }

  isExpired(): boolean {
    return false;
  }

  async refresh(): Promise<void> {
    // API keys don't expire
  }

  getType(): "api-key" {
    return "api-key";
  }
}
