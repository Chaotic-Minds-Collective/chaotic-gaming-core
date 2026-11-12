import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";

const app = await buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
