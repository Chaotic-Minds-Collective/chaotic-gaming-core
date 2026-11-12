import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export interface StripeCheckoutLine {
  name: string;
  quantity: number;
  unitAmountMinor: string;
}

export interface StripeCheckoutInput {
  orderId: string;
  principalId: string;
  currency: string;
  idempotencyKey: string;
  lines: StripeCheckoutLine[];
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  expiresAt: Date;
}

function isSafeReturnUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const localHttp = config.NODE_ENV !== "production"
      && url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname);
    return url.protocol === "https:" || localHttp;
  } catch {
    return false;
  }
}

export function stripeCheckoutEnabled(): boolean {
  return config.PAYMENTS_ENABLED
    && config.STRIPE_SECRET_KEY.startsWith("sk_test_")
    && config.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")
    && isSafeReturnUrl(config.STRIPE_SUCCESS_URL)
    && isSafeReturnUrl(config.STRIPE_CANCEL_URL);
}

export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader || !secret.startsWith("whsec_")) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = Number(timestampPart?.slice(2));
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(String(timestamp) + ".")
    .update(rawBody)
    .digest();

  return parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .some((signature) => {
      if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
      const provided = Buffer.from(signature, "hex");
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    });
}

export async function createStripeCheckoutSession(
  input: StripeCheckoutInput
): Promise<StripeCheckoutSession> {
  if (!stripeCheckoutEnabled() || !config.STRIPE_SUCCESS_URL || !config.STRIPE_CANCEL_URL) {
    throw new Error("Test-mode checkout is not configured.");
  }
  if (!input.lines.length || input.lines.some((line) => BigInt(line.unitAmountMinor) <= 0n)) {
    throw new Error("Checkout requires at least one priced item.");
  }

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", config.STRIPE_SUCCESS_URL);
  params.set("cancel_url", config.STRIPE_CANCEL_URL);
  params.set("client_reference_id", input.orderId);
  params.set("metadata[order_id]", input.orderId);
  params.set("metadata[principal_id]", input.principalId);
  params.set("expires_at", String(Math.floor(Date.now() / 1000) + 3600));

  input.lines.forEach((line, index) => {
    const prefix = "line_items[" + index + "]";
    params.set(prefix + "[price_data][currency]", input.currency.toLowerCase());
    params.set(prefix + "[price_data][unit_amount]", line.unitAmountMinor);
    params.set(prefix + "[price_data][product_data][name]", line.name);
    params.set(prefix + "[quantity]", String(line.quantity));
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey
    },
    body: params.toString(),
    signal: AbortSignal.timeout(10_000)
  });

  const payload = await response.json() as {
    id?: unknown;
    url?: unknown;
    expires_at?: unknown;
  };
  if (!response.ok || typeof payload.id !== "string" || typeof payload.url !== "string"
    || typeof payload.expires_at !== "number") {
    throw new Error("Stripe Checkout session could not be created.");
  }

  const checkoutUrl = new URL(payload.url);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
    throw new Error("Stripe returned an unexpected checkout URL.");
  }

  return {
    id: payload.id,
    url: checkoutUrl.toString(),
    expiresAt: new Date(payload.expires_at * 1000)
  };
}
