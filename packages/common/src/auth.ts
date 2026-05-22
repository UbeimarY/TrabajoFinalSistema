import { Agent, fetch } from "undici";

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export type AuthClientConfig = {
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  ca?: string;
};

type CacheEntry = {
  accessToken: string;
  expiresAtMs: number;
};

export class AuthClient {
  private cache?: CacheEntry;
  private readonly cfg: AuthClientConfig;

  constructor(cfg: AuthClientConfig) {
    this.cfg = cfg;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAtMs - 10_000) {
      return this.cache.accessToken;
    }

    const res = await fetch(`${this.cfg.authBaseUrl.replace(/\/$/, "")}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret
      }),
      dispatcher: this.cfg.ca ? new Agent({ connect: { ca: this.cfg.ca } }) : undefined
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`auth token request failed: ${res.status} ${body}`);
    }

    const json = (await res.json()) as TokenResponse;
    const expiresAtMs = Date.now() + json.expires_in * 1000;
    this.cache = { accessToken: json.access_token, expiresAtMs };
    return json.access_token;
  }
}

