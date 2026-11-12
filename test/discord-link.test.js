import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Synthetic OAuth settings; all provider requests are intercepted below.
process.env.DISCORD_OAUTH_CLIENT_ID = "test-client";
process.env.DISCORD_OAUTH_CLIENT_SECRET = "test-secret";
process.env.DISCORD_OAUTH_REDIRECT_URL = "https://core.example.test/auth/discord-link/callback";
process.env.LOG_LEVEL = "silent";
const { buildApp } = await import("../dist/app.js");
const { pool } = await import("../dist/db.js");
const { issueSession } = await import("../dist/auth/session.js");

test("Discord callback requires the initiating browser and consumes state once", {
  skip: !pool ? "DATABASE_URL is not configured" : false,
}, async () => {
  const app = buildApp();
  const principal = randomUUID();
  const originalFetch = globalThis.fetch;
  let exchanges = 0;
  globalThis.fetch = async (url) => {
    exchanges++;
    return Response.json(url.endsWith("/token")
      ? { access_token: "synthetic-token", token_type: "Bearer" }
      : { id: "123456789012345678", username: "synthetic-user" });
  };
  try {
    await pool.query("INSERT INTO core.principals (id, principal_type, status) VALUES ($1, 'user', 'active')", [principal]);
    await pool.query("INSERT INTO core.users (principal_id, username) VALUES ($1, $2)", [principal, "discord_" + principal.slice(0, 12)]);
    const session = await issueSession(principal, { headers: {}, ip: "127.0.0.1" });
    const challenge = async () => {
      const response = await app.inject({ method: "POST", url: "/auth/discord-link/challenge", headers: { authorization: `Bearer ${session.token}` } });
      assert.equal(response.statusCode, 201, response.body);
      const cookie = response.headers["set-cookie"];
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert.match(cookie, /Max-Age=600/);
      if (process.env.NODE_ENV === "production") {
        assert.match(cookie, /^__Host-discord-link=/);
        assert.match(cookie, /; Secure/);
      }
      const state = new URL(response.json().data.authorizationUrl).searchParams.get("state");
      assert.ok(!response.body.includes(cookie.split(";")[0].split("=")[1]));
      return { cookie: cookie.split(";")[0], url: `/auth/discord-link/callback?code=synthetic&state=${state}` };
    };
    const owner = await challenge();
    const otherBrowser = await challenge();
    for (const cookie of [undefined, otherBrowser.cookie, "discord-link=malformed", `${owner.cookie}; ${owner.cookie}`]) {
      const denied = await app.inject({ url: owner.url, headers: cookie ? { cookie } : {} });
      assert.equal(denied.statusCode, 409, denied.body);
    }
    assert.equal(exchanges, 0);
    assert.equal((await pool.query("SELECT 1 FROM core.linked_accounts WHERE principal_id = $1", [principal])).rowCount, 0);
    const linked = await app.inject({ url: owner.url, headers: { cookie: owner.cookie } });
    assert.equal(linked.statusCode, 201, linked.body);
    assert.match(linked.headers["set-cookie"], /Max-Age=0/);
    assert.equal(exchanges, 2);
    const replay = await app.inject({ url: owner.url, headers: { cookie: owner.cookie } });
    assert.equal(replay.statusCode, 409);
    assert.equal(exchanges, 2);
    await pool.query("UPDATE core.identity_link_challenges SET expires_at = NOW() - INTERVAL '1 minute' WHERE principal_id = $1", [principal]);
    const expired = await app.inject({ url: otherBrowser.url, headers: { cookie: otherBrowser.cookie } });
    assert.equal(expired.statusCode, 409);
    assert.equal(exchanges, 2);
    assert.equal((await pool.query("SELECT 1 FROM core.linked_accounts WHERE principal_id = $1 AND provider = 'discord'", [principal])).rowCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await pool.query("DELETE FROM operations.audit_logs WHERE actor_principal_id = $1", [principal]);
    await pool.query("DELETE FROM core.linked_accounts WHERE principal_id = $1", [principal]);
    await pool.query("DELETE FROM core.identity_link_challenges WHERE principal_id = $1", [principal]);
    await pool.query("DELETE FROM core.auth_sessions WHERE principal_id = $1", [principal]);
    await pool.query("DELETE FROM core.users WHERE principal_id = $1", [principal]);
    await pool.query("DELETE FROM core.principals WHERE id = $1", [principal]);
    await app.close();
    await pool.end();
  }
});
