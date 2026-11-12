import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
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


const createProductSchema = z.object({
  sku: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).nullable().optional(),
  productType: z.enum(["digital_item", "game_entitlement", "subscription", "supporter", "currency_pack", "service"]),
  status: z.enum(["draft", "active"]).default("draft"),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  amountMinor: z.number().int().min(0).max(100000000)
});

const updateProductSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["draft", "active", "retired"]).optional()
}).refine((value) => value.name !== undefined || value.description !== undefined || value.status !== undefined);

const productPriceSchema = z.object({
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  amountMinor: z.number().int().min(0).max(100000000)
});

const productMappingSchema = z.object({
  serverId: z.string().uuid(),
  deliveryType: z.string().min(2).max(64),
  deliveryPayload: z.record(z.string(), z.unknown()).default({})
});

async function requireCommerceAdmin(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  if (!pool) {
    reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Commerce administration is temporarily unavailable." } });
    return null;
  }
  const principalId = await requirePrincipal(request, reply);
  if (!principalId) return null;
  const permission = await pool.query(
    "SELECT 1 FROM core.principal_role_assignments pra " +
    "JOIN core.role_permissions rp ON rp.role_id = pra.role_id " +
    "JOIN core.permissions p ON p.id = rp.permission_id " +
    "WHERE pra.principal_id = $1 AND p.permission_key = 'commerce.manage' " +
    "AND pra.scope_type = 'platform' AND pra.scope_id IS NULL " +
    "AND (pra.expires_at IS NULL OR pra.expires_at > NOW()) LIMIT 1",
    [principalId]
  );
  if (!permission.rowCount) {
    await pool.query(
      "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, outcome, metadata) VALUES ($1, 'commerce.admin.denied', 'commerce_catalog', 'denied', $2::jsonb)",
      [principalId, JSON.stringify({ requestId: request.id })]
    );
    reply.code(403).send({ error: { code: "FORBIDDEN", message: "Platform commerce management permission is required." } });
    return null;
  }
  return principalId;
}

type PricedProduct = {
  id: string;
  sku: string;
  name: string;
  amount_minor: string;
};

