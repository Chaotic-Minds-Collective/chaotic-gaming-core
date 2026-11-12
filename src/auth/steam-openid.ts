const STEAM_OPENID_ENDPOINTS = new Set([
  "https://steamcommunity.com/openid/login",
  "https://steamcommunity.com/openid/",
]);
const OPENID_NAMESPACE = "http://specs.openid.net/auth/2.0";
const MAX_NONCE_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export class SteamOpenIdError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SteamOpenIdError";
    this.code = code;
  }
}

function requiredString(assertion: Record<string, string>, key: string): string {
  const value = assertion[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SteamOpenIdError("INVALID_ASSERTION", "Steam did not return a complete OpenID assertion.");
  }
  return value;
}

export async function verifySteamOpenIdAssertion(
  assertion: Record<string, string>,
  expectedReturnUrl: string,
  expectedState: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<{ steamId: string; nonce: string }> {
  const namespace = requiredString(assertion, "openid.ns");
  const mode = requiredString(assertion, "openid.mode");
  const endpoint = requiredString(assertion, "openid.op_endpoint");
  const claimedId = requiredString(assertion, "openid.claimed_id");
  const identity = requiredString(assertion, "openid.identity");
  const returnToValue = requiredString(assertion, "openid.return_to");
  const nonce = requiredString(assertion, "openid.response_nonce");
  const associationHandle = requiredString(assertion, "openid.assoc_handle");
  const signedFields = requiredString(assertion, "openid.signed");
  requiredString(assertion, "openid.sig");

  if (namespace !== OPENID_NAMESPACE || mode !== "id_res") {
    throw new SteamOpenIdError("INVALID_ASSERTION", "The Steam OpenID namespace or response mode is invalid.");
  }
  if (!STEAM_OPENID_ENDPOINTS.has(endpoint)) {
    throw new SteamOpenIdError("INVALID_ASSERTION", "The OpenID provider endpoint is invalid.");
  }
  if (identity !== claimedId) {
    throw new SteamOpenIdError("INVALID_ASSERTION", "Steam identity and claimed identity do not match.");
  }

  const steamMatch = claimedId.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  const steamId = steamMatch?.[1];
  if (!steamId) {
    throw new SteamOpenIdError("INVALID_STEAM_ID", "Steam returned an invalid SteamID64.");
  }

  let expected: URL;
  let returnTo: URL;
  try {
    expected = new URL(expectedReturnUrl);
    returnTo = new URL(returnToValue);
  } catch {
    throw new SteamOpenIdError("INVALID_RETURN_URL", "The configured Steam callback URL is invalid.");
  }
  if (
    expected.protocol !== "https:"
    || returnTo.protocol !== "https:"
    || returnTo.origin !== expected.origin
    || returnTo.pathname !== expected.pathname
    || returnTo.searchParams.size !== 1
    || returnTo.searchParams.get("state") !== expectedState
    || expectedState.length !== 43
  ) {
    throw new SteamOpenIdError("INVALID_RETURN_URL", "The Steam assertion was issued for an unexpected callback URL or state.");
  }

  const signed = new Set(signedFields.split(","));
  for (const field of ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"]) {
    if (!signed.has(field)) {
      throw new SteamOpenIdError("INVALID_ASSERTION", "The Steam assertion omits a required signed field.");
    }
  }
  if (!associationHandle) {
    throw new SteamOpenIdError("INVALID_ASSERTION", "The Steam association handle is missing.");
  }

  const nonceTimestampMatch = nonce.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  const nonceTimestampValue = nonceTimestampMatch?.[1];
  const nonceTimestamp = nonceTimestampValue ? Date.parse(nonceTimestampValue) : Number.NaN;
  if (nonce.length > 255 || !Number.isFinite(nonceTimestamp)) {
    throw new SteamOpenIdError("INVALID_NONCE", "The Steam response nonce timestamp is invalid.");
  }
  const nonceAge = Date.now() - nonceTimestamp;
  if (nonceAge > MAX_NONCE_AGE_MS || nonceAge < -MAX_FUTURE_SKEW_MS) {
    throw new SteamOpenIdError("EXPIRED_NONCE", "The Steam response nonce is expired or from the future.");
  }

  const verification = new URLSearchParams();
  for (const [key, value] of Object.entries(assertion)) {
    if (key.startsWith("openid.") && typeof value === "string") verification.set(key, value);
  }
  verification.set("openid.mode", "check_authentication");

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
      body: verification.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new SteamOpenIdError("STEAM_UNAVAILABLE", "Steam could not verify the OpenID assertion.");
  }
  if (!response.ok) {
    throw new SteamOpenIdError("STEAM_UNAVAILABLE", "Steam could not verify the OpenID assertion.");
  }
  const body = await response.text();
  if (!/^is_valid:true\s*$/m.test(body)) {
    throw new SteamOpenIdError("ASSERTION_REJECTED", "Steam rejected the OpenID assertion.");
  }

  return { steamId, nonce };
}
