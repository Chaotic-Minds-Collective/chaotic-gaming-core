import test from "node:test";
import assert from "node:assert/strict";
import { verifySteamOpenIdAssertion, SteamOpenIdError } from "../dist/auth/steam-openid.js";

const endpoint = "https://steamcommunity.com/openid/login";
const expectedReturnUrl = "https://www.chaoticmindsgaming.com/api/account/link/steam/callback";

function makeAssertion(overrides = {}) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const claimedId = "https://steamcommunity.com/openid/id/76561198000000000";
  return {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": endpoint,
    "openid.claimed_id": claimedId,
    "openid.identity": claimedId,
    "openid.return_to": expectedReturnUrl + "?state=" + "s".repeat(43),
    "openid.response_nonce": timestamp + "synthetic-nonce",
    "openid.assoc_handle": "synthetic-association",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "synthetic-signature",
    ...overrides,
  };
}

test("verifies a signed Steam OpenID assertion and extracts SteamID64", async () => {
  let captured;
  const result = await verifySteamOpenIdAssertion(makeAssertion(), expectedReturnUrl, async (url, init) => {
    captured = { url: String(url), init };
    return new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n", { status: 200 });
  });
  assert.equal(result.steamId, "76561198000000000");
  assert.equal(captured.url, endpoint);
  assert.equal(captured.init.method, "POST");
  assert.equal(new URLSearchParams(captured.init.body).get("openid.mode"), "check_authentication");
});

test("rejects a callback URL outside the configured website callback", async () => {
  await assert.rejects(
    verifySteamOpenIdAssertion(makeAssertion({ "openid.return_to": "https://attacker.example/callback?state=" + "s".repeat(43) }), expectedReturnUrl),
    (error) => error instanceof SteamOpenIdError && error.code === "INVALID_RETURN_URL"
  );
});

test("rejects an expired Steam response nonce", async () => {
  const expired = new Date(Date.now() - 20 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await assert.rejects(
    verifySteamOpenIdAssertion(makeAssertion({ "openid.response_nonce": expired + "old-nonce" }), expectedReturnUrl),
    (error) => error instanceof SteamOpenIdError && error.code === "EXPIRED_NONCE"
  );
});

test("rejects assertions that do not sign the callback and identity fields", async () => {
  await assert.rejects(
    verifySteamOpenIdAssertion(makeAssertion({ "openid.signed": "op_endpoint,assoc_handle" }), expectedReturnUrl),
    (error) => error instanceof SteamOpenIdError && error.code === "INVALID_ASSERTION"
  );
});

test("rejects a Steam assertion that fails remote signature verification", async () => {
  await assert.rejects(
    verifySteamOpenIdAssertion(makeAssertion(), expectedReturnUrl, async () => new Response("is_valid:false\n", { status: 200 })),
    (error) => error instanceof SteamOpenIdError && error.code === "ASSERTION_REJECTED"
  );
});

test("accepts Steam's documented alternate endpoint and HTTP claimed-ID scheme", async () => {
  const claimedId = "http://steamcommunity.com/openid/id/76561198000000000";
  let usedEndpoint;
  const result = await verifySteamOpenIdAssertion(makeAssertion({
    "openid.op_endpoint": "https://steamcommunity.com/openid/",
    "openid.claimed_id": claimedId,
    "openid.identity": claimedId,
    "openid.response_nonce": new Date().toISOString() + "fractional-nonce",
  }), expectedReturnUrl, async (url) => {
    usedEndpoint = String(url);
    return new Response("is_valid:true\\n", { status: 200 });
  });
  assert.equal(result.steamId, "76561198000000000");
  assert.equal(usedEndpoint, "https://steamcommunity.com/openid/");
});
