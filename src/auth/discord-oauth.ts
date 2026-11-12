import { z } from "zod";

const TOKEN_ENDPOINT = "https://discord.com/api/oauth2/token";
const CURRENT_USER_ENDPOINT = "https://discord.com/api/users/@me";

export class DiscordOAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DiscordOAuthError";
    this.code = code;
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  token_type: z.string().optional()
});

const profileSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(2).max(32)
});

function unavailableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Exchange a short-lived OAuth authorization code and read the Discord user
 * identity. The access token is intentionally returned nowhere and is never
 * persisted by this helper.
 */
export async function exchangeDiscordAuthorizationCode(
  code: string,
  options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    fetchImpl?: typeof fetch;
  }
): Promise<{ discordId: string; username: string }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectUri
      }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new DiscordOAuthError("DISCORD_UNAVAILABLE", "Discord could not complete the authorization request.");
  }

  if (!tokenResponse.ok) {
    throw new DiscordOAuthError(
      unavailableStatus(tokenResponse.status) ? "DISCORD_UNAVAILABLE" : "DISCORD_ASSERTION_REJECTED",
      unavailableStatus(tokenResponse.status)
        ? "Discord authorization is temporarily unavailable."
        : "Discord rejected the authorization code."
    );
  }

  let tokenBody: unknown;
  try {
    tokenBody = await tokenResponse.json();
  } catch {
    throw new DiscordOAuthError("DISCORD_UNAVAILABLE", "Discord returned an unreadable authorization response.");
  }

  const token = tokenSchema.safeParse(tokenBody);
  if (!token.success || (token.data.token_type && token.data.token_type.toLowerCase() !== "bearer")) {
    throw new DiscordOAuthError("DISCORD_ASSERTION_REJECTED", "Discord returned an invalid authorization token.");
  }

  let profileResponse: Response;
  try {
    profileResponse = await fetchImpl(CURRENT_USER_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.data.access_token}`,
        Accept: "application/json"
      },
      redirect: "error",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new DiscordOAuthError("DISCORD_UNAVAILABLE", "Discord profile verification is temporarily unavailable.");
  }

  if (!profileResponse.ok) {
    throw new DiscordOAuthError(
      unavailableStatus(profileResponse.status) ? "DISCORD_UNAVAILABLE" : "DISCORD_ASSERTION_REJECTED",
      unavailableStatus(profileResponse.status)
        ? "Discord profile verification is temporarily unavailable."
        : "Discord rejected the profile request."
    );
  }

  let profileBody: unknown;
  try {
    profileBody = await profileResponse.json();
  } catch {
    throw new DiscordOAuthError("DISCORD_UNAVAILABLE", "Discord returned an unreadable profile response.");
  }

  const profile = profileSchema.safeParse(profileBody);
  if (!profile.success) {
    throw new DiscordOAuthError("INVALID_DISCORD_PROFILE", "Discord returned an invalid account identity.");
  }

  return { discordId: profile.data.id, username: profile.data.username };
}
