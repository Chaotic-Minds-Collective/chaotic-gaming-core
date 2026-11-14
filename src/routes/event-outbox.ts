import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireServicePermission } from "../auth/service.js";
import { pool } from "../db.js";

const claimSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  leaseSeconds: z.number().int().min(15).max(300).default(120)
});

const ackSchema = z.object({
  leaseToken: z.string().uuid(),
  outcome: z.enum(["delivered", "failed"]),
  error: z.string().max(1000).optional()
});

export async function registerEventOutboxRoutes(app: FastifyInstance): Promise<void> {
  app.post("/integrations/servers/:serverId/events/claim", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Game event delivery is temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid().transform((value) => value.toLowerCase()) }).safeParse(request.params);
    const body = claimSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server UUID and claim options are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "events.claim", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `WITH picked AS (
           SELECT eo.id
             FROM operations.event_outbox eo
            WHERE eo.event_type = 'game.event.received'
              AND eo.payload->>'serverId' = $1
              AND eo.processed_at IS NULL
              AND eo.available_at <= NOW()
              AND (eo.lease_expires_at IS NULL OR eo.lease_expires_at <= NOW())
            ORDER BY eo.occurred_at, eo.id
            LIMIT $2
            FOR UPDATE OF eo SKIP LOCKED
         )
         UPDATE operations.event_outbox eo
            SET attempts = eo.attempts + 1,
                claimed_by_principal_id = $3,
                lease_token = gen_random_uuid(),
                lease_expires_at = NOW() + make_interval(secs => $4)
           FROM picked
          WHERE eo.id = picked.id
         RETURNING eo.id, eo.event_type AS "eventType",
                   eo.aggregate_type AS "aggregateType", eo.aggregate_id AS "aggregateId",
                   eo.payload, eo.occurred_at AS "occurredAt", eo.attempts,
                   eo.lease_token AS "leaseToken", eo.lease_expires_at AS "leaseExpiresAt"`,
        [params.data.serverId, body.data.limit, actorId, body.data.leaseSeconds]
      );

      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'game.event.claim', 'server', $2, 'success', $3::jsonb)`,
        [actorId, params.data.serverId, JSON.stringify({ claimedCount: claimed.rows.length })]
      );
      await client.query("COMMIT");
      return { data: claimed.rows, requestId: request.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Game event outbox claim failed");
      return reply.code(500).send({ error: { code: "EVENT_CLAIM_FAILED", message: "Game events could not be claimed." } });
    } finally {
      client.release();
    }
  });

  app.post("/integrations/servers/:serverId/events/:eventId/ack", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Game event acknowledgement is temporarily unavailable." } });
    const params = z.object({
      serverId: z.string().uuid().transform((value) => value.toLowerCase()),
      eventId: z.string().uuid()
    }).safeParse(request.params);
    const body = ackSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server UUID, event UUID, lease token, and outcome are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "events.ack", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        id: string;
        processed_at: Date | null;
        attempts: number;
        claimed_by_principal_id: string | null;
        lease_token: string | null;
        lease_expires_at: Date | null;
      }>(
        `SELECT id, processed_at, attempts, claimed_by_principal_id, lease_token, lease_expires_at
           FROM operations.event_outbox
          WHERE id = $1 AND event_type = 'game.event.received'
            AND payload->>'serverId' = $2
          FOR UPDATE`,
        [params.data.eventId, params.data.serverId]
      );
      const event = current.rows[0];
      if (!event) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "EVENT_NOT_FOUND", message: "The game event was not found for this server." } });
      }
      if (event.processed_at) {
        await client.query("COMMIT");
        return reply.code(202).send({ data: { accepted: true, duplicate: true, eventId: event.id }, requestId: request.id });
      }
      if (
        event.claimed_by_principal_id !== actorId ||
        event.lease_token !== body.data.leaseToken ||
        !event.lease_expires_at ||
        event.lease_expires_at.getTime() <= Date.now()
      ) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "EVENT_LEASE_INVALID", message: "This service does not hold the active lease for this event." } });
      }

      if (body.data.outcome === "delivered") {
        await client.query(
          `UPDATE operations.event_outbox
              SET processed_at = NOW(), claimed_by_principal_id = NULL,
                  lease_token = NULL, lease_expires_at = NULL, last_error = NULL
            WHERE id = $1`,
          [event.id]
        );
      } else {
        const errorMessage = body.data.error ?? "Game event consumer reported processing failure.";
        await client.query(
          `UPDATE operations.event_outbox
              SET available_at = NOW() + make_interval(secs => LEAST(3600, POWER(2, LEAST(attempts, 10))::integer)),
                  claimed_by_principal_id = NULL, lease_token = NULL,
                  lease_expires_at = NULL, last_error = $2
            WHERE id = $1`,
          [event.id, errorMessage]
        );
      }

      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'game.event.ack', 'game_event_outbox', $2, 'success', $3::jsonb)`,
        [actorId, event.id, JSON.stringify({ outcome: body.data.outcome, attempt: event.attempts })]
      );
      await client.query("COMMIT");
      return reply.code(202).send({
        data: { accepted: true, duplicate: false, eventId: event.id, outcome: body.data.outcome },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Game event acknowledgement failed");
      return reply.code(500).send({ error: { code: "EVENT_ACK_FAILED", message: "The game event outcome could not be saved." } });
    } finally {
      client.release();
    }
  });
}
