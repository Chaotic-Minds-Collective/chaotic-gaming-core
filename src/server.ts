import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { checkDatabase, pool } from "./db.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerServiceRoutes } from "./routes/service.js";
import { registerEventRoutes } from "./routes/events.js";

const app = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: false, bodyLimit: 256 * 1024, requestIdHeader: "x-request-id", genReqId: () => randomUUID() });
await app.register(helmet);
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
app.get("/health", async () => ({ status: "ok", service: "chaotic-gaming-core", timestamp: new Date().toISOString() }));
app.get("/ready", async (_request, reply) => {
  try { await checkDatabase(); return { status: "ready", database: "connected" }; }
  catch (error) { app.log.error({ err: error }, "Readiness check failed"); return reply.code(503).send({ status: "not_ready", database: "unavailable" }); }
});
await registerGameRoutes(app);
await registerServiceRoutes(app);
await registerEventRoutes(app);
app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));
app.setErrorHandler((error, request, reply) => { request.log.error({ err: error }, "Unhandled request error"); return reply.code(500).send({ error: "internal_server_error" }); });
const shutdown = async (signal: string) => { app.log.info({ signal }, "Shutting down"); await app.close(); await pool.end(); process.exit(0); };
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
try { await app.listen({ host: config.HOST, port: config.PORT }); }
catch (error) { app.log.error({ err: error }, "Failed to start server"); await pool.end(); process.exit(1); }
