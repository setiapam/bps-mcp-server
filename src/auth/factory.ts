import type { Config } from "../config/index.js";
import type { IAuthProvider } from "./types.js";
import { ApiKeyProvider } from "./api-key.provider.js";
import { OAuth2Provider } from "./oauth2.provider.js";

export function createAuthProvider(config: Config): IAuthProvider {
  switch (config.authType) {
    case "api-key":
      return new ApiKeyProvider(config.apiKey!);
    case "oauth2":
      return new OAuth2Provider(
        config.oauthClientId!,
        config.oauthClientSecret!,
        config.oauthTokenEndpoint!,
        config.oauthScopes
      );
    default:
      throw new Error(`Unknown auth type: ${config.authType}`);
  }
}
