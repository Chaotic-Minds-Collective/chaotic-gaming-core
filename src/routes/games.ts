import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/games", async () => {
    const result = await pool.query(
      "SELECT id, name, status FROM core.games WHERE status <> 'retired' ORDER BY name",
    );
    return { games: result.rows };
  });
}
