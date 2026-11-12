import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";

export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireServicePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permissionKey: string,
  scopeType: "platform" | "game" | "cluster" | "server" | "guild",
  scopeId: string | null
): Promise<string | null> {
  if (!pool) {
    await reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Service authorization is unavailable." } });
    return null;
  }

  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer (cg_srv_[A-Za-z0-9_-]{40,})$/);
  if (!match) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "A valid service credential is required." } });
    return null;
  }

  const credentialHash = hashServiceToken(match[1]);
  const result = await pool.query<{ principal_id: string }>(
    `SELECT sa.principal_id
       FROM core.service_credentials sc
       JOIN core.service_accounts sa ON sa.principal_id = sc.principal_id
       JOIN core.principals p ON p.id = sa.principal_id
       JOIN core.principal_role_assignments pra ON pra.principal_id = sa.principal_id
       JOIN core.role_permissions rp ON rp.role_id = pra.role_id
       JOIN core.permissions perm ON perm.id = rp.permission_id
      WHERE sc.credential_hash = $1
        AND sc.revoked_at IS NULL
        AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
        AND p.status = 'active'
        AND perm.permission_key = $2
        AND (pra.expires_at IS NULL OR pra.expires_at > NOW())
        AND (
          (pra.scope_type = 'platform' AND pra.scope_id IS NULL)
          OR (pra.scope_type = $3 AND pra.scope_id IS NOT DISTINCT FROM $4)
        )
      LIMIT 1`,
    [credentialHash, permissionKey, scopeType, scopeId]
  );

  const principalId = result.rows[0]?.principal_id;
  if (!principalId) {
    await reply.code(403).send({ error: { code: "FORBIDDEN", message: "The service identity lacks the required permission or scope." } });
    return null;
  }

  await pool.query(
    "UPDATE core.service_credentials SET last_used_at = NOW() WHERE credential_hash = $1",
    [credentialHash]
  );
  return principalId;
}
