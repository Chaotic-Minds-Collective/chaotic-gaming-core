import Fastify from "fastify";
import { config } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";

export function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 1_048_576,
    trustProxy: false
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.get("/", async () => ({
    name: "Chaotic Gaming Core API",
    version: "0.1.0",
    docs: "https://github.com/Chaotic-Minds-Collective/chaotic-gaming-docs"
  }));

  void registerHealthRoutes(app);
  return app;
}
