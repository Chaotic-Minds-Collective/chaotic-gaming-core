import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";

declare module "fastify" {
  interface FastifyRequest {
    servicePrincipal?: { id: string; applicationName: string };
    serviceScopes?: string[];
  }
}

export async function authenticateService(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer (cg_srv_[A-Za-z0-9_-]+)$/);
  if (!match) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }

  const tokenHash = createHash("sha256").update(match[1], "utf8").digest("hex");
  const result = await pool.query<{
    principal_id: string;
    application_name: string;
    scopes: string[];
  }>(
    `SELECT c.principal_id, s.application_name, c.scopes
     FROM core.service_credentials c
     JOIN core.service_accounts s ON s.principal_id = c.principal_id
     JOIN core.principals p ON p.id = c.principal_id
     WHERE c.secret_hash = $1
       AND c.revoked_at IS NULL
       AND (c.expires_at IS NULL OR c.expires_at > now())
       AND p.status = 'active'
     LIMIT 1`,
    [tokenHash]
  );

  const credential = result.rows[0];
  if (!credential) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }

  await pool.query(
    "UPDATE core.service_credentials SET last_used_at = now() WHERE secret_hash = $1",
    [tokenHash]
  );

  request.servicePrincipal = {
    id: credential.principal_id,
    applicationName: credential.application_name
  };
  request.serviceScopes = credential.scopes;
}

export function requireServiceScope(scope: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.servicePrincipal) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (!request.serviceScopes?.includes(scope) && !request.serviceScopes?.includes("*")) {
      await reply.code(403).send({ error: "forbidden", requiredScope: scope });
    }
  };
}
