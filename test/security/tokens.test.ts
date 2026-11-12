import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServiceToken, hashServiceToken, isServiceTokenFormat } from "../../src/security/tokens.js";

describe("service credentials", () => {
  it("creates random tokens in the expected format", () => {
    const first = createServiceToken();
    const second = createServiceToken();
    assert.ok(isServiceTokenFormat(first));
    assert.ok(isServiceTokenFormat(second));
    assert.notEqual(first, second);
  });
  it("hashes credentials deterministically without storing the raw token", () => {
    const token = createServiceToken();
    assert.equal(hashServiceToken(token), hashServiceToken(token));
    assert.notEqual(hashServiceToken(token), token);
    assert.equal(hashServiceToken(token).length, 64);
  });
  it("rejects malformed tokens", () => {
    assert.equal(isServiceTokenFormat(""), false);
    assert.equal(isServiceTokenFormat("not-a-service-token"), false);
    assert.equal(isServiceTokenFormat("cgk_svc_short"), false);
  });
});
