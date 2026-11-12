import test from "node:test";
import assert from "node:assert/strict";
import { exchangeDiscordAuthorizationCode, DiscordOAuthError } from "../dist/auth/discord-oauth.js";

const options = {
  clientId: "discord-client-id",
  clientSecret: "discord-client-secret",
  redirectUri: "https://core.example.test/auth/discord-link/callback"
};

test("Discord OAuth exchanges the code and returns only the verified user identity", async () => {
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url: String(url), request });
    if (String(url).endsWith("/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "short-lived-access-token", token_type: "Bearer" }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: "123456789012345678", username: "chaotic_player" }) };
  };

  const identity = await exchangeDiscordAuthorizationCode("one-time-code", { ...options, fetchImpl });
  assert.deepEqual(identity, { discordId: "123456789012345678", username: "chaotic_player" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.method, "POST");
  const body = new URLSearchParams(calls[0].request.body);
  assert.equal(body.get("client_id"), options.clientId);
  assert.equal(body.get("client_secret"), options.clientSecret);
  assert.equal(body.get("redirect_uri"), options.redirectUri);
  assert.equal(calls[1].request.headers.Authorization, "Bearer short-lived-access-token");
});

test("Discord token exchange rejects an invalid authorization code", async () => {
  await assert.rejects(
    exchangeDiscordAuthorizationCode("bad-code", {
      ...options,
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) })
    }),
    (error) => error instanceof DiscordOAuthError && error.code === "DISCORD_ASSERTION_REJECTED"
  );
});

test("Discord profile validation rejects malformed identities", async () => {
  await assert.rejects(
    exchangeDiscordAuthorizationCode("one-time-code", {
      ...options,
      fetchImpl: async (url) => String(url).endsWith("/token")
        ? { ok: true, status: 200, json: async () => ({ access_token: "token", token_type: "Bearer" }) }
        : { ok: true, status: 200, json: async () => ({ id: "not-a-snowflake", username: "x" }) }
    }),
    (error) => error instanceof DiscordOAuthError && error.code === "INVALID_DISCORD_PROFILE"
  );
});

test("Discord rate limiting is treated as temporary unavailability", async () => {
  await assert.rejects(
    exchangeDiscordAuthorizationCode("one-time-code", {
      ...options,
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
    }),
    (error) => error instanceof DiscordOAuthError && error.code === "DISCORD_UNAVAILABLE"
  );
});
