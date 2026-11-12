import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireServicePermission } from "../auth/service.js";
import { pool } from "../db.js";

const claimSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10)
});

const ackSchema = z.object({
  outcome: z.enum(["delivered", "failed"]),
  response: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(1000).optional()
});

export async function registerRewardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/integrations/servers/:serverId/rewards/claim", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Reward delivery is temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid() }).safeParse(request.params);
    const body = claimSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid server UUID and claim limit are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "rewards.claim", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `WITH picked AS (
           SELECT rq.id
             FROM commerce.reward_queue rq
             JOIN core.servers s ON s.id = rq.server_id AND s.game_key = rq.game_key
            WHERE rq.server_id = $1
              AND rq.available_at <= NOW()
              AND (
                rq.status IN ('pending', 'failed')
                OR (rq.status = 'processing' AND rq.lease_expires_at <= NOW())
              )
            ORDER BY rq.available_at, rq.created_at
            FOR UPDATE OF rq SKIP LOCKED
            LIMIT $2
         )
         UPDATE commerce.reward_queue rq
            SET status = 'processing',
                attempts = rq.attempts + 1,
                claimed_by_principal_id = $3,
                lease_expires_at = NOW() + INTERVAL '120 seconds'
           FROM picked
          WHERE rq.id = picked.id
         RETURNING rq.id, rq.entitlement_id AS "entitlementId",
                   rq.game_key AS game, rq.target_external_id AS "targetExternalId",
                   rq.delivery_payload AS "deliveryPayload", rq.attempts,
                   rq.idempotency_key AS "idempotencyKey", rq.lease_expires_at AS "leaseExpiresAt"`,
        [params.data.serverId, body.data.limit, actorId]
      );

      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'reward.claim', 'server', $2, 'success', $3::jsonb)`,
        [actorId, params.data.serverId, JSON.stringify({ claimedCount: claimed.rows.length })]
      );
      await client.query("COMMIT");
      return { data: claimed.rows, requestId: request.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Reward claim failed");
      return reply.code(500).send({ error: { code: "REWARD_CLAIM_FAILED", message: "Reward deliveries could not be claimed." } });
    } finally {
      client.release();
    }
  });

  app.post("/integrations/servers/:serverId/rewards/:rewardId/ack", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Reward delivery acknowledgement is temporarily unavailable." } });
    const params = z.object({ serverId: z.string().uuid(), rewardId: z.string().uuid() }).safeParse(request.params);
    const body = ackSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A valid reward ID and delivery outcome are required." } });
    }

    const actorId = await requireServicePermission(request, reply, "rewards.ack", "server", params.data.serverId);
    if (!actorId) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        id: string;
        status: string;
        attempts: number;
        claimed_by_principal_id: string | null;
      }>(
        `SELECT id, status, attempts, claimed_by_principal_id
           FROM commerce.reward_queue
          WHERE id = $1 AND server_id = $2
          FOR UPDATE`,
        [params.data.rewardId, params.data.serverId]
      );
      const reward = current.rows[0];
      if (!reward) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: { code: "REWARD_NOT_FOUND", message: "The reward delivery was not found for this server." } });
      }
      if (reward.status === "delivered" && body.data.outcome === "delivered") {
        await client.query("COMMIT");
        return reply.code(202).send({ data: { accepted: true, duplicate: true, rewardId: reward.id }, requestId: request.id });
      }
      if (reward.status !== "processing" || reward.claimed_by_principal_id !== actorId) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: { code: "REWARD_LEASE_INVALID", message: "This service does not hold the active lease for the reward." } });
      }

      if (body.data.outcome === "delivered") {
        await client.query(
          `UPDATE commerce.reward_queue
              SET status = 'delivered', delivered_at = NOW(),
                  claimed_by_principal_id = NULL, lease_expires_at = NULL,
                  last_error = NULL
            WHERE id = $1`,
          [reward.id]
        );
        await client.query(
          `INSERT INTO commerce.reward_attempts (reward_id, attempt_number, outcome, response)
           VALUES ($1, $2, 'success', $3::jsonb)`,
          [reward.id, reward.attempts, JSON.stringify(body.data.response ?? {})]
        );
      } else {
        const errorMessage = body.data.error ?? "Game adapter reported delivery failure.";
        await client.query(
          `UPDATE commerce.reward_queue
              SET status = 'failed',
                  available_at = NOW() + make_interval(secs => LEAST(3600, POWER(2, LEAST(attempts, 10))::integer)),
                  claimed_by_principal_id = NULL, lease_expires_at = NULL,
                  last_error = $2
            WHERE id = $1`,
          [reward.id, errorMessage]
        );
        await client.query(
          `INSERT INTO commerce.reward_attempts (reward_id, attempt_number, outcome, response)
           VALUES ($1, $2, 'failure', $3::jsonb)`,
          [reward.id, reward.attempts, JSON.stringify({ ...(body.data.response ?? {}), error: errorMessage })]
        );
      }

      await client.query(
        `INSERT INTO operations.audit_logs
          (actor_principal_id, action, resource_type, resource_id, outcome, metadata)
         VALUES ($1, 'reward.ack', 'reward', $2, 'success', $3::jsonb)`,
        [actorId, reward.id, JSON.stringify({ outcome: body.data.outcome, attempt: reward.attempts })]
      );
      await client.query("COMMIT");
      return reply.code(202).send({
        data: { accepted: true, duplicate: false, rewardId: reward.id, outcome: body.data.outcome },
        requestId: request.id
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      request.log.error({ err: error }, "Reward acknowledgement failed");
      return reply.code(500).send({ error: { code: "REWARD_ACK_FAILED", message: "The reward outcome could not be saved." } });
    } finally {
      client.release();
    }
  });
}
