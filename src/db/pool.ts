import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: "chaotic-gaming-core"
});

pool.on("error", (error) => {
  // Do not log connection strings or credentials.
  console.error("Unexpected idle PostgreSQL client error", error.message);
});
