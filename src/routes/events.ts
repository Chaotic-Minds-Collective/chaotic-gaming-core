import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { authenticateServiceToken, bearerToken, serviceHasPermission } from "../security/serviceAuth.js";

const eventSchema = z.object({
  eventType: z.string().min(3).max(120).regex(/^[a-z][a-z0-9_.-]+$/),
  aggregateType: z.string().min(2).max(80).regex(/^[a-z][a-z0-9_.-]+$/),
  aggregateId: z.string().min(1).max(160),
  payload: z.record(z.unknown()),
}).strict();

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/events", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const service = await authenticateServiceToken(token);
    if (!service) return reply.code(401).send({ error: "unauthorized" });
    if (!(await serviceHasPermission(service.principalId, "events.publish"))) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return reply.code(400).send({ error: "idempotency_key_required" });
    }
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_event", details: parsed.error.flatten() });
    const { eventType, aggregateType, aggregateId, payload } = parsed.data;
    const inserted = await pool.query(
      `INSERT INTO operations.event_outbox
       (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id, occurred_at`,
      [eventType, aggregateType, aggregateId, JSON.stringify(payload), idempotencyKey],
    );
    const row = inserted.rows[0] ?? (await pool.query(
      "SELECT id, occurred_at FROM operations.event_outbox WHERE idempotency_key = $1",
      [idempotencyKey],
    )).rows[0];
    return reply.code(202).send({ accepted: true, eventId: row.id, occurredAt: row.occurred_at });
  });
}
