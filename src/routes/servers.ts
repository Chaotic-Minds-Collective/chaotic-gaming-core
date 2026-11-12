import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/servers", async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Server status is temporarily unavailable." } });

    const result = await pool.query(
      `SELECT s.id, s.name, s.game_key AS "gameKey", c.name AS "clusterName",
              s.status AS "configuredStatus",
              TRUE AS "isListed",
              s.public_hostname AS "publicHostname",
              s.game_port AS "gamePort",
              s.query_port AS "queryPort",
              s.max_players AS "maxPlayers",
              s.map_name AS "mapName",
              COALESCE(
                CASE
                  WHEN hb.received_at < NOW() - INTERVAL '5 minutes' THEN FALSE
                  ELSE hb.online
                END,
                FALSE
              ) AS online,
              CASE
                WHEN hb.received_at < NOW() - INTERVAL '5 minutes' THEN NULL
                ELSE hb.player_count
              END AS "playerCount",
              hb.server_version AS "serverVersion",
              hb.adapter_version AS "adapterVersion",
              hb.received_at AS "lastHeartbeat"
         FROM core.servers s
         JOIN core.clusters c ON c.id = s.cluster_id
         LEFT JOIN LATERAL (
           SELECT online, player_count, server_version, adapter_version, received_at
             FROM operations.server_heartbeats
            WHERE server_id = s.id
            ORDER BY received_at DESC
            LIMIT 1
         ) hb ON TRUE
        WHERE s.environment = 'production'
          AND s.status <> 'deleted'
          AND s.is_listed = TRUE
        ORDER BY s.game_key, c.name, s.name`
    );

    return { data: result.rows, requestId: request.id };
  });
}
