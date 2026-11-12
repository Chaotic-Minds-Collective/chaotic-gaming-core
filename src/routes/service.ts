import type { FastifyInstance } from "fastify";
import { hashServiceToken, isServiceTokenFormat } from "../security/tokens.js";
import { pool } from "../db.js";

export async function registerServiceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/service/ping", async (request, reply) => {
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];
    if (!token || !isServiceTokenFormat(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const result = await pool.query(
      `SELECT p.id, sa.application_name
       FROM core.service_accounts sa
       JOIN core.principals p ON p.id = sa.principal_id
       WHERE sa.credential_hash = $1 AND p.principal_type = 'service'
         AND p.status = 'active'`,
      [hashServiceToken(token)],
    );
    const service = result.rows[0] as { id: string; application_name: string } | undefined;
    if (!service) return reply.code(401).send({ error: "unauthorized" });
    return { authenticated: true, principalId: service.id, application: service.application_name };
  });
}
