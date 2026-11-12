import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyStripeSignature } from "../dist/payments/stripe.js";

describe("Stripe webhook signature verification", () => {
  const secret = "whsec_test_secret";
  const timestamp = 1_800_000_000;
  const body = Buffer.from('{"id":"evt_test","type":"checkout.session.completed"}', "utf8");
  const signature = createHmac("sha256", secret)
    .update(String(timestamp) + ".")
    .update(body)
    .digest("hex");

  it("accepts a valid v1 signature within the timestamp tolerance", () => {
    assert.equal(
      verifyStripeSignature(body, "t=" + timestamp + ",v1=" + signature, secret, timestamp),
      true
    );
  });

  it("accepts one valid signature among multiple v1 signatures", () => {
    assert.equal(
      verifyStripeSignature(body, "t=" + timestamp + ",v1=" + "0".repeat(64) + ",v1=" + signature, secret, timestamp),
      true
    );
  });

  it("rejects a modified body", () => {
    assert.equal(
      verifyStripeSignature(Buffer.from(body.toString("utf8") + "x"), "t=" + timestamp + ",v1=" + signature, secret, timestamp),
      false
    );
  });

  it("rejects stale timestamps and malformed headers", () => {
    assert.equal(verifyStripeSignature(body, "t=" + timestamp + ",v1=" + signature, secret, timestamp + 600), false);
    assert.equal(verifyStripeSignature(body, "v1=" + signature, secret, timestamp), false);
    assert.equal(verifyStripeSignature(body, "t=" + timestamp + ",v1=bad", secret, timestamp), false);
  });
});
