import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { requirePrincipal } from "../auth/session.js";

const orderSchema = z.object({
  currency: z.string().length(3).default("USD").transform((value) => value.toUpperCase()),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10)
  })).min(1).max(20)
});

type PricedProduct = {
  id: string;
  sku: string;
  name: string;
  amount_minor: string;
};

export async function registerCommerceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/catalog/products", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "The catalog is temporarily unavailable." } });
    const currency = typeof request.query === "object" && request.query !== null && "currency" in request.query
      ? String((request.query as { currency?: unknown }).currency ?? "USD").toUpperCase()
      : "USD";
    if (!/^[A-Z]{3}$/.test(currency)) {
      return reply.code(400).send({ error: { code: "INVALID_CURRENCY", message: "Currency must be a three-letter code." } });
    }

    const result = await pool.query(
      `SELECT p.id, p.sku, p.name, p.description, p.product_type AS "productType",
              pp.currency, pp.amount_minor AS "amountMinor"
         FROM commerce.products p
         JOIN LATERAL (
           SELECT currency, amount_minor
             FROM commerce.product_prices
            WHERE product_id = p.id
              AND currency = $1
              AND active_from <= NOW()
              AND (active_until IS NULL OR active_until > NOW())
            ORDER BY active_from DESC
            LIMIT 1
         ) pp ON TRUE
        WHERE p.status = 'active'
        ORDER BY p.name ASC`,
      [currency]
    );
    return { data: result.rows, requestId: request.id };
  });

  app.get("/account/entitlements", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Entitlements are temporarily unavailable." } });
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const result = await pool.query(
      `SELECT e.id, e.status, e.granted_at AS "grantedAt", e.expires_at AS "expiresAt",
              p.sku, p.name, p.product_type AS "productType"
         FROM commerce.entitlements e
         JOIN commerce.products p ON p.id = e.product_id
        WHERE e.principal_id = $1
        ORDER BY e.granted_at DESC`,
      [principalId]
    );
    return { data: result.rows, requestId: request.id };
  });

  app.get("/account/orders", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Order history is temporarily unavailable." } });
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const result = await pool.query(
      "SELECT o.id, o.status, o.currency, o.total_minor::text AS \"totalMinor\", " +
      "o.created_at AS \"createdAt\", latest_payment.status AS \"paymentStatus\", " +
      "COALESCE(json_agg(json_build_object('name', oi.name_snapshot, 'sku', oi.sku_snapshot, " +
      "'quantity', oi.quantity, 'unitAmountMinor', oi.unit_amount_minor::text)) " +
      "FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items " +
      "FROM commerce.orders o " +
      "LEFT JOIN commerce.order_items oi ON oi.order_id = o.id " +
      "LEFT JOIN LATERAL (SELECT status FROM commerce.payment_transactions WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) latest_payment ON TRUE " +
      "WHERE o.principal_id = $1 GROUP BY o.id, latest_payment.status ORDER BY o.created_at DESC LIMIT 50",
      [principalId]
    );
    return { data: result.rows, requestId: request.id };
  });

  app.post("/commerce/orders", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Checkout is temporarily unavailable." } });
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "The order items or currency are invalid." } });
    }
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key header between 8 and 128 characters." } });
    }

    const normalizedItems = [...parsed.data.items]
      .sort((a, b) => a.productId.localeCompare(b.productId));
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ currency: parsed.data.currency, items: normalizedItems }))
      .digest("hex");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string; request_hash: string | null; status: string }>(
        "SELECT id, request_hash, status FROM commerce.orders WHERE principal_id = $1 AND idempotency_key = $2",
        [principalId, idempotencyKey]
      );
      if (existing.rows[0]) {
        await client.query("ROLLBACK");
        if (existing.rows[0].request_hash !== requestHash) {
          return reply.code(409).send({ error: { code: "IDEMPOTENCY_CONFLICT", message: "This idempotency key was already used for a different order." } });
        }
        return { data: { orderId: existing.rows[0].id, status: existing.rows[0].status, reused: true }, requestId: request.id };
      }

      const productIds = normalizedItems.map((item) => item.productId);
      const products = await client.query<PricedProduct>(
        `SELECT p.id, p.sku, p.name, pp.amount_minor
           FROM commerce.products p
           JOIN LATERAL (
             SELECT amount_minor
               FROM commerce.product_prices
              WHERE product_id = p.id
                AND currency = $2
                AND active_from <= NOW()
                AND (active_until IS NULL OR active_until > NOW())
              ORDER BY active_from DESC
              LIMIT 1
           ) pp ON TRUE
          WHERE p.id = ANY($1::uuid[]) AND p.status = 'active'
          FOR SHARE OF p`,
        [productIds, parsed.data.currency]
      );

      if (products.rows.length !== new Set(productIds).size) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: { code: "PRODUCT_UNAVAILABLE", message: "One or more products are unavailable in the selected currency." } });
      }

      const byId = new Map(products.rows.map((product) => [product.id, product]));
      let subtotal = 0n;
      const lines = normalizedItems.map((item) => {
        const product = byId.get(item.productId);
        if (!product) throw new Error("Product price resolution failed");
        const unit = BigInt(product.amount_minor);
        const total = unit * BigInt(item.quantity);
        subtotal += total;
        return { ...item, product, unit, total };
      });

      const orderResult = await client.query<{ id: string }>(
        `INSERT INTO commerce.orders
          (principal_id, status, currency, subtotal_minor, tax_minor, total_minor, idempotency_key, request_hash)
         VALUES ($1, 'pending', $2, $3, 0, $3, $4, $5)
         RETURNING id`,
        [principalId, parsed.data.currency, subtotal.toString(), idempotencyKey, requestHash]
      );
      const orderId = orderResult.rows[0]?.id;
      if (!orderId) throw new Error("Order creation failed");

      for (const line of lines) {
        await client.query(
          `INSERT INTO commerce.order_items
            (order_id, product_id, sku_snapshot, name_snapshot, quantity, unit_amount_minor, line_total_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, line.product.id, line.product.sku, line.product.name, line.quantity, line.unit.toString(), line.total.toString()]
        );
      }

      await client.query(
        `INSERT INTO operations.event_outbox
          (event_type, aggregate_type, aggregate_id, payload)
         VALUES ('commerce.order.created', 'order', $1, $2::jsonb)`,
        [orderId, JSON.stringify({ orderId, principalId, currency: parsed.data.currency, totalMinor: subtotal.toString() })]
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        data: { orderId, status: "pending", currency: parsed.data.currency, totalMinor: subtotal.toString(), reused: false },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: { code: "ORDER_CONFLICT", message: "The order could not be created because the request conflicts with an existing order." } });
      }
      request.log.error({ err: error }, "Order creation failed");
      return reply.code(500).send({ error: { code: "ORDER_FAILED", message: "The order could not be created." } });
    } finally {
      client.release();
    }
  });
}
