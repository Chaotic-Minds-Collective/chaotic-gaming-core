import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "../auth/session.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import {
  createStripeCheckoutSession,
  stripeCheckoutEnabled,
  verifyStripeSignature
} from "../payments/stripe.js";

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

const orderParamsSchema = z.object({ orderId: z.string().uuid() });
const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(160),
  data: z.object({ object: z.record(z.string(), z.unknown()) })
});

export async function registerPaymentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/commerce/checkout/status", async () => ({
    data: { enabled: stripeCheckoutEnabled(), provider: "stripe", mode: "test" }
  }));

  app.post("/commerce/orders/:orderId/checkout", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Checkout is temporarily unavailable." } });
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const params = orderParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "INVALID_ORDER_ID", message: "A valid order ID is required." } });
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header between 8 and 128 characters." } });
    }
    if (!stripeCheckoutEnabled()) {
      return reply.code(503).send({ error: { code: "CHECKOUT_DISABLED", message: "Test-mode checkout is not configured." } });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query<{
        id: string; principal_id: string; status: string; currency: string; total_minor: string;
      }>(
        "SELECT id, principal_id, status, currency, total_minor::text AS total_minor FROM commerce.orders WHERE id = $1 AND principal_id = $2 FOR UPDATE",
        [params.data.orderId, principalId]
      );
      const order = orderResult.rows[0];
      if (!order) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "ORDER_NOT_FOUND", message: "The order was not found." } });
      }
      if (order.status === "paid") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "ORDER_ALREADY_PAID", message: "This order has already been paid." } });
      }
      if (!["pending", "awaiting_payment"].includes(order.status)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "ORDER_NOT_PAYABLE", message: "This order cannot be checked out." } });
      }

      const existing = await client.query<{ provider_transaction_id: string; checkout_url: string; expires_at: Date | null }>(
        "SELECT provider_transaction_id, checkout_url, expires_at FROM commerce.payment_transactions WHERE order_id = $1 AND provider = 'stripe' AND status IN ('created', 'pending') AND checkout_url IS NOT NULL AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 1",
        [order.id]
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return {
          data: {
            checkoutUrl: existing.rows[0].checkout_url,
            sessionId: existing.rows[0].provider_transaction_id,
            expiresAt: existing.rows[0].expires_at
          },
          requestId: request.id
        };
      }

      const itemResult = await client.query<{
        name_snapshot: string; quantity: number; unit_amount_minor: string;
      }>(
        "SELECT name_snapshot, quantity, unit_amount_minor::text AS unit_amount_minor FROM commerce.order_items WHERE order_id = $1 ORDER BY id",
        [order.id]
      );
      if (!itemResult.rows.length || BigInt(order.total_minor) <= 0n) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: { code: "ORDER_HAS_NO_PAYABLE_ITEMS", message: "The order has no payable items." } });
      }

      const session = await createStripeCheckoutSession({
        orderId: order.id,
        principalId,
        currency: order.currency.trim(),
        idempotencyKey,
        lines: itemResult.rows.map((item) => ({
          name: item.name_snapshot,
          quantity: item.quantity,
          unitAmountMinor: item.unit_amount_minor
        }))
      });

      await client.query(
        "INSERT INTO commerce.payment_transactions (order_id, provider, provider_transaction_id, status, amount_minor, currency, checkout_url, expires_at) VALUES ($1, 'stripe', $2, 'pending', $3, $4, $5, $6) ON CONFLICT (provider, provider_transaction_id) DO UPDATE SET status = 'pending', checkout_url = EXCLUDED.checkout_url, expires_at = EXCLUDED.expires_at",
        [order.id, session.id, order.total_minor, order.currency, session.url, session.expiresAt]
      );
      await client.query(
        "UPDATE commerce.orders SET status = 'awaiting_payment', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'awaiting_payment')",
        [order.id]
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        data: { checkoutUrl: session.url, sessionId: session.id, expiresAt: session.expiresAt },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Stripe checkout session creation failed");
      return reply.code(502).send({ error: { code: "CHECKOUT_PROVIDER_UNAVAILABLE", message: "The test checkout session could not be created. No payment was taken." } });
    } finally {
      client.release();
    }
  });

  app.post("/webhooks/stripe", {
    preParsing: async (request, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);
      (request as RawBodyRequest).rawBody = rawBody;
      return Readable.from([rawBody]);
    }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Payment webhook processing is unavailable." } });
    if (!config.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
      return reply.code(503).send({ error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Stripe webhook verification is not configured." } });
    }
    const rawBody = (request as RawBodyRequest).rawBody;
    if (!rawBody || !verifyStripeSignature(rawBody, request.headers["stripe-signature"], config.STRIPE_WEBHOOK_SECRET)) {
      return reply.code(400).send({ error: { code: "INVALID_WEBHOOK_SIGNATURE", message: "The Stripe signature is invalid or expired." } });
    }

    const parsed = stripeEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_WEBHOOK_EVENT", message: "The Stripe event payload is invalid." } });
    const event = parsed.data;
    const supportedSuccess = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
    const supportedFailure = event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed";
    if (!supportedSuccess && !supportedFailure) return { received: true, ignored: true };

    const session = event.data.object;
    const sessionId = typeof session.id === "string" ? session.id : null;
    if (!sessionId) return reply.code(400).send({ error: { code: "INVALID_CHECKOUT_SESSION", message: "The Stripe checkout session ID is missing." } });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const duplicate = await client.query(
        "SELECT 1 FROM commerce.payment_webhook_events WHERE provider = 'stripe' AND event_id = $1",
        [event.id]
      );
      if (duplicate.rowCount) {
        await client.query("COMMIT");
        return { received: true, duplicate: true };
      }

      const transactionResult = await client.query<{
        id: string; order_id: string; status: string; amount_minor: string; currency: string; principal_id: string;
      }>(
        "SELECT pt.id, pt.order_id, pt.status, pt.amount_minor::text AS amount_minor, pt.currency, o.principal_id FROM commerce.payment_transactions pt JOIN commerce.orders o ON o.id = pt.order_id WHERE pt.provider = 'stripe' AND pt.provider_transaction_id = $1 FOR UPDATE OF pt, o",
        [sessionId]
      );
      const payment = transactionResult.rows[0];
      if (!payment) {
        await client.query("ROLLBACK");
        return reply.code(500).send({ error: { code: "PAYMENT_TRANSACTION_NOT_FOUND", message: "The checkout session is not registered yet. Stripe may retry this event." } });
      }

      if (supportedSuccess && session.payment_status === "paid") {
        const amountTotal = typeof session.amount_total === "number" ? session.amount_total : Number.NaN;
        const currency = typeof session.currency === "string" ? session.currency.toUpperCase() : "";
        if (!Number.isSafeInteger(amountTotal) || BigInt(amountTotal) !== BigInt(payment.amount_minor) || currency !== payment.currency.trim().toUpperCase()) {
          await client.query(
            "UPDATE commerce.payment_transactions SET status = 'failed', provider_event_id = $1 WHERE id = $2 AND status <> 'succeeded'",
            [event.id, payment.id]
          );
          await client.query(
            "UPDATE commerce.orders SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status <> 'paid'",
            [payment.order_id]
          );
          await client.query(
            "INSERT INTO operations.audit_logs (action, resource_type, resource_id, outcome, metadata) VALUES ('payment.stripe.amount_mismatch', 'order', $1, 'failure', $2::jsonb)",
            [payment.order_id, JSON.stringify({ eventId: event.id, paymentTransactionId: payment.id })]
          );
        } else {
          await client.query(
            "UPDATE commerce.payment_transactions SET status = 'succeeded', provider_event_id = $1, verified_at = NOW() WHERE id = $2",
            [event.id, payment.id]
          );
          await client.query(
            "UPDATE commerce.orders SET status = 'paid', updated_at = NOW() WHERE id = $1 AND status <> 'paid'",
            [payment.order_id]
          );
          await client.query(
            "INSERT INTO commerce.entitlements (principal_id, product_id, order_item_id, quantity, status) SELECT o.principal_id, oi.product_id, oi.id, oi.quantity, 'active' FROM commerce.orders o JOIN commerce.order_items oi ON oi.order_id = o.id WHERE o.id = $1 ON CONFLICT (order_item_id) WHERE order_item_id IS NOT NULL DO NOTHING",
            [payment.order_id]
          );
          await client.query(
            "INSERT INTO operations.event_outbox (event_type, aggregate_type, aggregate_id, payload) VALUES ('commerce.order.paid', 'order', $1, $2::jsonb)",
            [payment.order_id, JSON.stringify({ orderId: payment.order_id, principalId: payment.principal_id, paymentTransactionId: payment.id, provider: "stripe" })]
          );
          await client.query(
            "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES (NULL, 'payment.stripe.succeeded', 'order', $1, 'success', $2::jsonb)",
            [payment.order_id, JSON.stringify({ eventId: event.id, paymentTransactionId: payment.id })]
          );
        }
      } else if (supportedFailure) {
        await client.query(
          "UPDATE commerce.payment_transactions SET status = 'failed', provider_event_id = $1 WHERE id = $2 AND status <> 'succeeded'",
          [event.id, payment.id]
        );
        await client.query(
          "UPDATE commerce.orders o SET status = 'pending', updated_at = NOW() WHERE o.id = $1 AND o.status = 'awaiting_payment' AND NOT EXISTS (SELECT 1 FROM commerce.payment_transactions pt WHERE pt.order_id = o.id AND pt.provider = 'stripe' AND pt.status = 'pending' AND (pt.expires_at IS NULL OR pt.expires_at > NOW()))",
          [payment.order_id]
        );
        await client.query(
          "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES (NULL, 'payment.stripe.failed', 'order', $1, 'failure', $2::jsonb)",
          [payment.order_id, JSON.stringify({ eventId: event.id, paymentTransactionId: payment.id, eventType: event.type })]
        );
      }

      await client.query(
        "INSERT INTO commerce.payment_webhook_events (provider, event_id, event_type, payment_transaction_id) VALUES ('stripe', $1, $2, $3)",
        [event.id, event.type, payment.id]
      );
      await client.query("COMMIT");
      return { received: true, processed: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Stripe webhook processing failed");
      return reply.code(500).send({ error: { code: "WEBHOOK_PROCESSING_FAILED", message: "The payment event could not be processed." } });
    } finally {
      client.release();
    }
  });
}
