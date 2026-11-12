import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { requireServicePermission } from "../auth/service.js";

const eventSchema = z.object({
  game: z.enum(["atlas", "7dtd", "ark"]),
  eventId: z.string().trim().min(1).max(200),
  eventType: z.enum(["player.joined", "player.left", "player.chat", "server.started", "server.stopped", "player.died"]),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).default({})
});

export async function registerGameEventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/integrations/servers/:serverId/events", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Game event ingestion is temporarily unavailable." } });

    const params = z.object({ serverId: z.string().uuid() }).safeParse(request.params);
    const body = eventSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server ID and normalized game event are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "events.publish", "server", params.data.serverId);
    if (!actorId) return;

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

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO operations.game_events
          (server_id, game_key, external_event_id, event_type, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (server_id, external_event_id) DO NOTHING
         RETURNING id`,
        [
          params.data.serverId,
          body.data.game,
          body.data.eventId,
          body.data.eventType,
          JSON.stringify(body.data.payload),
          new Date(body.data.occurredAt)
        ]
      );

      if (!inserted.rows[0]) {
        await client.query("COMMIT");
        return reply.code(202).send({
          data: { accepted: true, duplicate: true, serverId: params.data.serverId, eventId: body.data.eventId },
          requestId: request.id
        });
      }

      const eventRecordId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO operations.event_outbox
          (event_type, aggregate_type, aggregate_id, payload)
         VALUES ('game.event.received', 'game_event', $1, $2::jsonb)`,
        [eventRecordId, JSON.stringify({
          eventRecordId,
          serverId: params.data.serverId,
          game: body.data.game,
          eventId: body.data.eventId,
          eventType: body.data.eventType,
          occurredAt: body.data.occurredAt,
          payload: body.data.payload
        })]
      );
      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome)
         VALUES ($1, 'game.event.publish', 'server', $2, 'success')`,
        [actorId, params.data.serverId]
      );
      await client.query("COMMIT");
      return reply.code(202).send({
        data: { accepted: true, duplicate: false, serverId: params.data.serverId, eventId: body.data.eventId },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Game event ingestion failed");
      return reply.code(500).send({ error: { code: "EVENT_INGESTION_FAILED", message: "The game event could not be recorded." } });
    } finally {
      client.release();
    }
  });
}
