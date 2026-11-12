import { z } from "zod";
import { pool } from "../db.js";

const productSchema = z.object({
  sku: z.string().min(3).max(80).regex(/^[A-Z0-9][A-Z0-9._-]+$/),
  name: z.string().min(2).max(160),
  description: z.string().max(2000).nullable().optional(),
  productType: z.enum(["digital_item", "game_entitlement", "subscription", "supporter", "currency_pack", "service"]),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  amountMinor: z.string().regex(/^\d+$/).or(z.number().int().nonnegative().transform(String)),
  gameKey: z.enum(["atlas", "7dtd", "ark"]).optional(),
  deliveryType: z.string().min(2).max(80).optional(),
  deliveryPayload: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, context) => {
  if (value.gameKey && !value.deliveryType) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["deliveryType"], message: "deliveryType is required when gameKey is set." });
  }
  if (value.deliveryType && !value.gameKey) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["gameKey"], message: "gameKey is required when deliveryType is set." });
  }
});

const raw = process.argv[2];
if (!raw) throw new Error("Usage: npm run product:upsert -- '<JSON product definition>'");
let input: unknown;
try {
  input = JSON.parse(raw);
} catch {
  throw new Error("Product definition must be valid JSON.");
}
const parsed = productSchema.safeParse(input);
if (!parsed.success) {
  throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
}
if (!pool) throw new Error("DATABASE_URL is required.");

const product = parsed.data;
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM commerce.products WHERE sku = $1 FOR UPDATE",
    [product.sku]
  );

  const saved = await client.query<{ id: string }>(
    `INSERT INTO commerce.products (sku, name, description, product_type, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sku) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           product_type = EXCLUDED.product_type,
           status = EXCLUDED.status,
           updated_at = NOW()
     RETURNING id`,
    [product.sku, product.name, product.description ?? null, product.productType, product.status]
  );
  const productId = saved.rows[0]?.id;
  if (!productId) throw new Error("Product upsert failed.");

  const latestPrice = await client.query<{ amount_minor: string; id: string }>(
    `SELECT id, amount_minor
       FROM commerce.product_prices
      WHERE product_id = $1 AND currency = $2
        AND active_from <= NOW()
        AND (active_until IS NULL OR active_until > NOW())
      ORDER BY active_from DESC
      LIMIT 1
      FOR UPDATE`,
    [productId, product.currency]
  );
  if (latestPrice.rows[0]?.amount_minor !== String(product.amountMinor)) {
    await client.query(
      `UPDATE commerce.product_prices
          SET active_until = NOW()
        WHERE product_id = $1 AND currency = $2
          AND active_from <= NOW()
          AND (active_until IS NULL OR active_until > NOW())`,
      [productId, product.currency]
    );
    await client.query(
      `INSERT INTO commerce.product_prices (product_id, currency, amount_minor)
       VALUES ($1, $2, $3)`,
      [productId, product.currency, String(product.amountMinor)]
    );
  }

  if (product.gameKey && product.deliveryType) {
    await client.query(
      `INSERT INTO commerce.product_game_mappings (product_id, game_key, delivery_type, delivery_payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (product_id, game_key) DO UPDATE
         SET delivery_type = EXCLUDED.delivery_type,
             delivery_payload = EXCLUDED.delivery_payload`,
      [productId, product.gameKey, product.deliveryType, JSON.stringify(product.deliveryPayload ?? {})]
    );
  }

  await client.query("COMMIT");
  console.info(`Product ${product.sku} saved (${productId}).`);
  if (!existing.rows[0]) console.info("New product created.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
