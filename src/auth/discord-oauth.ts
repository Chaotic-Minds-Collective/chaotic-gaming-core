import { Buffer } from "node:buffer";
import { z } from "zod";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const tokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  token_type: z.string().min(1),
  scope: z.string().min(1),
});
const userSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(32),
  global_name: z.string().min(1).max(32).nullable().optional(),
});

export class DiscordOAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DiscordOAuthError";
    this.code = code;
  }
}

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface DiscordLinkedIdentity {
  externalId: string;
  externalUsername: string;
}

export function createDiscordAuthorizationUrl(
  config: DiscordOAuthConfig,
  state: string,
): string {
  if (!STATE_PATTERN.test(state)) {
    throw new DiscordOAuthError("INVALID_STATE", "A valid Discord OAuth state is required.");
  }
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function basicAuthorization(config: DiscordOAuthConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

async function revokeAccessToken(
  config: DiscordOAuthConfig,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    const body = new URLSearchParams({
      token: accessToken,
      token_type_hint: "access_token",
    });
    await fetchImpl("https://discord.com/api/oauth2/token/revoke", {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(config),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The access token is never persisted. Revocation is best-effort; Discord expires it.
  }
}

export async function exchangeDiscordAuthorizationCode(
  config: DiscordOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordLinkedIdentity> {
  if (typeof code !== "string" || code.length < 1 || code.length > 2048) {
    throw new DiscordOAuthError("INVALID_CODE", "A valid Discord authorization code is required.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  let accessToken: string | undefined;
  try {
    const tokenResponse = await fetchImpl("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(config),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!tokenResponse.ok) {
      throw new DiscordOAuthError(
        "DISCORD_TOKEN_EXCHANGE_FAILED",
        "Discord did not accept the authorization code.",
      );
    }

    const tokenPayload: unknown = await tokenResponse.json();
    if (typeof tokenPayload === "object" && tokenPayload !== null
      && "access_token" in tokenPayload && typeof tokenPayload.access_token === "string") {
      accessToken = tokenPayload.access_token;
    }
    const tokenResult = tokenSchema.safeParse(tokenPayload);
    if (!tokenResult.success || tokenResult.data.token_type.toLowerCase() !== "bearer"
      || !tokenResult.data.scope.split(/\s+/).includes("identify")) {
      throw new DiscordOAuthError(
        "DISCORD_TOKEN_RESPONSE_INVALID",
        "Discord returned an invalid authorization response.",
      );
    }
    accessToken = tokenResult.data.access_token;

    const userResponse = await fetchImpl("https://discord.com/api/v10/users/@me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!userResponse.ok) {
      throw new DiscordOAuthError(
        "DISCORD_USER_LOOKUP_FAILED",
        "Discord could not verify the authorized account.",
      );
    }

    const userResult = userSchema.safeParse(await userResponse.json());
    if (!userResult.success) {
      throw new DiscordOAuthError(
        "DISCORD_USER_RESPONSE_INVALID",
        "Discord returned an invalid user identity.",
      );
    }

    return {
      externalId: userResult.data.id,
      externalUsername: userResult.data.global_name || userResult.data.username,
    };
  } catch (error) {
    if (error instanceof DiscordOAuthError) throw error;
    throw new DiscordOAuthError(
      "DISCORD_UNAVAILABLE",
      "Discord account verification is temporarily unavailable.",
    );
  } finally {
    if (accessToken) await revokeAccessToken(config, accessToken, fetchImpl);
  }
}
