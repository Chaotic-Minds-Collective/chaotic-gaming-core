import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { requireServicePermission } from "../auth/service.js";

export const NORMALIZED_GAME_EVENT_TYPES = [
  "player.joined",
  "player.left",
  "player.connected",
  "player.disconnected",
  "player.chat",
  "player.died",
  "player.killed",
  "character.created",
  "character.transferred",
  "tribe.created",
  "tribe.member.joined",
  "tribe.member.left",
  "tribe.updated",
  "chat.global",
  "chat.tribe",
  "ship.sunk",
  "ship.retrieved",
  "structure.destroyed",
  "tame.created",
  "tame.died",
  "server.started",
  "server.stopped",
  "server.state.changed"
] as const;

const eventScopeSchema = z.object({
  clusterId: z.string().uuid(),
  gridId: z.string().trim().min(1).max(200),
  serverId: z.string().uuid()
}).strict();

export const gameEventSchema = z.object({
  game: z.enum(["atlas", "7dtd", "ark"]),
  eventId: z.string().trim().min(1).max(200),
  eventType: z.enum(NORMALIZED_GAME_EVENT_TYPES),
  occurredAt: z.string().datetime(),
  scope: eventScopeSchema.optional(),
  correlationId: z.string().trim().min(1).max(200).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({})
});

export async function registerGameEventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/integrations/servers/:serverId/events", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Game event ingestion is temporarily unavailable." } });

    const params = z.object({ serverId: z.string().uuid() }).safeParse(request.params);
    const body = gameEventSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server ID and normalized game event are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "events.publish", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const server = await client.query<{ id: string; game_key: string; cluster_id: string }>(
        "SELECT id, game_key, cluster_id FROM core.servers WHERE id = $1 AND status <> 'deleted'",
        [params.data.serverId]
      );
      if (!server.rows[0] || server.rows[0].game_key !== body.data.game) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "SERVER_NOT_FOUND", message: "The assigned server was not found for this game." } });
      }
      if (body.data.scope && (
        body.data.scope.serverId !== params.data.serverId ||
        body.data.scope.clusterId !== server.rows[0].cluster_id
      )) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "EVENT_SCOPE_MISMATCH", message: "The event scope does not match the assigned server and cluster." } });
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO operations.game_events
          (server_id, cluster_id, grid_id, correlation_id, game_key, external_event_id, event_type, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (server_id, external_event_id) DO NOTHING
         RETURNING id`,
        [
          params.data.serverId,
          server.rows[0].cluster_id,
          body.data.scope?.gridId ?? null,
          body.data.correlationId ?? null,
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
          clusterId: server.rows[0].cluster_id,
          gridId: body.data.scope?.gridId ?? null,
          correlationId: body.data.correlationId ?? null,
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
