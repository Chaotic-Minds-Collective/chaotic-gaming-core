import type { FastifyInstance } from "fastify";
import { checkDatabase } from "../db.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async () => ({
    status: "ok",
    service: "chaotic-gaming-core"
  }));

  app.get("/health/ready", async (_request, reply) => {
    const database = await checkDatabase();
    if (!database) {
      return reply.code(503).send({
        status: "not_ready",
        checks: { database: "unavailable" }
      });
    }
    return { status: "ready", checks: { database: "ok" } };
  });
}
