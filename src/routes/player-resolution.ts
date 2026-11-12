import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireServicePermission } from "../auth/service.js";
import { pool } from "../db.js";

const resolveSchema = z.object({
  provider: z.string().min(2).max(32).regex(/^[a-z0-9._-]+$/),
  externalId: z.string().min(1).max(128)
});

export async function registerPlayerResolutionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/integrations/servers/:serverId/players/resolve", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Player identity resolution is temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid() }).safeParse(request.params);
    const body = resolveSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server UUID, provider and external player ID are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "players.resolve", "server", params.data.serverId);
    if (!actorId) return;

    const result = await pool.query(
      `SELECT p.id AS "principalId", u.username,
              up.display_name AS "displayName"
         FROM core.linked_accounts la
         JOIN core.users u ON u.principal_id = la.principal_id
         JOIN core.principals p ON p.id = u.principal_id
         LEFT JOIN core.user_profiles up ON up.principal_id = u.principal_id
        WHERE la.provider = $1
          AND la.external_id = $2
          AND la.verified_at IS NOT NULL
          AND la.unlinked_at IS NULL
          AND p.status = 'active'
        LIMIT 1`,
      [body.data.provider, body.data.externalId]
    );

    if (!result.rows[0]) {
      return { data: { linked: false }, requestId: request.id };
    }
    return { data: { linked: true, ...result.rows[0] }, requestId: request.id };
  });
}
