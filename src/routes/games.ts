import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/games", async (_request, reply) => {
    const result = await pool.query<{
      game_key: string;
      display_name: string;
      integration_status: string;
    }>(
      `SELECT game_key, display_name, integration_status
       FROM core.games
       WHERE enabled = true AND integration_status <> 'retired'
       ORDER BY display_name ASC`
    );

    return reply.send({
      data: result.rows.map((game) => ({
        id: game.game_key,
        name: game.display_name,
        status: game.integration_status
      }))
    });
  });
}
