import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { requireServicePermission } from "../auth/service.js";

const heartbeatSchema = z.object({
  game: z.enum(["atlas", "7dtd", "ark"]),
  serverVersion: z.string().min(1).max(100),
  adapterVersion: z.string().min(1).max(100),
  online: z.boolean(),
  playerCount: z.number().int().min(0).max(100_000).optional(),
  observedAt: z.string().datetime().optional()
});

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/integrations/servers/:serverId/heartbeat", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Integration API is unavailable." } });

    const params = z.object({ serverId: z.string().uuid() }).safeParse(request.params);
    const body = heartbeatSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server ID and heartbeat payload are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "servers.heartbeat", "server", params.data.serverId);
    if (!actorId) return;

    const observedAt = body.data.observedAt ? new Date(body.data.observedAt) : new Date();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const server = await client.query<{ id: string; game_key: string }>(
        "SELECT id, game_key FROM core.servers WHERE id = $1 AND status <> 'deleted'",
        [params.data.serverId]
      );
      if (!server.rows[0] || server.rows[0].game_key !== body.data.game) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "SERVER_NOT_FOUND", message: "The assigned server was not found for this game." } });
      }

      await client.query(
        `INSERT INTO operations.server_heartbeats
          (server_id, server_version, adapter_version, online, player_count, observed_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [params.data.serverId, body.data.serverVersion, body.data.adapterVersion, body.data.online, body.data.playerCount ?? null, observedAt]
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome)
         VALUES ($1, 'server.heartbeat', 'server', $2, 'success')`,
        [actorId, params.data.serverId]
      );
      await client.query("COMMIT");
      return reply.code(202).send({ data: { accepted: true, serverId: params.data.serverId, receivedAt: new Date().toISOString() }, requestId: request.id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Server heartbeat failed");
      return reply.code(500).send({ error: { code: "HEARTBEAT_FAILED", message: "The heartbeat could not be recorded." } });
    } finally {
      client.release();
    }
  });
}
