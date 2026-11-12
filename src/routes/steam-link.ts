import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "../auth/session.js";
import { SteamOpenIdError, verifySteamOpenIdAssertion } from "../auth/steam-openid.js";
import { config } from "../config.js";
import { pool } from "../db.js";

const assertionSchema = z.record(z.string(), z.string());

export async function registerSteamLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/linked-accounts/steam", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." } });
    if (!config.STEAM_OPENID_RETURN_URL) {
      return reply.code(503).send({ error: { code: "STEAM_LINK_NOT_CONFIGURED", message: "Steam account linking is not configured yet." } });
    }

    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const parsed = assertionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "INVALID_STEAM_ASSERTION", message: "A valid Steam OpenID assertion is required." } });
    }

    let verified: { steamId: string; nonce: string };
    try {
      verified = await verifySteamOpenIdAssertion(parsed.data, config.STEAM_OPENID_RETURN_URL);
    } catch (error) {
      if (error instanceof SteamOpenIdError) {
        const status = error.code === "STEAM_UNAVAILABLE" ? 503 : 401;
        return reply.code(status).send({ error: { code: error.code, message: error.message } });
      }
      request.log.error({ err: error }, "Steam identity verification failed");
      return reply.code(502).send({ error: { code: "STEAM_VERIFICATION_FAILED", message: "Steam identity verification failed." } });
    }

    const nonceHash = createHash("sha256").update(verified.nonce).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const nonce = await client.query(
        `INSERT INTO core.identity_assertion_nonces (provider, nonce_hash, principal_id, external_id)
         VALUES ('steam', $1, $2, $3)
         ON CONFLICT (nonce_hash) DO NOTHING
         RETURNING id`,
        [nonceHash, principalId, verified.steamId]
      );
      if (!nonce.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "STEAM_ASSERTION_REPLAYED", message: "This Steam assertion has already been used." } });
      }

      const existing = await client.query<{ principal_id: string }>(
        `SELECT principal_id
           FROM core.linked_accounts
          WHERE provider = 'steam' AND external_id = $1 AND unlinked_at IS NULL
          FOR UPDATE`,
        [verified.steamId]
      );
      if (existing.rows[0] && existing.rows[0].principal_id !== principalId) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "STEAM_ACCOUNT_ALREADY_LINKED", message: "This Steam account is linked to another Chaotic Gaming account." } });
      }

      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { data: { provider: "steam", externalId: verified.steamId, linked: true, alreadyLinked: true }, requestId: request.id };
      }

      const ownProvider = await client.query(
        `SELECT 1 FROM core.linked_accounts
          WHERE principal_id = $1 AND provider = 'steam' AND unlinked_at IS NULL
          LIMIT 1`,
        [principalId]
      );
      if (ownProvider.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "STEAM_ACCOUNT_ALREADY_SET", message: "Unlink the existing Steam account before linking a different one." } });
      }

      await client.query(
        `INSERT INTO core.linked_accounts (principal_id, provider, external_id, verified_at)
         VALUES ($1, 'steam', $2, NOW())`,
        [principalId, verified.steamId]
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'identity.link', 'linked_account', $2, 'success', $3::jsonb)`,
        [principalId, verified.steamId, JSON.stringify({ provider: "steam" })]
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        data: { provider: "steam", externalId: verified.steamId, linked: true, alreadyLinked: false },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: { code: "STEAM_ACCOUNT_ALREADY_LINKED", message: "This Steam account is already linked." } });
      }
      request.log.error({ err: error }, "Steam account link failed");
      return reply.code(500).send({ error: { code: "STEAM_LINK_FAILED", message: "The Steam account could not be linked." } });
    } finally {
      client.release();
    }
  });
}
