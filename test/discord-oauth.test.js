import test from "node:test";
import assert from "node:assert/strict";
import {
  createDiscordAuthorizationUrl,
  DiscordOAuthError,
  exchangeDiscordAuthorizationCode,
} from "../dist/auth/discord-oauth.js";

const config = {
  clientId: "1568425859726180414",
  clientSecret: "synthetic-discord-client-secret",
  redirectUri: "https://www.chaoticmindsgaming.com/account/link/discord/callback",
};
const state = "A".repeat(43);

test("Discord authorization URL requests only identify and binds the state", () => {
  const url = new URL(createDiscordAuthorizationUrl(config, state));
  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "identify");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("state"), state);
  assert.throws(() => createDiscordAuthorizationUrl(config, "weak-state"), DiscordOAuthError);
});

test("Discord code exchange verifies the account and revokes the temporary token", async () => {
  const calls = [];
  const identity = await exchangeDiscordAuthorizationCode(config, "synthetic-code", async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/oauth2/token")) {
      return Response.json({
        access_token: "synthetic-access-token",
        token_type: "Bearer",
        expires_in: 604800,
        refresh_token: "synthetic-refresh-token",
        scope: "identify",
      });
    }
    if (String(url).endsWith("/users/@me")) {
      return Response.json({
        id: "123456789012345678",
        username: "chaotic_player",
        global_name: "Chaotic Player",
      });
    }
    if (String(url).endsWith("/oauth2/token/revoke")) {
      return new Response(null, { status: 200 });
    }
    throw new Error("Unexpected Discord endpoint");
  });

  assert.deepEqual(identity, {
    externalId: "123456789012345678",
    externalUsername: "Chaotic Player",
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers.Authorization.startsWith("Basic "), true);
  assert.equal(calls[0].options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[1].options.headers.Authorization, "Bearer synthetic-access-token");
  assert.equal(calls[2].options.headers.Authorization.startsWith("Basic "), true);
  assert.equal(String(calls[2].options.body).includes("synthetic-access-token"), true);
});

test("Discord code exchange rejects tokens without identify scope", async () => {
  await assert.rejects(
    exchangeDiscordAuthorizationCode(config, "synthetic-code", async () => Response.json({
      access_token: "synthetic-access-token",
      token_type: "Bearer",
      scope: "guilds",
    })),
    (error) => error instanceof DiscordOAuthError && error.code === "DISCORD_TOKEN_RESPONSE_INVALID",
  );
});

test("Discord code exchange rejects invalid Discord user IDs", async () => {
  await assert.rejects(
    exchangeDiscordAuthorizationCode(config, "synthetic-code", async (url) => {
      if (String(url).endsWith("/oauth2/token")) {
        return Response.json({ access_token: "synthetic-access-token", token_type: "Bearer", scope: "identify" });
      }
      if (String(url).endsWith("/users/@me")) {
        return Response.json({ id: "not-a-snowflake", username: "player" });
      }
      return new Response(null, { status: 200 });
    }),
    (error) => error instanceof DiscordOAuthError && error.code === "DISCORD_USER_RESPONSE_INVALID",
  );
});

test("Discord errors never include access tokens or client secrets", async () => {
  await assert.rejects(
    exchangeDiscordAuthorizationCode(config, "synthetic-code", async () => new Response("invalid", { status: 401 })),
    (error) => error instanceof DiscordOAuthError
      && !error.message.includes(config.clientSecret)
      && !error.message.includes("synthetic-access-token"),
  );
});
