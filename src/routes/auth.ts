import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { issueSession, requirePrincipal } from "../auth/session.js";

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/),
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(12).max(128)
});

const loginSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(1).max(128)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Registration is temporarily unavailable." } });

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Check the username, email, and password requirements." } });
    }

    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const principal = await client.query<{ id: string }>(
        "INSERT INTO core.principals (principal_type, status) VALUES ('user', 'active') RETURNING id"
      );
      const principalId = principal.rows[0]?.id;
      if (!principalId) throw new Error("Principal creation failed");

      await client.query(
        "INSERT INTO core.users (principal_id, username, email, password_hash) VALUES ($1, $2, $3, $4)",
        [principalId, parsed.data.username, parsed.data.email ?? null, passwordHash]
      );
      await client.query(
        "INSERT INTO core.user_profiles (principal_id, display_name) VALUES ($1, $2)",
        [principalId, parsed.data.username]
      );
      await client.query(
        "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome) VALUES ($1, 'identity.register', 'principal', $1, 'success')",
        [principalId]
      );
      await client.query("COMMIT");

      const session = await issueSession(principalId, request);
      return reply.code(201).send({
        data: { playerId: principalId, username: parsed.data.username, session },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: { code: "ACCOUNT_EXISTS", message: "That username or email is already registered." } });
      }
      request.log.error({ err: error }, "Account registration failed");
      return reply.code(500).send({ error: { code: "REGISTRATION_FAILED", message: "The account could not be created." } });
    } finally {
      client.release();
    }
  });

  app.post("/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Login is temporarily unavailable." } });

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A username and password are required." } });
    }

    const result = await pool.query<{ principal_id: string; password_hash: string | null; username: string }>(
      `SELECT u.principal_id, u.password_hash, u.username
         FROM core.users u
         JOIN core.principals p ON p.id = u.principal_id
        WHERE LOWER(u.username) = LOWER($1) AND p.status = 'active'`,
      [parsed.data.username]
    );
    const account = result.rows[0];
    const valid = account?.password_hash
      ? await argon2.verify(account.password_hash, parsed.data.password).catch(() => false)
      : false;

    if (!account || !valid) {
      return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Username or password is incorrect." } });
    }

    const session = await issueSession(account.principal_id, request);
    await pool.query(
      "INSERT INTO operations.audit_logs (actor_principal_id, action, resource_type, resource_id, outcome) VALUES ($1, 'identity.login', 'principal', $1, 'success')",
      [account.principal_id]
    );
    return {
      data: { playerId: account.principal_id, username: account.username, session },
      requestId: request.id
    };
  });

  app.get("/auth/me", async (request, reply) => {
    const principalId = await requirePrincipal(request, reply);
    if (!principalId || !pool) return;

    const result = await pool.query(
      `SELECT u.principal_id AS id, u.username, u.email, p.display_name AS "displayName",
              pr.status, u.created_at AS "createdAt"
         FROM core.users u
         JOIN core.principals pr ON pr.id = u.principal_id
         LEFT JOIN core.user_profiles p ON p.principal_id = u.principal_id
        WHERE u.principal_id = $1`,
      [principalId]
    );
    return { data: result.rows[0] ?? null, requestId: request.id };
  });

  app.post("/auth/logout", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Logout is temporarily unavailable." } });
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    const token = match?.[1];
    if (!token) return reply.code(204).send();

    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      "UPDATE core.auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash]
    );
    return reply.code(204).send();
  });
}
