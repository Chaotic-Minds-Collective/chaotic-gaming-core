import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { config } from "./config.js";
import { pool } from "./db/pool.js";

const app = Fastify({
  logger: { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
  trustProxy: false,
  bodyLimit: 1_048_576
});

await app.register(helmet);

app.get("/health/live", async () => ({
  status: "ok",
  service: "chaotic-gaming-core"
}));

app.get("/health/ready", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ready", database: "connected" };
  } catch {
    return reply.code(503).send({ status: "not_ready", database: "unavailable" });
  }
});

app.setNotFoundHandler((_request, reply) => {
  return reply.code(404).send({ error: "not_found" });
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error({ err: error }, "Unhandled request error");
  return reply.code(500).send({ error: "internal_server_error" });
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
