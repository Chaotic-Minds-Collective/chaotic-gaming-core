import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { pool } from "./db/pool.js";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: false,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet);

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready", database: "reachable" };
    } catch {
      return reply.code(503).send({ status: "not_ready", database: "unavailable" });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "request_error",
      message: statusCode >= 500 ? "An unexpected error occurred." : error.message,
    });
  });

  return app;
}