export async function registerCommerceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/commerce/products", async (request, reply) => {
    const actorId = await requireCommerceAdmin(request, reply);
    if (!actorId) return;
    const result = await pool!.query(
      "SELECT p.id, p.sku, p.name, p.description, p.product_type AS \"productType\", p.status, " +
      "COALESCE((SELECT json_agg(json_build_object('currency', pp.currency, 'amountMinor', pp.amount_minor::text, 'activeFrom', pp.active_from, 'activeUntil', pp.active_until) ORDER BY pp.currency, pp.active_from DESC) FROM commerce.product_prices pp WHERE pp.product_id = p.id), '[]'::json) AS prices, " +
      "COALESCE((SELECT json_agg(json_build_object('gameKey', pgm.game_key, 'serverId', pgm.server_id, 'serverName', s.name, 'deliveryType', pgm.delivery_type, 'deliveryPayload', pgm.delivery_payload) ORDER BY pgm.game_key) FROM commerce.product_game_mappings pgm LEFT JOIN core.servers s ON s.id = pgm.server_id WHERE pgm.product_id = p.id), '[]'::json) AS \"gameMappings\" " +
      "FROM commerce.products p ORDER BY p.created_at DESC"
    );
    return { data: result.rows, requestId: request.id };
  });

  app.post("/admin/commerce/products", async (request, reply) => {
    const actorId = await requireCommerceAdmin(request, reply);
    if (!actorId) return;
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "The product details or initial price are invalid." } });

    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const product = await client.query<{ id: string }>(
        "INSERT INTO commerce.products (sku, name, description, product_type, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [parsed.data.sku, parsed.data.name, parsed.data.description ?? null, parsed.data.productType, parsed.data.status]
      );
      const productId = product.rows[0].id;
      await client.query(
        "INSERT INTO commerce.product_prices (product_id, currency, amount_minor) VALUES ($1, $2, $3)",
        [productId, parsed.data.currency, parsed.data.amountMinor]
      );
      await client.query(
        "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'commerce.product.created', 'product', $2, 'success', $3::jsonb)",
        [actorId, productId, JSON.stringify({ sku: parsed.data.sku, status: parsed.data.status })]
      );
      await client.query("COMMIT");
      return reply.code(201).send({ data: { productId }, requestId: request.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: { code: "PRODUCT_SKU_EXISTS", message: "A product with that SKU already exists." } });
      request.log.error({ err: error }, "Commerce product creation failed");
      return reply.code(500).send({ error: { code: "PRODUCT_CREATE_FAILED", message: "The product could not be created." } });
    } finally {
      client.release();
    }
  });

  app.patch("/admin/commerce/products/:productId", async (request, reply) => {
    const actorId = await requireCommerceAdmin(request, reply);
    if (!actorId) return;
    const params = z.object({ productId: z.string().uuid() }).safeParse(request.params);
    const parsed = updateProductSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "The product update is invalid." } });

    const hasDescription = Object.prototype.hasOwnProperty.call(parsed.data, "description");
    const result = await pool!.query(
      "UPDATE commerce.products SET name = COALESCE($2, name), description = CASE WHEN $3 THEN $4 ELSE description END, status = COALESCE($5, status), updated_at = NOW() WHERE id = $1 RETURNING id, sku, name, status",
      [params.data.productId, parsed.data.name ?? null, hasDescription, parsed.data.description ?? null, parsed.data.status ?? null]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: { code: "PRODUCT_NOT_FOUND", message: "The product was not found." } });
    await pool!.query(
      "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'commerce.product.updated', 'product', $2, 'success', $3::jsonb)",
      [actorId, params.data.productId, JSON.stringify({ changedFields: Object.keys(parsed.data) })]
    );
    return { data: result.rows[0], requestId: request.id };
  });

  app.post("/admin/commerce/products/:productId/prices", async (request, reply) => {
    const actorId = await requireCommerceAdmin(request, reply);
    if (!actorId) return;
    const params = z.object({ productId: z.string().uuid() }).safeParse(request.params);
    const parsed = productPriceSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "The product price is invalid." } });

    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const product = await client.query("SELECT id FROM commerce.products WHERE id = $1 FOR UPDATE", [params.data.productId]);
      if (!product.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "PRODUCT_NOT_FOUND", message: "The product was not found." } });
      }
      await client.query(
        "UPDATE commerce.product_prices SET active_until = NOW() WHERE product_id = $1 AND currency = $2 AND active_from < NOW() AND (active_until IS NULL OR active_until > NOW())",
        [params.data.productId, parsed.data.currency]
      );
      const price = await client.query(
        "INSERT INTO commerce.product_prices (product_id, currency, amount_minor) VALUES ($1, $2, $3) RETURNING id, currency, amount_minor::text AS \"amountMinor\", active_from AS \"activeFrom\"",
        [params.data.productId, parsed.data.currency, parsed.data.amountMinor]
      );
      await client.query(
        "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'commerce.product.price.created', 'product', $2, 'success', $3::jsonb)",
        [actorId, params.data.productId, JSON.stringify({ currency: parsed.data.currency, amountMinor: parsed.data.amountMinor })]
      );
      await client.query("COMMIT");
      return reply.code(201).send({ data: price.rows[0], requestId: request.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Commerce price creation failed");
      return reply.code(500).send({ error: { code: "PRICE_CREATE_FAILED", message: "The product price could not be created." } });
    } finally {
      client.release();
    }
  });

  app.put("/admin/commerce/products/:productId/game-mappings/:gameKey", async (request, reply) => {
    const actorId = await requireCommerceAdmin(request, reply);
    if (!actorId) return;
    const params = z.object({ productId: z.string().uuid(), gameKey: z.string().min(2).max(40) }).safeParse(request.params);
    const parsed = productMappingSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "The game delivery mapping is invalid." } });

    const server = await pool!.query(
      "SELECT id FROM core.servers WHERE id = $1 AND game_key = $2",
      [parsed.data.serverId, params.data.gameKey]
    );
    if (!server.rowCount) return reply.code(400).send({ error: { code: "SERVER_GAME_MISMATCH", message: "The selected server does not belong to the selected game." } });
    const product = await pool!.query("SELECT id FROM commerce.products WHERE id = $1", [params.data.productId]);
    if (!product.rowCount) return reply.code(404).send({ error: { code: "PRODUCT_NOT_FOUND", message: "The product was not found." } });

    const result = await pool!.query(
      "INSERT INTO commerce.product_game_mappings (product_id, game_key, server_id, delivery_type, delivery_payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (product_id, game_key) DO UPDATE SET server_id = EXCLUDED.server_id, delivery_type = EXCLUDED.delivery_type, delivery_payload = EXCLUDED.delivery_payload RETURNING id, game_key AS \"gameKey\", server_id AS \"serverId\", delivery_type AS \"deliveryType\", delivery_payload AS \"deliveryPayload\"",
      [params.data.productId, params.data.gameKey, parsed.data.serverId, parsed.data.deliveryType, JSON.stringify(parsed.data.deliveryPayload)]
    );
    await pool!.query(
      "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'commerce.product.mapping.upserted', 'product', $2, 'success', $3::jsonb)",
      [actorId, params.data.productId, JSON.stringify({ gameKey: params.data.gameKey, serverId: parsed.data.serverId, deliveryType: parsed.data.deliveryType })]
    );
    return { data: result.rows[0], requestId: request.id };
  });

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
      "SELECT e.id, e.status, e.granted_at AS \"grantedAt\", e.expires_at AS \"expiresAt\", " +
      "e.quantity, p.sku, p.name, p.product_type AS \"productType\", " +
      "COALESCE((SELECT json_agg(json_build_object('gameKey', pgm.game_key, 'serverId', pgm.server_id, " +
      "'serverName', s.name, 'rewardStatus', rq.status) ORDER BY pgm.game_key) " +
      "FROM commerce.product_game_mappings pgm " +
      "JOIN core.servers s ON s.id = pgm.server_id AND s.game_key = pgm.game_key " +
      "LEFT JOIN commerce.reward_queue rq ON rq.entitlement_id = e.id AND rq.game_key = pgm.game_key " +
      "WHERE pgm.product_id = e.product_id AND pgm.server_id IS NOT NULL), '[]'::json) AS \"deliveryTargets\" " +
      "FROM commerce.entitlements e JOIN commerce.products p ON p.id = e.product_id " +
      "WHERE e.principal_id = $1 ORDER BY e.granted_at DESC",
      [principalId]
    );
    return { data: result.rows, requestId: request.id };
  });

  app.post("/account/entitlements/:entitlementId/claim", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Reward claims are temporarily unavailable." } });
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;
    const params = z.object({ entitlementId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "INVALID_ENTITLEMENT_ID", message: "A valid entitlement ID is required." } });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const entitlementResult = await client.query<{
        id: string; product_id: string; order_item_id: string | null; status: string; quantity: number; sku: string; name: string;
      }>(
        "SELECT e.id, e.product_id, e.order_item_id, e.status, e.quantity, p.sku, p.name FROM commerce.entitlements e JOIN commerce.products p ON p.id = e.product_id WHERE e.id = $1 AND e.principal_id = $2 FOR UPDATE OF e",
        [params.data.entitlementId, principalId]
      );
      const entitlement = entitlementResult.rows[0];
      if (!entitlement) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "ENTITLEMENT_NOT_FOUND", message: "The entitlement was not found." } });
      }
      if (entitlement.status !== "active") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "ENTITLEMENT_NOT_ACTIVE", message: "Only active entitlements can be delivered." } });
      }

      const steamResult = await client.query<{ external_id: string }>(
        "SELECT external_id FROM core.linked_accounts WHERE principal_id = $1 AND provider = 'steam' AND verified_at IS NOT NULL AND unlinked_at IS NULL ORDER BY linked_at DESC LIMIT 1",
        [principalId]
      );
      const steamId = steamResult.rows[0]?.external_id;
      if (!steamId) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "VERIFIED_STEAM_ACCOUNT_REQUIRED", message: "Link and verify a Steam account before claiming in-game items." } });
      }

      const mappings = await client.query<{
        game_key: string; server_id: string; delivery_type: string; delivery_payload: Record<string, unknown>;
      }>(
        "SELECT pgm.game_key, pgm.server_id, pgm.delivery_type, pgm.delivery_payload FROM commerce.product_game_mappings pgm JOIN core.servers s ON s.id = pgm.server_id AND s.game_key = pgm.game_key WHERE pgm.product_id = $1 AND pgm.server_id IS NOT NULL ORDER BY pgm.game_key",
        [entitlement.product_id]
      );
      if (!mappings.rows.length) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "GAME_DELIVERY_NOT_CONFIGURED", message: "No game server delivery target is configured for this item yet." } });
      }

      for (const mapping of mappings.rows) {
        const idempotencyKey = (entitlement.order_item_id ? "order_item:" + entitlement.order_item_id : "entitlement:" + entitlement.id) + ":" + mapping.game_key;
        const payload = {
          deliveryType: mapping.delivery_type,
          productSku: entitlement.sku,
          productName: entitlement.name,
          quantity: entitlement.quantity,
          mapping: mapping.delivery_payload
        };
        await client.query(
          "INSERT INTO commerce.reward_queue (entitlement_id, game_key, server_id, target_external_id, delivery_payload, idempotency_key) VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (idempotency_key) DO NOTHING",
          [entitlement.id, mapping.game_key, mapping.server_id, steamId, JSON.stringify(payload), idempotencyKey]
        );
      }

      const deliveries = await client.query(
        "SELECT id, game_key AS \"gameKey\", server_id AS \"serverId\", status, created_at AS \"createdAt\" FROM commerce.reward_queue WHERE entitlement_id = $1 ORDER BY created_at DESC",
        [entitlement.id]
      );
      await client.query(
        "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome, metadata) VALUES ($1, 'reward.claim.requested', 'entitlement', $2, 'success', $3::jsonb)",
        [principalId, entitlement.id, JSON.stringify({ deliveryCount: deliveries.rows.length })]
      );
      await client.query("COMMIT");
      return reply.code(202).send({ data: { entitlementId: entitlement.id, deliveries: deliveries.rows }, requestId: request.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Entitlement reward claim failed");
      return reply.code(500).send({ error: { code: "ENTITLEMENT_CLAIM_FAILED", message: "The in-game delivery request could not be queued." } });
    } finally {
      client.release();
    }
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
