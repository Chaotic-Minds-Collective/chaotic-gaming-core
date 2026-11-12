import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "../auth/session.js";
import { SteamOpenIdError, verifySteamOpenIdAssertion } from "../auth/steam-openid.js";
import { config } from "../config.js";
import { pool } from "../db.js";

const challengeSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const linkSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  assertion: z.record(z.string(), z.string()),
});

export async function registerSteamLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/steam-link/challenge", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." } });
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;
    const parsed = challengeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "INVALID_STEAM_STATE", message: "A valid Steam link state is required." } });
    }

    const stateHash = createHash("sha256").update(parsed.data.state).digest("hex");
    const result = await pool.query(
      `INSERT INTO core.identity_link_challenges (provider, state_hash, principal_id, expires_at)
       VALUES ('steam', $1, $2, NOW() + INTERVAL '10 minutes')
       RETURNING expires_at AS "expiresAt"`,
      [stateHash, principalId]
    );
    return reply.code(201).send({ data: { created: true, expiresAt: result.rows[0].expiresAt }, requestId: request.id });
  });

  app.post("/auth/linked-accounts/steam", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." } });
    if (!config.STEAM_OPENID_RETURN_URL) {
      return reply.code(503).send({ error: { code: "STEAM_LINK_NOT_CONFIGURED", message: "Steam account linking is not configured yet." } });
    }

    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const parsed = linkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "INVALID_STEAM_ASSERTION", message: "A valid Steam OpenID assertion and link state are required." } });
    }

    const stateHash = createHash("sha256").update(parsed.data.state).digest("hex");
    const challenge = await pool.query(
      `SELECT id
         FROM core.identity_link_challenges
        WHERE provider = 'steam'
          AND state_hash = $1
          AND principal_id = $2
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [stateHash, principalId]
    );
    if (!challenge.rows[0]) {
      return reply.code(409).send({ error: { code: "STEAM_STATE_INVALID", message: "The Steam link session is invalid, expired or already used." } });
    }

    let verified: { steamId: string; nonce: string };
    try {
      verified = await verifySteamOpenIdAssertion(parsed.data.assertion, config.STEAM_OPENID_RETURN_URL, parsed.data.state);
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
      const consumed = await client.query(
        `UPDATE core.identity_link_challenges
            SET consumed_at = NOW()
          WHERE provider = 'steam'
            AND state_hash = $1
            AND principal_id = $2
            AND consumed_at IS NULL
            AND expires_at > NOW()
          RETURNING id`,
        [stateHash, principalId]
      );
      if (!consumed.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "STEAM_STATE_INVALID", message: "The Steam link session is invalid, expired or already used." } });
      }

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
        await client.query("COMMIT");
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
        await client.query("COMMIT");
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
