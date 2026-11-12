import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCommerceRoutes } from "./routes/commerce.js";
import { registerGameEventRoutes } from "./routes/game-events.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerPlayerResolutionRoutes } from "./routes/player-resolution.js";
import { registerPluginRoutes } from "./routes/plugins.js";
import { registerRewardRoutes } from "./routes/rewards.js";
import { registerServerRoutes } from "./routes/servers.js";
import { registerSteamLinkRoutes } from "./routes/steam-link.js";

export function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 1_048_576,
    trustProxy: false
  });

  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.get("/", async () => ({
    name: "Chaotic Gaming Core API",
    version: "1.2.1",
    docs: "https://github.com/Chaotic-Minds-Collective/chaotic-gaming-docs"
  }));

  void registerHealthRoutes(app);
  void registerAuthRoutes(app);
  void registerIntegrationRoutes(app);
  void registerCommerceRoutes(app);
  void registerServerRoutes(app);
  void registerGameEventRoutes(app);
  void registerPluginRoutes(app);
  void registerRewardRoutes(app);
  void registerPlayerResolutionRoutes(app);
  void registerSteamLinkRoutes(app);
  return app;
}
