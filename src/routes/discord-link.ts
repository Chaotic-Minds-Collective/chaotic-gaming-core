import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "../auth/session.js";
import { DiscordOAuthError, exchangeDiscordAuthorizationCode } from "../auth/discord-oauth.js";
import { config } from "../config.js";
import { pool } from "../db.js";

const callbackSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});

function isDiscordOAuthConfigured(): boolean {
  return Boolean(
    config.DISCORD_OAUTH_CLIENT_ID &&
    config.DISCORD_OAUTH_CLIENT_SECRET &&
    config.DISCORD_OAUTH_REDIRECT_URL
  );
}

function successResponse(reply: FastifyReply, status: string) {
  if (config.DISCORD_LINK_COMPLETE_URL) {
    const target = new URL(config.DISCORD_LINK_COMPLETE_URL);
    target.searchParams.set("discord", status);
    return reply.redirect(target.toString());
  }
  return reply.code(status === "linked" ? 201 : 200).send({
    data: { provider: "discord", linked: true, alreadyLinked: status === "already-linked" }
  });
}

export async function registerDiscordLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/discord-link/challenge", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." } });
    if (!isDiscordOAuthConfigured()) {
      return reply.code(503).send({ error: { code: "DISCORD_LINK_NOT_CONFIGURED", message: "Discord account linking is not configured yet." } });
    }

    const principalId = await requirePrincipal(request, reply);
    if (!principalId) return;

    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const result = await pool.query(
      `INSERT INTO core.identity_link_challenges (provider, state_hash, principal_id, expires_at)
       VALUES ('discord', $1, $2, NOW() + INTERVAL '10 minutes')
       RETURNING expires_at AS "expiresAt"`,
      [stateHash, principalId]
    );

    const authorizationUrl = new URL("https://discord.com/oauth2/authorize");
    authorizationUrl.searchParams.set("client_id", config.DISCORD_OAUTH_CLIENT_ID!);
    authorizationUrl.searchParams.set("redirect_uri", config.DISCORD_OAUTH_REDIRECT_URL!);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "identify");
    authorizationUrl.searchParams.set("state", state);

    return reply.code(201).send({
      data: {
        authorizationUrl: authorizationUrl.toString(),
        expiresAt: result.rows[0].expiresAt
      },
      requestId: request.id
    });
  });

  app.get("/auth/discord-link/callback", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Account linking is temporarily unavailable." } });
    if (!isDiscordOAuthConfigured()) {
      return reply.code(503).send({ error: { code: "DISCORD_LINK_NOT_CONFIGURED", message: "Discord account linking is not configured yet." } });
    }

    const parsed = callbackSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "INVALID_DISCORD_CALLBACK", message: "A valid Discord authorization code and state are required." } });
    }

    const stateHash = createHash("sha256").update(parsed.data.state).digest("hex");
    const challenge = await pool.query<{ principal_id: string }>(
      `UPDATE core.identity_link_challenges
          SET consumed_at = NOW()
        WHERE provider = 'discord'
          AND state_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING principal_id`,
      [stateHash]
    );
    const principalId = challenge.rows[0]?.principal_id;
    if (!principalId) {
      return reply.code(409).send({ error: { code: "DISCORD_STATE_INVALID", message: "The Discord link session is invalid, expired or already used." } });
    }

    let identity: { discordId: string; username: string };
    try {
      identity = await exchangeDiscordAuthorizationCode(parsed.data.code, {
        clientId: config.DISCORD_OAUTH_CLIENT_ID!,
        clientSecret: config.DISCORD_OAUTH_CLIENT_SECRET!,
        redirectUri: config.DISCORD_OAUTH_REDIRECT_URL!
      });
    } catch (error) {
      if (error instanceof DiscordOAuthError) {
        const status = error.code === "DISCORD_UNAVAILABLE" ? 503 : 401;
        return reply.code(status).send({ error: { code: error.code, message: error.message } });
      }
      request.log.error({ err: error }, "Discord identity verification failed");
      return reply.code(502).send({ error: { code: "DISCORD_VERIFICATION_FAILED", message: "Discord identity verification failed." } });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const principal = await client.query(
        "SELECT id FROM core.principals WHERE id = $1 AND status = 'active' FOR UPDATE",
        [principalId]
      );
      if (!principal.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: { code: "ACCOUNT_INACTIVE", message: "The Chaotic Gaming account is no longer active." } });
      }

      const existingIdentity = await client.query<{ principal_id: string }>(
        `SELECT principal_id FROM core.linked_accounts
          WHERE provider = 'discord' AND external_id = $1 AND unlinked_at IS NULL
          FOR UPDATE`,
        [identity.discordId]
      );
      if (existingIdentity.rows[0] && existingIdentity.rows[0].principal_id !== principalId) {
        await client.query("COMMIT");
        return reply.code(409).send({ error: { code: "DISCORD_ACCOUNT_ALREADY_LINKED", message: "This Discord account is linked to another Chaotic Gaming account." } });
      }

      const existingForPrincipal = await client.query<{ external_id: string }>(
        `SELECT external_id FROM core.linked_accounts
          WHERE principal_id = $1 AND provider = 'discord' AND unlinked_at IS NULL
          FOR UPDATE`,
        [principalId]
      );
      if (existingForPrincipal.rows[0]) {
        await client.query("COMMIT");
        if (existingForPrincipal.rows[0].external_id === identity.discordId) {
          return successResponse(reply, "already-linked");
        }
        return reply.code(409).send({ error: { code: "DISCORD_ACCOUNT_ALREADY_SET", message: "Unlink the existing Discord account before linking a different one." } });
      }

      await client.query(
        `INSERT INTO core.linked_accounts
          (principal_id, provider, external_id, external_username, verified_at)
         VALUES ($1, 'discord', $2, $3, NOW())`,
        [principalId, identity.discordId, identity.username]
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'identity.link', 'linked_account', $2, 'success', $3::jsonb)`,
        [principalId, identity.discordId, JSON.stringify({ provider: "discord" })]
      );
      await client.query("COMMIT");
      return successResponse(reply, "linked");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: { code: "DISCORD_ACCOUNT_ALREADY_LINKED", message: "This Discord account is already linked." } });
      }
      request.log.error({ err: error }, "Discord account link failed");
      return reply.code(500).send({ error: { code: "DISCORD_LINK_FAILED", message: "The Discord account could not be linked." } });
    } finally {
      client.release();
    }
  });
}
