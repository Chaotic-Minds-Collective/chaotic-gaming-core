import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(
  principalId: string,
  request: FastifyRequest
): Promise<{ token: string; expiresAt: string }> {
  if (!pool) throw new Error("Database unavailable");
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO core.auth_sessions
      (principal_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [principalId, hashToken(token), expiresAt, request.headers["user-agent"] ?? null, request.ip]
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function requirePrincipal(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  if (!pool) {
    await reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Authentication is temporarily unavailable." } });
    return null;
  }

  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  const token = match?.[1];
  if (!token) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "A valid bearer token is required." } });
    return null;
  }

  const tokenHash = hashToken(token);
  const result = await pool.query<{ principal_id: string }>(
    `SELECT s.principal_id
       FROM core.auth_sessions s
       JOIN core.principals p ON p.id = s.principal_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND p.status = 'active'`,
    [tokenHash]
  );

  const principalId = result.rows[0]?.principal_id;
  if (!principalId) {
    await reply.code(401).send({ error: { code: "INVALID_SESSION", message: "The session is invalid or expired." } });
    return null;
  }

  await pool.query(
    "UPDATE core.auth_sessions SET last_used_at = NOW() WHERE token_hash = $1",
    [tokenHash]
  );
  return principalId;
}
