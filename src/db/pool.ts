import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  // Keep the process observable; callers receive query errors independently.
  console.error("Unexpected PostgreSQL pool error", error);
});
