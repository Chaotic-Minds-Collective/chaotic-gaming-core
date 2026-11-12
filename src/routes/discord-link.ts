import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "../auth/session.js";
import {
  createDiscordAuthorizationUrl,
  DiscordOAuthError,
  exchangeDiscordAuthorizationCode,
  type DiscordLinkedIdentity,
} from "../auth/discord-oauth.js";
import { config } from "../config.js";
import { pool } from "../db.js";

const callbackSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  iss: z.literal("https://discord.com"),
});

const discordOAuthConfig = () => {
  const { DISCORD_OAUTH_CLIENT_ID, DISCORD_OAUTH_CLIENT_SECRET, DISCORD_OAUTH_REDIRECT_URI } = config;
  if (!DISCORD_OAUTH_CLIENT_ID || !DISCORD_OAUTH_CLIENT_SECRET || !DISCORD_OAUTH_REDIRECT_URI) {
    return null;
  }
  return {
    clientId: DISCORD_OAUTH_CLIENT_ID,
    clientSecret: DISCORD_OAUTH_CLIENT_SECRET,
    redirectUri: DISCORD_OAUTH_REDIRECT_URI,
  };
};

export async function registerDiscordLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/discord-link/challenge", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!pool) {
      return reply.code(503).send({
        error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." },
      });
    }
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const oauth = discordOAuthConfig();
    if (!oauth) {
      return reply.code(503).send({
        error: { code: "DISCORD_LINK_NOT_CONFIGURED", message: "Discord account linking is not configured yet." },
      });
    }

    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const result = await pool.query(
      `INSERT INTO core.identity_link_challenges (provider, state_hash, principal_id, expires_at)
       VALUES ('discord', $1, $2, NOW() + INTERVAL '10 minutes')
       RETURNING expires_at AS "expiresAt"`,
      [stateHash, principalId],
    );

    return reply.code(201).send({
      data: {
        state,
        authorizationUrl: createDiscordAuthorizationUrl(oauth, state),
        expiresAt: result.rows[0].expiresAt,
      },
      requestId: request.id,
    });
  });

  app.post("/auth/linked-accounts/discord", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!pool) {
      return reply.code(503).send({
        error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." },
      });
    }
    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const oauth = discordOAuthConfig();
    if (!oauth) {
      return reply.code(503).send({
        error: { code: "DISCORD_LINK_NOT_CONFIGURED", message: "Discord account linking is not configured yet." },
      });
    }

    const parsed = callbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "INVALID_DISCORD_ASSERTION", message: "A valid Discord authorization code, state and issuer are required." },
      });
    }

    const stateHash = createHash("sha256").update(parsed.data.state).digest("hex");
    const challenge = await pool.query<{ id: string }>(
      `SELECT id
         FROM core.identity_link_challenges
        WHERE provider = 'discord'
          AND state_hash = $1
          AND principal_id = $2
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [stateHash, principalId],
    );
    if (!challenge.rows[0]) {
      return reply.code(409).send({
        error: { code: "DISCORD_STATE_INVALID", message: "The Discord link session is invalid, expired or already used." },
      });
    }

    let identity: DiscordLinkedIdentity;
    try {
      identity = await exchangeDiscordAuthorizationCode(oauth, parsed.data.code);
    } catch (error) {
      if (error instanceof DiscordOAuthError) {
        const status = error.code === "DISCORD_UNAVAILABLE" ? 503
          : error.code === "DISCORD_TOKEN_EXCHANGE_FAILED" ? 401 : 502;
        return reply.code(status).send({ error: { code: error.code, message: error.message } });
      }
      request.log.error({ err: error }, "Discord identity verification failed");
      return reply.code(502).send({
        error: { code: "DISCORD_VERIFICATION_FAILED", message: "Discord identity verification failed." },
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query<{ id: string }>(
        `UPDATE core.identity_link_challenges
            SET consumed_at = NOW()
          WHERE id = $1
            AND provider = 'discord'
            AND principal_id = $2
            AND consumed_at IS NULL
            AND expires_at > NOW()
          RETURNING id`,
        [challenge.rows[0].id, principalId],
      );
      if (!consumed.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: { code: "DISCORD_STATE_INVALID", message: "The Discord link session is invalid, expired or already used." },
        });
      }

      const existing = await client.query<{ principal_id: string }>(
        `SELECT principal_id
           FROM core.linked_accounts
          WHERE provider = 'discord'
            AND external_id = $1
            AND unlinked_at IS NULL
          FOR UPDATE`,
        [identity.externalId],
      );
      if (existing.rows[0] && existing.rows[0].principal_id !== principalId) {
        await client.query("COMMIT");
        return reply.code(409).send({
          error: { code: "DISCORD_ACCOUNT_ALREADY_LINKED", message: "This Discord account is linked to another Chaotic Gaming account." },
        });
      }

      if (existing.rows[0]) {
        await client.query("COMMIT");
        return {
          data: { provider: "discord", externalId: identity.externalId, linked: true, alreadyLinked: true },
          requestId: request.id,
        };
      }

      const ownProvider = await client.query(
        `SELECT 1
           FROM core.linked_accounts
          WHERE principal_id = $1
            AND provider = 'discord'
            AND unlinked_at IS NULL
          LIMIT 1`,
        [principalId],
      );
      if (ownProvider.rows[0]) {
        await client.query("COMMIT");
        return reply.code(409).send({
          error: { code: "DISCORD_ACCOUNT_ALREADY_SET", message: "Unlink the existing Discord account before linking a different one." },
        });
      }

      await client.query(
        `INSERT INTO core.linked_accounts (principal_id, provider, external_id, external_username, verified_at)
         VALUES ($1, 'discord', $2, $3, NOW())`,
        [principalId, identity.externalId, identity.externalUsername],
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'identity.link', 'linked_account', $2, 'success', $3::jsonb)`,
        [principalId, identity.externalId, JSON.stringify({ provider: "discord" })],
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        data: { provider: "discord", externalId: identity.externalId, linked: true, alreadyLinked: false },
        requestId: request.id,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({
          error: { code: "DISCORD_ACCOUNT_ALREADY_LINKED", message: "This Discord account is already linked." },
        });
      }
      request.log.error({ err: error }, "Discord account link failed");
      return reply.code(500).send({
        error: { code: "DISCORD_LINK_FAILED", message: "The Discord account could not be linked." },
      });
    } finally {
      client.release();
    }
  });
}
