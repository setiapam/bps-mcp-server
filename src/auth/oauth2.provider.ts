import type { AuthResult, IAuthProvider } from "./types.js";

/**
 * OAuth2 provider for future WSO2 BPS API v2.
 * Placeholder implementation — will be completed when BPS releases v2.
 */
export class OAuth2Provider implements IAuthProvider {
  private accessToken: string | null = null;
  private expiresAt: number = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenEndpoint: string,
    private readonly scopes?: string
  ) {}

  async authenticate(): Promise<AuthResult> {
    await this.fetchToken();
    return { authenticated: true, type: "oauth2" };
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (this.isExpired()) {
      await this.refresh();
    }
    return {
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  async getQueryParams(): Promise<Record<string, string>> {
    return {};
  }

  isExpired(): boolean {
    return Date.now() >= this.expiresAt - 60_000;
  }

  async refresh(): Promise<void> {
    await this.fetchToken();
  }

  getType(): "oauth2" {
    return "oauth2";
  }

  private async fetchToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (this.scopes) {
      body.set("scope", this.scopes);
    }

    const res = await fetch(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      throw new Error(`OAuth2 token request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
  }
}
